import type { Oid, RepoPath, Status, StatusEntry } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { stashBlocked, stashFiles } from "./stash"

const path = (value: string) => value as RepoPath

const status = (entries: ReadonlyArray<StatusEntry>, operation: Status["operation"] = null): Status => ({
  head: { _tag: "Branch", name: "main", oid: "a".repeat(40) as Oid },
  upstream: null,
  operation,
  entries,
})

const tracked = (name: string, change: Partial<Extract<StatusEntry, { _tag: "Tracked" }>>): StatusEntry => ({
  _tag: "Tracked",
  path: path(name),
  from: null,
  staged: null,
  unstaged: null,
  submodule: false,
  ...change,
})

const entries: ReadonlyArray<StatusEntry> = [
  tracked("edited.ts", { unstaged: "modified" }),
  tracked("new.ts", { from: path("old.ts"), staged: "renamed", unstaged: "modified" }),
  { _tag: "Untracked", path: path("notes.md") },
  tracked("other.ts", { staged: "modified" }),
]

describe("stashing selected files", () => {
  it("sends only the selected files and both sides of a rename", () => {
    expect(stashFiles(status(entries), new Set([path("new.ts"), path("notes.md")]))).toEqual({
      files: ["new.ts", "notes.md"],
      paths: ["old.ts", "new.ts", "notes.md"],
      untracked: 1,
      staged: true,
    })
  })
  it("reports no staged changes when the selection has none", () => {
    expect(stashFiles(status(entries), new Set([path("edited.ts")]))).toEqual({
      files: ["edited.ts"],
      paths: ["edited.ts"],
      untracked: 0,
      staged: false,
    })
  })
  it("leaves out conflicted files", () => {
    const conflicted = status([...entries, { _tag: "Conflicted", path: path("both.ts"), code: "UU" }])
    expect(stashFiles(conflicted, new Set([path("both.ts")])).paths).toEqual([])
  })
})

describe("blocking stash", () => {
  it("allows a stash on a clean branch", () => {
    expect(stashBlocked(status(entries))).toBe(false)
  })
  it("blocks while an operation is in progress", () => {
    expect(stashBlocked(status(entries, "rebase"))).toBe(true)
  })
  it("blocks while conflicts remain without an operation", () => {
    expect(stashBlocked(status([{ _tag: "Conflicted", path: path("both.ts"), code: "UU" }]))).toBe(true)
  })
})
