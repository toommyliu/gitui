import { type BaseRef, type Branch, Oid, type Worktree } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { branchCleanup, suggestedBranch } from "./branch-cleanup"

const oid = Oid.make("a".repeat(40))
const main: BaseRef = { name: "main", oid }

const branch = (name: string, upstream: Branch["upstream"] = null): Branch => ({ name, oid, upstream })
const gone = (name: string) =>
  branch(name, { _tag: "Gone", ref: `refs/remotes/origin/${name}`, name: `origin/${name}` })
const tracking = (name: string) =>
  branch(name, { _tag: "Tracking", ref: `refs/remotes/origin/${name}`, name: `origin/${name}`, ahead: 0, behind: 0 })

const worktree = (path: string, name: string): Worktree => ({
  path,
  head: { _tag: "Branch", name, oid },
  isMain: false,
  locked: null,
  prunable: null,
})

const cleanup = (options: Partial<Parameters<typeof branchCleanup>[0]> & { branches: ReadonlyArray<Branch> }) =>
  branchCleanup({ merged: new Set(), base: main, head: "main", worktrees: [], ...options })

const names = (list: ReadonlyArray<{ branch: Branch }>) => list.map((entry) => entry.branch.name)

describe("branch cleanup", () => {
  it("offers merged branches and branches whose upstream is gone, and nothing else", () => {
    const { candidates } = cleanup({
      branches: [branch("main"), branch("done"), gone("abandoned"), tracking("active"), branch("local-only")],
      merged: new Set(["main", "done"]),
    })
    expect(candidates).toEqual([
      { branch: branch("done"), staleness: { _tag: "Merged" } },
      { branch: gone("abandoned"), staleness: { _tag: "Gone" } },
    ])
  })

  it("checks merged branches by default and leaves gone ones unchecked", () => {
    expect(suggestedBranch({ _tag: "Merged" })).toBe(true)
    expect(suggestedBranch({ _tag: "Gone" })).toBe(false)
  })

  it("calls a gone branch merged when its commits are on the base", () => {
    const { candidates } = cleanup({ branches: [gone("landed")], merged: new Set(["landed"]) })
    expect(candidates.map((entry) => entry.staleness._tag)).toEqual(["Merged"])
  })

  it("never offers the base branch, even when the base is its remote copy", () => {
    const { candidates, held } = cleanup({
      branches: [branch("main"), branch("done")],
      merged: new Set(["main", "done"]),
      base: { name: "origin/main", oid },
      head: "done",
    })
    expect(candidates).toEqual([])
    expect(names(held)).toEqual(["done"])
  })

  it("holds back the current branch and branches checked out in a worktree", () => {
    const { candidates, held } = cleanup({
      branches: [branch("here"), branch("there"), gone("free")],
      merged: new Set(["here", "there"]),
      head: "here",
      worktrees: [worktree("/repo-there", "there")],
    })
    expect(names(candidates)).toEqual(["free"])
    expect(held.map((entry) => [entry.branch.name, entry.held])).toEqual([
      ["here", { _tag: "Current" }],
      ["there", { _tag: "Worktree", path: "/repo-there" }],
    ])
  })

  it("offers only gone branches when there's no base to compare with", () => {
    const { candidates } = cleanup({ branches: [branch("feature"), gone("old")], base: null, head: null })
    expect(names(candidates)).toEqual(["old"])
  })
})
