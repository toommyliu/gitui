import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { Oid, RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { fixtureEnv, makeRepo } from "./testRepo.ts"

const id = (root: string) => root as RepoId
const p = (path: string) => path as RepoPath

layer(Repo.layer.pipe(Layer.provideMerge(CommandLog.layer), Layer.provide(NodeServices.layer)))("Repo", (it) => {
  it.effect("pages the log in order on demand and reports the full count once loaded", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.emptyCommits(300)
      const expected = repo.git("log", "--format=%H").split("\n")
      const r = yield* Repo

      const opened = r.openLog(id(repo.root), "")
      const { logId } = Option.getOrThrow(yield* Stream.runHead(opened))
      const first = yield* r.logPage(id(repo.root), logId, 0, 100)
      const last = yield* r.logPage(id(repo.root), logId, 250, 100)
      expect(first.map((row) => row.oid)).toEqual(expected.slice(0, 100))
      expect(last.map((row) => row.oid)).toEqual(expected.slice(250))
      expect(Option.getOrThrow(yield* Stream.runLast(opened))).toEqual({ logId, loaded: 300, done: true })
    }),
  )

  it.effect("stops reading a log once nothing is waiting on it, and reads on when a page is asked for", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.emptyCommits(20_000)
      const r = yield* Repo

      const opened = r.openLog(id(repo.root), "")
      const { logId } = Option.getOrThrow(yield* Stream.runHead(opened))
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 500)))
      const idle = Option.getOrThrow(yield* Stream.runHead(opened))
      expect(idle.done).toBe(false)
      expect(idle.loaded).toBeLessThan(20_000)

      const last = yield* r.logPage(id(repo.root), logId, 19_900, 100)
      expect(last.map((row) => row.subject)).toEqual(Array.from({ length: 100 }, (_, i) => `commit ${99 - i}`))
    }),
  )

  it.effect("keeps a commit message draft per worktree until the next commit clears it", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "base\n")
      repo.git("add", ".")
      repo.commit("base")
      const other = `${repo.root}-other`
      repo.git("worktree", "add", "-q", "-b", "other", other)
      const r = yield* Repo

      yield* r.writeDraft(id(repo.root), "fix: half-written message\n\nwith a body")
      expect(yield* r.readDraft(id(repo.root))).toBe("fix: half-written message\n\nwith a body")
      expect(yield* r.readDraft(id(other))).toBe("")
      expect((yield* r.status(id(repo.root))).entries).toEqual([])

      repo.write("a.txt", "changed\n")
      repo.git("add", "a.txt")
      yield* r.commitIndex(id(repo.root), "fix: done", false)
      expect(yield* r.readDraft(id(repo.root))).toBe("")

      yield* r.writeDraft(id(other), "draft")
      yield* r.writeDraft(id(other), "")
      expect(existsSync(join(repo.git("rev-parse", "--absolute-git-dir"), "worktrees", "other", "GITUI_MSG"))).toBe(
        false,
      )
    }),
  )

  it.effect("commits exactly the index, leaving later working-tree edits uncommitted", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "base\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.write("a.txt", "staged\n")
      repo.git("add", "a.txt")
      repo.write("a.txt", "working\n")

      yield* (yield* Repo).commitIndex(id(repo.root), "save staged", false)
      expect(repo.git("show", "HEAD:a.txt")).toBe("staged")
      expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("working\n")
    }),
  )

  it.effect("stages a file named like a glob without staging its matches", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      for (const name of ["*.ts", "a.ts", "b.ts"]) repo.write(name, "x\n")
      yield* (yield* Repo).stage(id(repo.root), [p("*.ts")])
      expect(repo.git("diff", "--cached", "--name-only")).toBe("*.ts")
    }),
  )

  it.effect("discards tracked edits and deletes untracked files", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "base\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.write("a.txt", "edited\n")
      repo.write("new.txt", "new\n")
      yield* (yield* Repo).discard(id(repo.root), [p("a.txt"), p("new.txt")])
      expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("base\n")
      expect(existsSync(join(repo.root, "new.txt"))).toBe(false)
    }),
  )

  it.effect("combines diffs for several untracked files", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      repo.write("one.txt", "first\n")
      repo.write("dir/two.txt", "second\n")
      const diff = yield* (yield* Repo).diff(id(repo.root), { _tag: "Untracked" }, [p("one.txt"), p("dir/two.txt")])
      expect(diff._tag === "Patch" && diff.patch.match(/^\+\w+$/gm)).toEqual(["+first", "+second"])
    }),
  )

  it.effect("deletes a branch together with its dirty, locked worktree", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      const linked = `${repo.root}-agent`
      repo.git("worktree", "add", "-q", "-b", "agent", linked)
      repo.git("worktree", "lock", linked)
      repo.write(`../${linked.split("/").pop()}/dirty.txt`, "uncommitted\n")

      yield* (yield* Repo).deleteBranch(id(repo.root), "agent", false, true)
      expect(existsSync(linked)).toBe(false)
      expect(repo.git("branch", "--list", "agent")).toBe("")
    }),
  )

  it.effect("refuses to delete an unmerged branch without touching its worktree", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      const linked = `${repo.root}-wip`
      repo.git("worktree", "add", "-q", "-b", "wip", linked)
      execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "unmerged"], { cwd: linked, env: fixtureEnv() })
      repo.write(`../${linked.split("/").pop()}/dirty.txt`, "keep me\n")

      const result = yield* Effect.flip((yield* Repo).deleteBranch(id(repo.root), "wip", false, true))
      expect(result.stderr).toBe("wip has 1 commit that HEAD doesn't contain. Nothing was deleted.")
      expect(readFileSync(join(linked, "dirty.txt"), "utf8")).toBe("keep me\n")
      expect(repo.git("branch", "--list", "wip")).toBe("+ wip")
    }),
  )

  it.effect("logs each command with its kind, outcome and stderr", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      repo.write("a.txt", "a\n")
      const other = makeRepo()
      other.commit("base")
      const r = yield* Repo
      yield* r.stage(id(repo.root), [p("a.txt")])
      yield* r.checkout(id(other.root), "main")
      yield* Effect.flip(r.checkout(id(repo.root), "missing"))

      const [entries = []] = yield* (yield* CommandLog).entries(repo.root).pipe(Stream.take(1), Stream.runCollect)
      const mine = entries.map((entry) => ({
        command: entry.args.slice(entry.prefixLength).join(" "),
        kind: entry.kind,
        outcome: entry.outcome,
        failed: entry.stderr.includes("invalid reference: missing"),
      }))
      expect(mine).toEqual([
        {
          command: "add -A --pathspec-from-file=- --pathspec-file-nul",
          kind: "write",
          outcome: { _tag: "Exited", code: 0, accepted: true },
          failed: false,
        },
        {
          command: "switch missing",
          kind: "write",
          outcome: { _tag: "Exited", code: 128, accepted: false },
          failed: true,
        },
      ])
    }),
  )

  it.effect("returns a commit's files with rename and line stats", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("old.txt", "one\ntwo\nthree\nfour\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.git("mv", "old.txt", "new.txt")
      repo.write("new.txt", "one\ntwo\nthree\nfour\nfive\n")
      repo.write("img.bin", "\0\x01\x02")
      repo.git("add", ".")
      const oid = repo.commit("rename") as Oid
      const r = yield* Repo

      const detail = yield* r.commit(id(repo.root), oid)
      expect(detail.message).toBe("rename")
      expect(detail.files).toEqual([
        { path: "img.bin", from: null, change: "added", additions: null, deletions: null },
        { path: "new.txt", from: "old.txt", change: "renamed", additions: 1, deletions: 0 },
      ])
      const diff = yield* r.diff(id(repo.root), { _tag: "Commit", oid }, [p("old.txt"), p("new.txt")])
      expect(diff._tag === "Patch" && diff.patch.includes("rename from old.txt") && diff.patch.includes("+five")).toBe(
        true,
      )
      const whole = yield* r.diff(id(repo.root), { _tag: "Commit", oid }, [])
      expect(whole._tag === "Patch" && whole.patch.match(/^diff --git/gm)?.length).toBe(2)
    }),
  )

  it.effect("diffs a stash with untracked files against its first parent only", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "one\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.write("a.txt", "two\n")
      repo.write("new.txt", "new\n")
      repo.git("stash", "push", "-q", "--include-untracked")
      const oid = repo.git("rev-parse", "stash@{0}") as Oid

      const diff = yield* (yield* Repo).diff(id(repo.root), { _tag: "Commit", oid }, [p("a.txt")])
      expect(diff._tag === "Patch" && diff.patch.match(/^diff --git/gm)?.length).toBe(1)
    }),
  )
})
