import type { FileHistory, FileHistoryEntry, Oid, RepoPath } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { fileVersions } from "./file-versions"

const entry = (oid: string, change: FileHistoryEntry["change"], path: string, from: string | null = null) => ({
  oid: oid as Oid,
  parent: `${oid}-parent` as Oid,
  path: path as RepoPath,
  from: from as RepoPath | null,
  change,
  author: "Ada",
  time: 0,
  subject: `${change} ${path}`,
})

const history: FileHistory = {
  revision: "head" as Oid,
  path: "src/new.ts" as RepoPath,
  entries: [
    entry("c3", "modified", "src/new.ts"),
    entry("c2", "renamed", "src/new.ts", "src/old.ts"),
    entry("c1", "added", "src/old.ts"),
  ],
  truncated: false,
}

const sources = (atHead: boolean, from = history) =>
  fileVersions(from, atHead).map((version) => [version._tag, version.source.revision, version.source.path])

describe("listing the versions of a file", () => {
  it("reads each commit at the path the file had in that commit", () => {
    expect(sources(false)).toEqual([
      ["Requested", "head", "src/new.ts"],
      ["Commit", "c3", "src/new.ts"],
      ["Commit", "c2", "src/new.ts"],
      ["Commit", "c1", "src/old.ts"],
    ])
  })

  it("starts with the committed version at HEAD when investigating HEAD", () => {
    expect(sources(true)[0]).toEqual(["Head", "head", "src/new.ts"])
    expect(sources(true)).toHaveLength(4)
  })

  it("shows a deleted file as it was in the deleting commit's parent", () => {
    const deleted = {
      ...history,
      revision: "c4" as Oid,
      entries: [entry("c4", "deleted", "src/new.ts"), ...history.entries],
    }
    expect(sources(false, deleted)[0]).toEqual(["BeforeDeletion", "c4-parent", "src/new.ts"])
  })

  it("starts with the requested commit when the history doesn't list it, such as a merge", () => {
    const merge = { ...history, revision: "merge" as Oid }
    expect(sources(false, merge).slice(0, 2)).toEqual([
      ["Requested", "merge", "src/new.ts"],
      ["Commit", "c3", "src/new.ts"],
    ])
  })

  it("doesn't repeat the requested commit when the history lists it", () => {
    expect(sources(false, { ...history, revision: "c3" as Oid })).toEqual([
      ["Commit", "c3", "src/new.ts"],
      ["Commit", "c2", "src/new.ts"],
      ["Commit", "c1", "src/old.ts"],
    ])
  })

  it("keys versions apart when one commit appears at two paths", () => {
    const copied = {
      ...history,
      revision: "c5" as Oid,
      entries: [entry("c5", "modified", "a.ts"), entry("c5", "modified", "b.ts")],
    }
    const keys = fileVersions(copied, false).map((version) => version.key)
    expect(new Set(keys).size).toBe(2)
  })
})
