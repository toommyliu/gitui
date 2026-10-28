import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { Oid, RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { Git } from "./git.ts"
import { makeRecovery } from "./recovery.ts"
import { makeRepo } from "./testRepo.ts"

layer(Layer.merge(Repo.layer, Git.layer).pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))(
  "Recovery",
  (it) => {
    it.effect("keeps the newest backups when undo and rewrite namespaces exceed the display limit", () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        const tip = fixture.commit("saved")
        const recent = "refs/gitui/rewrites/1800000000000-newest"
        const refs = Array.from({ length: 100 }, (_, i) => `create refs/gitui/undo/${1700000000000 + i}-old ${tip}`)
        yield* (yield* Git).run(fixture.root, ["update-ref", "--stdin"], {
          stdin: new TextEncoder().encode([...refs, `create ${recent} ${tip}`, ""].join("\n")),
          write: true,
        })
        const backups = (yield* (yield* Repo).recovery(fixture.root as RepoId)).entries.filter(
          (entry) => entry.kind === "rewrite",
        )
        expect(backups).toHaveLength(100)
        expect(backups[0]?.selector).toBe(recent)
      }),
    )

    it.effect("rejects a dangling symbolic recovery branch without populating its target", () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        const tip = fixture.commit("saved") as Oid
        fixture.git("symbolic-ref", "refs/heads/recovered", "refs/heads/unborn")
        fixture.git("symbolic-ref", "HEAD", "refs/heads/unborn")
        const result = yield* Effect.result((yield* Repo).recoverCommit(fixture.root as RepoId, tip, "recovered"))
        expect(result._tag).toBe("Failure")
        expect(fixture.git("symbolic-ref", "refs/heads/recovered")).toBe("refs/heads/unborn")
        expect(fixture.git("for-each-ref", "--format=%(refname)", "refs/heads/unborn")).toBe("")
      }),
    )

    it.effect("rejects a branch moved after the precheck and creates no backup", () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        fixture.commit("base")
        const tip = fixture.commit("tip") as Oid
        const next = fixture.commit("external edit")
        fixture.git("update-ref", "refs/heads/main", tip)
        const id = fixture.root as RepoId
        const current = yield* (yield* Repo).status(id)
        const recovery = makeRecovery(yield* Git, () =>
          Effect.sync(() => {
            fixture.git("update-ref", "refs/heads/main", next)
            return current
          }),
        )
        const error = yield* Effect.flip(recovery.undoCommit(id, tip, "main"))
        expect(error.stderr).toContain("is at")
        expect(fixture.git("rev-parse", "HEAD")).toBe(next)
        expect(fixture.git("for-each-ref", "refs/gitui/undo/")).toBe("")
      }),
    )
    it.effect("browses an unborn repository and detached HEAD without changing either", () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        const repo = yield* Repo
        const id = fixture.root as RepoId
        expect(yield* repo.recovery(id)).toEqual({
          entries: [],
          undo: { _tag: "Unavailable", reason: "There are no commits to undo." },
        })
        const oid = fixture.commit("base")
        fixture.git("switch", "--detach", "-q")
        const detached = yield* repo.recovery(id)
        expect(detached.entries.some((entry) => entry.oid === oid)).toBe(true)
        expect(detached.undo).toEqual({ _tag: "Unavailable", reason: "Switch to a branch before undoing a commit." })
        expect(fixture.git("rev-parse", "HEAD")).toBe(oid)
      }),
    )

    it.effect("honors a rejecting reference hook and leaves both branch and backup unchanged", () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        fixture.commit("base")
        const tip = fixture.commit("tip") as Oid
        const hook = join(fixture.root, ".git", "hooks", "reference-transaction")
        writeFileSync(hook, '#!/bin/sh\nif test "$1" = prepared; then exit 1; fi\n')
        chmodSync(hook, 0o755)
        const repo = yield* Repo
        const id = fixture.root as RepoId
        const failure = yield* Effect.flip(repo.undoCommit(id, tip, "main"))
        expect(failure.stderr).toContain("hook")
        expect(fixture.git("rev-parse", "HEAD")).toBe(tip)
        expect(fixture.git("for-each-ref", "refs/gitui/undo/")).toBe("")
        yield* Effect.flip(repo.recoverCommit(id, tip, "recovered"))
        expect(fixture.git("branch", "--list", "recovered")).toBe("")
      }),
    )
    it.effect("finds an abandoned commit and recovers it without switching or overwriting a branch", () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        const base = fixture.commit("base")
        const lost = fixture.commit("lost work") as Oid
        fixture.git("reset", "--hard", base)
        const repo = yield* Repo
        const id = fixture.root as RepoId
        const recovery = yield* repo.recovery(id)
        expect(recovery.entries.find((entry) => entry.oid === lost)).toMatchObject({
          action: "commit: lost work",
          subject: "lost work",
          actor: "Ada",
        })
        expect(recovery.entries.find((entry) => entry.oid === lost)?.time).toBeGreaterThan(1_000_000_000)
        yield* repo.recoverCommit(id, lost, "recovered")
        expect(fixture.git("rev-parse", "recovered")).toBe(lost)
        expect(fixture.git("symbolic-ref", "--short", "HEAD")).toBe("main")
        fixture.git("update-ref", "refs/heads/recovered", base)
        yield* Effect.flip(repo.recoverCommit(id, lost, "recovered"))
        expect(fixture.git("rev-parse", "recovered")).toBe(base)
      }),
    )

    it.effect("undoes the tip while keeping index bytes, working files, modes and untracked files", () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        fixture.write("a", "base\n")
        fixture.git("add", ".")
        const base = fixture.commit("base")
        fixture.write("a", "committed\n")
        fixture.git("add", ".")
        const tip = fixture.commit("tip") as Oid
        fixture.write("a", "staged\n")
        fixture.git("add", ".")
        fixture.write("a", "unstaged\n")
        chmodSync(join(fixture.root, "a"), 0o755)
        fixture.write("untracked", "keep me\n")
        const indexPath = join(fixture.root, ".git", "index")
        const index = readFileSync(indexPath)
        const repo = yield* Repo
        const id = fixture.root as RepoId
        yield* repo.undoCommit(id, tip, "main")
        expect(fixture.git("rev-parse", "HEAD")).toBe(base)
        expect(readFileSync(indexPath)).toEqual(index)
        expect(readFileSync(join(fixture.root, "a"), "utf8")).toBe("unstaged\n")
        expect(statSync(join(fixture.root, "a")).mode & 0o777).toBe(0o755)
        expect(readFileSync(join(fixture.root, "untracked"), "utf8")).toBe("keep me\n")
        const backup = (yield* repo.recovery(id)).entries.find((entry) => entry.action === "Before undo")
        expect(backup?.oid).toBe(tip)
        expect(fixture.git("show", ":a")).toBe("staged")
      }),
    )

    it.effect("refuses stale, detached, in-progress and root-commit undo requests", () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        const base = fixture.commit("base") as Oid
        const repo = yield* Repo
        const id = fixture.root as RepoId
        expect((yield* Effect.flip(repo.undoCommit(id, base, "main"))).stderr).toContain("first commit")
        const tip = fixture.commit("tip") as Oid
        expect((yield* Effect.flip(repo.undoCommit(id, base, "main"))).stderr).toContain("HEAD changed")
        expect((yield* Effect.flip(repo.undoCommit(id, tip, "other"))).stderr).toContain("HEAD changed")
        writeFileSync(join(fixture.root, ".git", "MERGE_HEAD"), `${base}\n`)
        expect((yield* Effect.flip(repo.undoCommit(id, tip, "main"))).stderr).toContain("merge")
        expect(fixture.git("rev-parse", "HEAD")).toBe(tip)
        fixture.git("merge", "--quit")
        fixture.git("switch", "--detach", "-q")
        expect((yield* Effect.flip(repo.undoCommit(id, tip, "main"))).stderr).toContain("Switch to a branch")
      }),
    )

    it.effect("lists durable history-edit backups even after the HEAD reflog is cleared", () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        const tip = fixture.commit("before rewrite")
        fixture.git("update-ref", "refs/gitui/rewrites/1800000000000-abcd", tip)
        fixture.git("reflog", "expire", "--expire=all", "--all")
        const recovery = yield* (yield* Repo).recovery(fixture.root as RepoId)
        expect(recovery.entries).toEqual([
          {
            kind: "rewrite",
            selector: "refs/gitui/rewrites/1800000000000-abcd",
            oid: tip,
            action: "Before history edit",
            subject: "before rewrite",
            actor: "Ada",
            time: 1_800_000_000,
          },
        ])
      }),
    )
  },
)
