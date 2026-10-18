import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { LogParser, logArgs } from "../src/log.ts"
import { forEachRefArgs, parseRefs, parseRemotes, parseStashes, parseWorktrees, remotesArgs, stashArgs, worktreeArgs } from "../src/refs.ts"
import { makeRepo } from "./fixture.ts"

describe("LogParser", () => {
  it("parses a log streamed one byte at a time", () => {
    const repo = makeRepo()
    const a = repo.commit("first")
    const b = repo.commit("second: with \"quotes\" and ünïcode")
    const bytes = repo.raw(...logArgs(true))
    const parser = new LogParser()
    const rows = []
    for (const byte of bytes) rows.push(...parser.push(Uint8Array.of(byte)))
    rows.push(...parser.flush())
    expect(rows.map((r) => [r.oid, r.parents, r.subject, r.author, r.time])).toEqual([
      [b, [a], "second: with \"quotes\" and ünïcode", "Ada", Number(repo.git("show", "-s", "--format=%at", b))],
      [a, [], "first", "Ada", Number(repo.git("show", "-s", "--format=%at", a))],
    ])
  })
})

describe("refs parsers", () => {
  it("reads branches with upstream state, remote branches and peeled tags", () => {
    const repo = makeRepo()
    const base = repo.commit("base")
    repo.git("remote", "add", "origin", "git@example.com:a/b.git")
    repo.git("update-ref", "refs/remotes/origin/main", base)
    repo.git("update-ref", "refs/remotes/origin/feature/x", base)
    repo.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
    repo.git("branch", "--set-upstream-to=origin/main")
    const tip = repo.commit("ahead")
    repo.git("tag", "-a", "v1", "-m", "release", base)
    repo.git("branch", "stale", base)
    repo.git("update-ref", "refs/remotes/origin/stale", base)
    repo.git("branch", "--set-upstream-to=origin/stale", "stale")
    repo.git("update-ref", "-d", "refs/remotes/origin/stale")

    const remotes = parseRemotes(repo.raw(...remotesArgs))
    expect(remotes).toEqual([{ name: "origin", url: "git@example.com:a/b.git" }])
    expect(parseRefs(repo.raw(...forEachRefArgs), remotes)).toEqual({
      branches: [
        { name: "main", oid: tip, upstream: { _tag: "Tracking", name: "origin/main", ahead: 1, behind: 0 } },
        { name: "stale", oid: base, upstream: { _tag: "Gone", name: "origin/stale" } },
      ],
      remoteBranches: [
        { remote: "origin", name: "origin/feature/x", oid: base },
        { remote: "origin", name: "origin/main", oid: base },
      ],
      tags: [{ name: "v1", oid: base }],
    })
  })

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
      { path: repo.root.split("/").pop(), head: { _tag: "Branch", name: "main", oid: base }, isMain: true, locked: null, prunable: null },
      { path: detached.split("/").pop(), head: { _tag: "Detached", oid: base }, isMain: false, locked: null, prunable: null },
      { path: linked.split("/").pop(), head: { _tag: "Branch", name: "feat", oid: base }, isMain: false, locked: "agent running", prunable: null },
    ])
  })
})
