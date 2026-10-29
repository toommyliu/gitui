import type { RepoPath, StatusEntry } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { headTarget } from "./head-target"

const tracked = (path: string, from: string | null, staged: "added" | "renamed" | null): StatusEntry => ({
  _tag: "Tracked",
  path: path as RepoPath,
  from: from as RepoPath | null,
  staged,
  unstaged: null,
  submodule: false,
})

const entries = [tracked("new.txt", "old.txt", "renamed"), tracked("fresh.txt", null, "added")]

describe("opening a picked file at HEAD", () => {
  it("reads a staged rename's history at its old path and restores to its new path", () => {
    expect(headTarget(entries, "new.txt" as RepoPath)).toEqual({
      revision: "HEAD",
      path: "old.txt",
      destination: "new.txt",
    })
  })

  it("keeps a clean file's own path", () => {
    expect(headTarget(entries, "src/app.ts" as RepoPath)).toEqual({ revision: "HEAD", path: "src/app.ts" })
  })

  it("keeps a staged new file's path so HEAD can report it missing", () => {
    expect(headTarget(entries, "fresh.txt" as RepoPath)).toEqual({ revision: "HEAD", path: "fresh.txt" })
  })
})
