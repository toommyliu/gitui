/// <reference types="node" />
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePatchFiles } from "@pierre/diffs"
import { afterAll, describe, expect, it } from "vite-plus/test"
import { diffMatches, filterFiles, hunkLocations, stepMatch } from "./change-search"

const repo = mkdtempSync(join(tmpdir(), "gitui-change-search-"))
const git = (...args: Array<string>) => execFileSync("git", args, { cwd: repo, encoding: "utf8" })
git("init", "--quiet")
git("config", "user.name", "Search fixture")
git("config", "user.email", "search@example.test")
const before = Array.from({ length: 1200 }, (_, i) => `line ${i + 1}`)
before[2] = "old needle"
before[999] = "distant needle"
writeFileSync(join(repo, "long.txt"), before.join("\n") + "\n")
writeFileSync(join(repo, "removed.txt"), "last needle\n")
git("add", ".")
git("commit", "--quiet", "-m", "fixture")
const after = [...before]
after[2] = "new NEEDLE needle"
after[998] = "literal .* token"
after[999] = "far needle"
writeFileSync(join(repo, "long.txt"), after.join("\n") + "\n")
rmSync(join(repo, "removed.txt"))
const items = parsePatchFiles(git("diff", "--no-ext-diff", "--no-color", "--unified=1")).flatMap((patch) =>
  patch.files.map((fileDiff) => ({ id: fileDiff.name, fileDiff })),
)
afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe("find in the complete parsed diff", () => {
  it("finds old and new text across offscreen hunks and files in diff order", () => {
    expect(diffMatches(items, "needle")).toEqual([
      { id: "long.txt", lineNumber: 3, side: "deletions", start: 4, end: 10 },
      { id: "long.txt", lineNumber: 3, side: "additions", start: 4, end: 10 },
      { id: "long.txt", lineNumber: 3, side: "additions", start: 11, end: 17 },
      { id: "long.txt", lineNumber: 1000, side: "deletions", start: 8, end: 14 },
      { id: "long.txt", lineNumber: 1000, side: "additions", start: 4, end: 10 },
      { id: "removed.txt", lineNumber: 1, side: "deletions", start: 5, end: 11 },
    ])
  })

  it("searches literal text, counts context once, and leaves staging metadata intact", () => {
    expect(diffMatches(items, ".*")).toEqual([
      { id: "long.txt", lineNumber: 999, side: "additions", start: 8, end: 10 },
    ])
    expect(diffMatches(items, "line 2")).toEqual([
      { id: "long.txt", lineNumber: 2, side: "additions", start: 0, end: 6 },
    ])
    const original = JSON.stringify(items)
    diffMatches(items, "needle")
    expect(JSON.stringify(items)).toBe(original)
    expect(diffMatches(items, "absent")).toEqual([])
    expect(diffMatches(items, "")).toEqual([])
  })

  it("locates hunks across files including a deleted file", () => {
    expect(hunkLocations(items)).toEqual([
      { id: "long.txt", lineNumber: 2, side: "additions" },
      { id: "long.txt", lineNumber: 998, side: "additions" },
      { id: "removed.txt", lineNumber: 1, side: "deletions" },
    ])
  })

  it("wraps forward and backward and handles an empty or new search", () => {
    expect(stepMatch(3, null, 1)).toBe(0)
    expect(stepMatch(3, null, -1)).toBe(2)
    expect(stepMatch(3, 2, 1)).toBe(0)
    expect(stepMatch(3, 0, -1)).toBe(2)
    expect(stepMatch(0, null, 1)).toBeNull()
  })
})

describe("filename filtering", () => {
  const files = [
    { path: "src/New.ts", from: "lib/Old.ts" },
    { path: "README.md", from: null },
  ]
  it("matches paths and rename sources without changing the source list", () => {
    expect(filterFiles(files, " SRC/ ")).toEqual([{ path: "src/New.ts", from: "lib/Old.ts" }])
    expect(filterFiles(files, "old.ts")).toEqual([{ path: "src/New.ts", from: "lib/Old.ts" }])
    expect(filterFiles(files, "missing")).toEqual([])
    expect(filterFiles(files, " ")).toBe(files)
    expect(files).toHaveLength(2)
  })
})
