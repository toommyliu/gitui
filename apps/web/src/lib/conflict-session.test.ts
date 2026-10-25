import type { RepoPath } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { parseSegments } from "./conflict-blocks"
import { dirtyPaths, dropDraft, emptySession, nextUnresolved, withFiles } from "./conflict-session"

const paths = (...names: Array<string>) => names as Array<RepoPath>

describe("finishing a draft action", () => {
  const path = "a.txt" as RepoPath
  const submitted = { version: "1", baseline: "base\n", segments: parseSegments("submitted\n") }

  it("clears the submitted draft once its action finishes", () => {
    const session = { ...emptySession, drafts: new Map([[path, submitted]]) }
    expect(dirtyPaths(dropDraft(path, submitted)(session))).toEqual([])
  })

  it("keeps edits made after submitting a save or whole-file choice", () => {
    const newer = { ...submitted, segments: parseSegments("newer unsaved edit\n") }
    const session = { ...emptySession, drafts: new Map([[path, newer]]) }
    const finished = dropDraft(path, submitted)(session)
    expect(dirtyPaths(finished)).toEqual(["a.txt"])
    expect(finished.drafts.get(path)?.segments[0]?.text).toBe("newer unsaved edit\n")
  })

  it("keeps a draft created while saving an initially unedited file", () => {
    const session = { ...emptySession, drafts: new Map([[path, submitted]]) }
    expect(dirtyPaths(dropDraft(path, undefined)(session))).toEqual(["a.txt"])
  })
})

describe("listing a session's files", () => {
  it("keeps resolved files in place and appends new conflicts", () => {
    expect(withFiles(paths("a", "b", "c"), paths("c", "d"))).toEqual(["a", "b", "c", "d"])
  })

  it("returns the same list when nothing new conflicts", () => {
    const files = paths("a", "b")
    expect(withFiles(files, paths("b"))).toBe(files)
  })

  it("lists a file once when both Git and an unsaved draft report it", () => {
    expect(withFiles([], paths("a", "b", "a"))).toEqual(["a", "b"])
  })
})

describe("moving to the next unresolved file", () => {
  const files = paths("a", "b", "c", "d")
  const open = new Set(paths("a", "d"))

  it("looks after the current file first, then wraps around", () => {
    expect(nextUnresolved(files, (p) => open.has(p), "b" as RepoPath)).toBe("d")
    expect(nextUnresolved(files, (p) => open.has(p), "d" as RepoPath)).toBe("a")
  })

  it("has nowhere to go once everything is resolved", () => {
    expect(nextUnresolved(files, () => false, "a" as RepoPath)).toBeNull()
  })
})

describe("finding unsaved drafts", () => {
  it("counts only drafts that differ from the file they started from", () => {
    const baseline = "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> topic\n"
    const segments = parseSegments(baseline)
    const session = {
      ...emptySession,
      drafts: new Map([
        ["clean" as RepoPath, { version: "1", baseline, segments }],
        ["edited" as RepoPath, { version: "1", baseline, segments: [{ ...segments[0]!, text: "a\n" }] }],
      ]),
    }
    expect(dirtyPaths(session)).toEqual(["edited"])
  })
})
