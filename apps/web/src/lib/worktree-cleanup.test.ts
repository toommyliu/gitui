import type { Branch, Oid, Worktree, WorktreeSummary } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import {
  bulkSelectable,
  cleanupCandidates,
  nothingPicked,
  pickWorktree,
  selectable,
  suggested,
} from "./worktree-cleanup"

const oid = "a".repeat(40) as Oid

const worktree = (path: string, branch: string | null, extra: Partial<Worktree> = {}): Worktree => ({
  path,
  head: branch === null ? { _tag: "Detached", oid } : { _tag: "Branch", name: branch, oid },
  isMain: false,
  locked: null,
  prunable: null,
  ...extra,
})

const summary = (path: string, changes: number, commits: number | null): WorktreeSummary => ({
  path,
  changes,
  commits,
  paths: [],
})

const gone = (name: string): Branch => ({
  name,
  oid,
  upstream: { _tag: "Gone", ref: `refs/remotes/origin/${name}`, name },
})

const classifyOne = (tree: Worktree, sum: WorktreeSummary | undefined, branches: ReadonlyArray<Branch> = []) =>
  cleanupCandidates([tree], sum === undefined ? [] : [sum], branches, "/repo")[0]!.staleness

describe("worktree cleanup", () => {
  it("leaves out the main worktree and the one this tab has open", () => {
    const main = worktree("/repo", "main", { isMain: true })
    const current = worktree("/repo-wt", "feat")
    expect(cleanupCandidates([main, current], [], [], "/repo-wt")).toEqual([])
  })

  it("suggests a worktree with nothing of its own", () => {
    const staleness = classifyOne(worktree("/a", "feat"), summary("/a", 0, 0))
    expect(staleness._tag).toBe("Landed")
    expect(suggested(staleness)).toBe(true)
  })

  it("suggests a clean worktree whose branch was deleted on the remote, keeping its commit count", () => {
    const staleness = classifyOne(worktree("/a", "feat"), summary("/a", 0, 3), [gone("feat")])
    expect(staleness).toEqual({ _tag: "Gone", commits: 3 })
    expect(suggested(staleness)).toBe(true)
  })

  it("offers but doesn't suggest a worktree with unmerged commits", () => {
    const staleness = classifyOne(worktree("/a", "feat"), summary("/a", 0, 2))
    expect(staleness).toEqual({ _tag: "Unmerged", commits: 2 })
    expect(suggested(staleness)).toBe(false)
    expect(selectable(staleness)).toBe(true)
  })

  it("offers a worktree with uncommitted changes but never suggests it or selects it in bulk", () => {
    const staleness = classifyOne(worktree("/a", "feat"), summary("/a", 4, 0), [gone("feat")])
    expect(staleness).toEqual({ _tag: "Dirty", changes: 4, commits: 0 })
    expect(selectable(staleness)).toBe(true)
    expect(suggested(staleness)).toBe(false)
    expect(bulkSelectable(staleness)).toBe(false)
  })

  it("suggests a worktree whose folder is missing before it has a summary", () => {
    const staleness = classifyOne(
      worktree("/a", "feat", { prunable: "gitdir file points to non-existent location" }),
      undefined,
    )
    expect(staleness._tag).toBe("Missing")
    expect(suggested(staleness)).toBe(true)
  })

  it("keeps locked worktrees and ones still being checked out of reach", () => {
    expect(selectable(classifyOne(worktree("/a", "feat", { locked: "" }), summary("/a", 0, 0)))).toBe(false)
    expect(selectable(classifyOne(worktree("/a", "feat"), undefined))).toBe(false)
  })
})

describe("picking several worktrees", () => {
  const order = ["/a", "/b", "/c", "/d"]

  it("adds to the worktree already open when Cmd-clicking another", () => {
    expect([...pickWorktree(nothingPicked, order, "/c", "toggle", "/a").paths]).toEqual(["/a", "/c"])
  })

  it("toggles a picked worktree back off", () => {
    const picked = pickWorktree({ paths: new Set(["/a", "/c"]), anchor: "/c" }, order, "/c", "toggle", "/a")
    expect([...picked.paths]).toEqual(["/a"])
  })

  it("picks the range from the last clicked worktree when Shift-clicking", () => {
    const start = pickWorktree(nothingPicked, order, "/b", "only", null)
    expect([...pickWorktree(start, order, "/d", "extend", "/b").paths]).toEqual(["/b", "/c", "/d"])
  })

  it("clears the picks on a plain click", () => {
    const picked = pickWorktree({ paths: new Set(["/a", "/b"]), anchor: "/b" }, order, "/c", "only", "/a")
    expect(picked.paths.size).toBe(0)
  })
})
