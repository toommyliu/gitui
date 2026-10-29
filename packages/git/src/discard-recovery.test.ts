import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { GitError, type RepoId, type RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Option from "effect/Option"
import { CommandLog } from "./command-log.ts"
import { Git } from "./git.ts"
import { makeDiscardRecovery } from "./discard-recovery.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const p = (path: string) => path as RepoPath
const id = (path: string) => path as RepoId
const fixture = () => {
  const repo = makeRepo()
  repo.write("tracked", "base\n")
  repo.git("add", ".")
  repo.commit("base")
  return repo
}
const testLayer = Layer.merge(Repo.layer, Git.layer).pipe(
  Layer.provideMerge(CommandLog.layer),
  Layer.provide(NodeServices.layer),
)
layer(testLayer)("Discard recovery", (it) => {
  it.effect(
    "round trips exact tracked, binary, executable and symlink contents with index and unrelated files intact",
    () =>
      Effect.gen(function* () {
        const f = fixture()
        f.write("tracked", "staged\n")
        f.git("add", "tracked")
        f.write("tracked", "unstaged\n")
        chmodSync(join(f.root, "tracked"), 0o755)
        writeFileSync(join(f.root, "binary"), Buffer.from([0, 255, 1, 128]))
        symlinkSync("../outside-do-not-follow", join(f.root, "link"))
        f.write("other", "untouched\n")
        const index = f.raw("ls-files", "--stage", "-z")
        const r = yield* Repo
        const backup = yield* r.discard(id(f.root), [p("tracked"), p("binary"), p("link")])
        expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("staged\n")
        expect(existsSync(join(f.root, "binary"))).toBe(false)
        expect(backup?.paths).toEqual(["binary", "link", "tracked"])
        expect(yield* r.restoreDiscard(id(f.root), backup!.id, null)).toEqual({ _tag: "Restored" })
        expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("unstaged\n")
        expect(statSync(join(f.root, "tracked")).mode & 0o777).toBe(0o755)
        expect(readFileSync(join(f.root, "binary"))).toEqual(Buffer.from([0, 255, 1, 128]))
        expect(readlinkSync(join(f.root, "link"))).toBe("../outside-do-not-follow")
        expect(readFileSync(join(f.root, "other"), "utf8")).toBe("untouched\n")
        expect(f.raw("ls-files", "--stage", "-z")).toEqual(index)
        expect(yield* r.restoreDiscard(id(f.root), backup!.id, null)).toEqual({ _tag: "Restored" })
      }),
  )

  it.effect("keeps an interrupted discard recoverable and never logs its contents", () =>
    Effect.gen(function* () {
      const f = fixture()
      f.write("tracked", "private-token-that-must-not-be-logged\n")
      const recovery = makeDiscardRecovery(yield* Git)
      const interrupted = recovery.protect(
        id(f.root),
        [p("tracked")],
        "files",
        Effect.gen(function* () {
          f.write("tracked", "partially discarded\n")
          return yield* new GitError({ args: ["discard"], exitCode: -1, stderr: "Interrupted" })
        }),
      )
      expect((yield* Effect.result(interrupted))._tag).toBe("Failure")
      const restarted = makeDiscardRecovery(yield* Git)
      const backup = (yield* restarted.discardRecovery(id(f.root)))[0]!
      const conflict = yield* restarted.restoreDiscard(id(f.root), backup.id, null)
      expect(conflict._tag).toBe("Conflict")
      if (conflict._tag !== "Conflict") return yield* Effect.die("Expected guarded interrupted recovery")
      yield* restarted.restoreDiscard(id(f.root), backup.id, conflict.version)
      expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("private-token-that-must-not-be-logged\n")
      const logs = yield* Stream.runHead((yield* CommandLog).entries(f.root))
      expect(JSON.stringify(Option.getOrThrow(logs))).not.toContain("private-token-that-must-not-be-logged")
      expect(statSync(join(f.root, ".git/gitui-discard-backups")).mode & 0o777).toBe(0o700)
      expect(statSync(join(f.root, ".git/gitui-discard-backups", `${backup.id}.json`)).mode & 0o777).toBe(0o600)
    }),
  )

  it.effect("recovers selected lines and survives a fresh service instance", () =>
    Effect.gen(function* () {
      const f = fixture()
      f.write("tracked", "staged\nkeep\n")
      f.git("add", "tracked")
      f.write("tracked", "edited\nkeep\nextra\n")
      const index = f.raw("ls-files", "--stage", "-z")
      const r = yield* Repo
      const backup = yield* r.applyLines(id(f.root), "discard", p("tracked"), [
        { side: "old", line: 1, text: "staged" },
        { side: "new", line: 1, text: "edited" },
      ])
      expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("staged\nkeep\nextra\n")
      const restarted = makeDiscardRecovery(yield* Git)
      expect((yield* restarted.discardRecovery(id(f.root)))[0]?.id).toBe(backup!.id)
      yield* restarted.restoreDiscard(id(f.root), backup!.id, null)
      expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("edited\nkeep\nextra\n")
      expect(f.raw("ls-files", "--stage", "-z")).toEqual(index)
      const again = yield* r.discard(id(f.root), [p("tracked")])
      yield* r.restoreDiscard(id(f.root), again!.id, null)
      expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("edited\nkeep\nextra\n")
    }),
  )

  it.effect(
    "refuses overwrites, requires the current conflict version and saves newer edits before explicit replacement",
    () =>
      Effect.gen(function* () {
        const f = fixture()
        const r = yield* Repo
        f.write("tracked", "discarded\n")
        const backup = yield* r.discard(id(f.root), [p("tracked")])
        f.write("tracked", "newer\n")
        const conflict = yield* r.restoreDiscard(id(f.root), backup!.id, null)
        expect(conflict._tag).toBe("Conflict")
        expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("newer\n")
        if (conflict._tag !== "Conflict") return yield* Effect.die("Expected conflict")
        f.write("tracked", "newest\n")
        const stale = yield* r.restoreDiscard(id(f.root), backup!.id, conflict.version)
        expect(stale._tag).toBe("Conflict")
        expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("newest\n")
        if (stale._tag !== "Conflict") return yield* Effect.die("Expected stale conflict")
        yield* r.restoreDiscard(id(f.root), backup!.id, stale.version)
        expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("discarded\n")
        const displaced = (yield* r.discardRecovery(id(f.root))).find((entry) => entry.kind === "restore")!
        yield* r.restoreDiscard(id(f.root), displaced.id, null)
        expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("newest\n")
      }),
  )

  it.effect("preserves staged renames, working deletions and missing pre-discard paths", () =>
    Effect.gen(function* () {
      const f = fixture()
      f.git("mv", "tracked", "renamed")
      f.write("renamed", "renamed edits\n")
      const index = f.raw("ls-files", "--stage", "-z")
      const r = yield* Repo
      const rename = yield* r.discard(id(f.root), [p("tracked"), p("renamed")])
      yield* r.restoreDiscard(id(f.root), rename!.id, null)
      expect(existsSync(join(f.root, "tracked"))).toBe(false)
      expect(readFileSync(join(f.root, "renamed"), "utf8")).toBe("renamed edits\n")
      unlinkSync(join(f.root, "renamed"))
      const deletion = yield* r.discard(id(f.root), [p("renamed")])
      expect(readFileSync(join(f.root, "renamed"), "utf8")).toBe("base\n")
      yield* r.restoreDiscard(id(f.root), deletion!.id, null)
      expect(existsSync(join(f.root, "renamed"))).toBe(false)
      expect(f.raw("ls-files", "--stage", "-z")).toEqual(index)
    }),
  )

  it.effect("refuses whole-file and line discard when durable backup storage fails", () =>
    Effect.gen(function* () {
      const f = fixture()
      f.write("tracked", "precious\n")
      f.write("new", "untracked\n")
      writeFileSync(join(f.root, ".git/gitui-discard-backups"), "blocked")
      const r = yield* Repo
      expect((yield* Effect.result(r.discard(id(f.root), [p("tracked"), p("new")])))._tag).toBe("Failure")
      expect(
        (yield* Effect.result(
          r.applyLines(id(f.root), "discard", p("tracked"), [
            { side: "old", line: 1, text: "base" },
            { side: "new", line: 1, text: "precious" },
          ]),
        ))._tag,
      ).toBe("Failure")
      expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("precious\n")
      expect(readFileSync(join(f.root, "new"), "utf8")).toBe("untracked\n")
    }),
  )

  it.effect("scopes backups to their worktree and refuses traversal, directories and replaced parent symlinks", () =>
    Effect.gen(function* () {
      const f = fixture()
      const linked = `${f.root}-linked`
      f.git("worktree", "add", "-q", "-b", "linked", linked)
      const r = yield* Repo
      f.write("dir/file", "private\n")
      const backup = yield* r.discard(id(f.root), [p("dir/file")])
      expect(yield* r.discardRecovery(id(linked))).toEqual([])
      expect((yield* Effect.result(r.restoreDiscard(id(linked), backup!.id, null)))._tag).toBe("Failure")
      expect((yield* Effect.result(r.discard(id(f.root), [p("../escape")])))._tag).toBe("Failure")
      expect((yield* Effect.result(r.discard(id(f.root), [p(".git/config")])))._tag).toBe("Failure")
      expect((yield* Effect.result(r.discard(id(f.root), [p("dir")])))._tag).toBe("Failure")
      const outside = `${f.root}-outside`
      mkdirSync(outside)
      writeFileSync(join(outside, "file"), "outside\n")
      f.git("clean", "-fd", "dir")
      symlinkSync(outside, join(f.root, "dir"))
      expect((yield* Effect.result(r.restoreDiscard(id(f.root), backup!.id, null)))._tag).toBe("Failure")
      expect(readFileSync(join(outside, "file"), "utf8")).toBe("outside\n")
    }),
  )

  it.effect(
    "bounds retention without following backup symlinks or deleting live paths",
    () =>
      Effect.gen(function* () {
        const f = fixture()
        const r = yield* Repo
        for (let i = 0; i < 103; i++) {
          f.write("tracked", `edit ${i}\n`)
          yield* r.discard(id(f.root), [p("tracked")])
        }
        expect(yield* r.discardRecovery(id(f.root))).toHaveLength(100)
        const directory = join(f.root, ".git/gitui-discard-backups")
        expect(readdirSync(directory)).toHaveLength(100)
        symlinkSync(join(f.root, "tracked"), join(directory, "1000000000000-000000000000000000000000.json"))
        f.write("tracked", "live\n")
        expect((yield* Effect.result(r.discard(id(f.root), [p("tracked")])))._tag).toBe("Failure")
        expect(readFileSync(join(f.root, "tracked"), "utf8")).toBe("live\n")
      }),
    30000,
  )
})
