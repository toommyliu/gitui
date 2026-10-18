import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { Oid, RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const id = (root: string) => root as RepoId
const p = (path: string) => path as RepoPath

layer(Repo.layer.pipe(Layer.provide(NodeServices.layer)))("Repo", (it) => {
  it.effect("pages the log in order across many commits", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      for (let i = 0; i < 300; i++) repo.commit(`commit ${i}`)
      const expected = repo.git("log", "--format=%H").split("\n")
      const r = yield* Repo

      const handle = yield* r.openLog(id(repo.root))
      const first = yield* r.logPage(id(repo.root), handle.logId, 0, 100)
      const last = yield* r.logPage(id(repo.root), handle.logId, 250, 100)
      expect(handle.total).toBe(300)
      expect(first.map((row) => row.oid)).toEqual(expected.slice(0, 100))
      expect(last.map((row) => row.oid)).toEqual(expected.slice(250))
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
})
