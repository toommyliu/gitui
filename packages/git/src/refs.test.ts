import { join } from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { parseStashes, parseWorktrees, stashArgs, worktreeArgs } from "./refs.ts"
import { makeRepo } from "./testRepo.ts"

describe("refs parsers", () => {
  it("reads stashes newest first", () => {
    const repo = makeRepo()
    repo.write("a.txt", "a\n")
    repo.git("add", ".")
    repo.commit("base")
    repo.write("a.txt", "one\n")
    repo.git("stash", "push", "-q", "-m", "first")
    repo.write("a.txt", "two\n")
    repo.git("stash", "push", "-q", "-m", "second")
    expect(parseStashes(repo.raw(...stashArgs)).map((s) => [s.oid, s.message])).toEqual([
      [repo.git("rev-parse", "stash@{0}"), "On main: second"],
      [repo.git("rev-parse", "stash@{1}"), "On main: first"],
    ])
  })

  it("reads linked worktrees with lock reasons and detached heads", () => {
    const repo = makeRepo()
    const base = repo.commit("base")
    const linked = join(repo.root, "..", `${repo.root.split("/").pop()}-feat`)
    const detached = join(repo.root, "..", `${repo.root.split("/").pop()}-detached`)
    repo.git("worktree", "add", "-q", "-b", "feat", linked)
    repo.git("worktree", "lock", "--reason", "agent running", linked)
    repo.git("worktree", "add", "-q", "--detach", detached, base)
    const worktrees = parseWorktrees(repo.raw(...worktreeArgs))
    expect(worktrees.map((w) => ({ ...w, path: w.path.split("/").pop() }))).toEqual([
      {
        path: repo.root.split("/").pop(),
        head: { _tag: "Branch", name: "main", oid: base },
        isMain: true,
        locked: null,
        prunable: null,
      },
      {
        path: detached.split("/").pop(),
        head: { _tag: "Detached", oid: base },
        isMain: false,
        locked: null,
        prunable: null,
      },
      {
        path: linked.split("/").pop(),
        head: { _tag: "Branch", name: "feat", oid: base },
        isMain: false,
        locked: "agent running",
        prunable: null,
      },
    ])
  })
})
