import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { describe, expect, it, layer } from "@effect/vitest"
import type { Oid, RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { makeRepo } from "./testRepo.ts"
import { Worktrees, parseBase } from "./worktree.ts"

const id = (root: string) => root as RepoId
const name = (path: string) => path.split("/").pop()

const fixture = () => {
  const repo = makeRepo()
  repo.write("a.txt", "one\ntwo\n")
  repo.git("add", ".")
  const base = repo.commit("base")

  repo.git("switch", "-q", "-c", "landed")
  repo.write("a.txt", "one\nTWO\n")
  repo.git("add", ".")
  const picked = repo.commit("capitalize two")
  repo.git("switch", "-q", "main")
  repo.git("cherry-pick", picked)
  const main = repo.git("rev-parse", "HEAD")

  const landed = `${repo.root}-landed`
  repo.git("worktree", "add", "-q", landed, "landed")

  const work = `${repo.root}-work`
  repo.git("worktree", "add", "-q", "-b", "work", work, base)
  writeFileSync(join(work, "a.txt"), "one\nmine\n")
  writeFileSync(join(work, "new.txt"), "fresh\n")

  const ahead = `${repo.root}-ahead`
  repo.git("worktree", "add", "-q", "-b", "ahead", ahead)
  writeFileSync(join(ahead, "c.txt"), "c\n")
  repo.git("-C", ahead, "add", "c.txt")
  repo.git("-C", ahead, "commit", "-q", "-m", "add c")
  const aheadCommit = repo.git("-C", ahead, "rev-parse", "HEAD")

  return { repo, base, picked, main, landed, work, ahead, aheadCommit }
}

layer(Worktrees.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Worktrees", (it) => {
  it.effect("counts each worktree's uncommitted files and the commits main doesn't have yet", () =>
    Effect.gen(function* () {
      const { repo } = fixture()
      const summaries = yield* (yield* Worktrees).summaries(id(repo.root))
      const byName = Object.fromEntries(summaries.map(({ path, ...rest }) => [name(path), rest]))
      expect(byName).toEqual({
        [name(repo.root)!]: { changes: 0, commits: 0, paths: [] },
        [`${name(repo.root)}-landed`]: { changes: 0, commits: 0, paths: [] },
        [`${name(repo.root)}-work`]: { changes: 2, commits: 0, paths: ["a.txt", "new.txt"] },
        [`${name(repo.root)}-ahead`]: { changes: 0, commits: 1, paths: ["c.txt"] },
      })
    }),
  )

  it.effect("names the main commit that a cherry-picked branch commit became", () =>
    Effect.gen(function* () {
      const { base, picked, main, landed, ahead, aheadCommit } = fixture()
      const worktrees = yield* Worktrees

      const landedDetail = yield* worktrees.detail(id(landed))
      expect(landedDetail.base).toEqual({ name: "main", oid: main })
      expect(landedDetail.mergeBase).toBe(base)
      expect(landedDetail.behind).toBe(1)
      expect(landedDetail.unique).toBe(0)
      expect(landedDetail.commits.map(({ oid, subject, landed }) => ({ oid, subject, landed }))).toEqual([
        { oid: picked, subject: "capitalize two", landed: main },
      ])

      const aheadDetail = yield* worktrees.detail(id(ahead))
      expect(aheadDetail.behind).toBe(0)
      expect(aheadDetail.unique).toBe(1)
      expect(aheadDetail.commits.map(({ oid, landed }) => ({ oid, landed }))).toEqual([
        { oid: aheadCommit, landed: null },
      ])
    }),
  )

  it.effect("reports uncommitted files with the newest edit time", () =>
    Effect.gen(function* () {
      const { work } = fixture()
      const detail = yield* (yield* Worktrees).detail(id(work))
      expect(detail.entries.map((entry) => [entry._tag, entry.path])).toEqual([
        ["Tracked", "a.txt"],
        ["Untracked", "new.txt"],
      ])
      expect(detail.editedAt).toBeGreaterThan(Date.now() / 1000 - 60)
    }),
  )

  it.effect("diffs tracked and untracked changes against HEAD in one patch", () =>
    Effect.gen(function* () {
      const { work, landed } = fixture()
      const worktrees = yield* Worktrees
      const diff = yield* worktrees.diff(id(work))
      expect(diff._tag).toBe("Patch")
      const files =
        diff._tag === "Patch" ? [...diff.patch.matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)].map((m) => m[1]) : []
      expect(files).toEqual(["a.txt", "new.txt"])
      expect(yield* worktrees.diff(id(landed))).toEqual({ _tag: "Empty" })
    }),
  )

  it.effect("finds merge conflicts with main without touching the worktree's index or refs", () =>
    Effect.gen(function* () {
      const { repo, main, work, ahead } = fixture()
      const worktrees = yield* Worktrees
      const status = () => repo.git("-C", work, "status", "--porcelain=v2", "--untracked-files=all")
      const refs = () => repo.git("for-each-ref")
      const before = { status: status(), refs: refs() }

      expect(yield* worktrees.checkMerge(id(work), main as Oid)).toEqual({ _tag: "Conflicts", paths: ["a.txt"] })
      expect({ status: status(), refs: refs() }).toEqual(before)
      expect(yield* worktrees.checkMerge(id(ahead), main as Oid)).toEqual({ _tag: "Clean" })
    }),
  )

  it.effect("replays only the commits main lacks, so a landed commit main edited later doesn't conflict", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const lines = (changed: Record<number, string>) =>
        Array.from({ length: 10 }, (_, i) => `${changed[i] ?? `line ${i}`}\n`).join("")
      repo.write("a.txt", lines({}))
      repo.git("add", ".")
      repo.commit("base")
      repo.git("switch", "-q", "-c", "landed")
      repo.write("a.txt", lines({ 1: "LINE 1" }))
      repo.git("add", ".")
      const picked = repo.commit("shout line 1")
      repo.git("switch", "-q", "main")
      repo.git("cherry-pick", picked)
      repo.write("a.txt", lines({ 1: "Line one" }))
      repo.git("add", ".")
      const main = repo.commit("soften line 1")
      const landed = `${repo.root}-landed`
      repo.git("worktree", "add", "-q", landed, "landed")
      writeFileSync(join(landed, "a.txt"), lines({ 1: "LINE 1", 8: "LINE 8" }))

      expect(yield* (yield* Worktrees).checkMerge(id(landed), main as Oid)).toEqual({ _tag: "Clean" })
      writeFileSync(join(landed, "a.txt"), lines({ 1: "LINE ONE", 8: "LINE 8" }))
      expect(yield* (yield* Worktrees).checkMerge(id(landed), main as Oid)).toEqual({
        _tag: "Conflicts",
        paths: ["a.txt"],
      })
    }),
  )
})

describe("parseBase", () => {
  const line = (ref: string, oid: string, symref = "") => `${ref}\0${oid}\0${symref}`

  it("prefers the local branch that origin/HEAD points at", () => {
    const out = [
      line("refs/heads/main", "1"),
      line("refs/heads/trunk", "2"),
      line("refs/remotes/origin/HEAD", "3", "refs/remotes/origin/trunk"),
      line("refs/remotes/origin/trunk", "3"),
    ].join("\n")
    expect(parseBase(out)).toEqual({ name: "trunk", oid: "2" })
  })

  it("uses the remote branch when there is no local one, then main or master", () => {
    expect(
      parseBase(
        [
          line("refs/remotes/origin/HEAD", "3", "refs/remotes/origin/trunk"),
          line("refs/remotes/origin/trunk", "3"),
        ].join("\n"),
      ),
    ).toEqual({ name: "origin/trunk", oid: "3" })
    expect(parseBase(line("refs/heads/master", "4"))).toEqual({ name: "master", oid: "4" })
    expect(parseBase(line("refs/heads/feature", "5"))).toBeNull()
  })
})
