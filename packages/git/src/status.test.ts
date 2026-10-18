import { describe, expect, it } from "@effect/vitest"
import { parseStatus, statusArgs } from "./status.ts"
import { makeRepo } from "./testRepo.ts"

const status = (repo: ReturnType<typeof makeRepo>) => parseStatus(repo.raw(...statusArgs))

describe("parseStatus", () => {
  it("reports an unborn branch with a staged file", () => {
    const repo = makeRepo()
    repo.write("a.txt", "a\n")
    repo.git("add", "a.txt")
    expect(status(repo)).toEqual({
      head: { _tag: "Unborn", name: "main" },
      upstream: null,
      entries: [{ _tag: "Tracked", path: "a.txt", from: null, staged: "added", unstaged: null, submodule: false }],
    })
  })

  it("keeps staged and unstaged changes to the same file apart", () => {
    const repo = makeRepo()
    repo.write("a.txt", "a\n")
    repo.git("add", "a.txt")
    const oid = repo.commit("init")
    repo.write("a.txt", "staged\n")
    repo.git("add", "a.txt")
    repo.write("a.txt", "working\n")
    expect(status(repo)).toEqual({
      head: { _tag: "Branch", name: "main", oid },
      upstream: null,
      entries: [{ _tag: "Tracked", path: "a.txt", from: null, staged: "modified", unstaged: "modified", submodule: false }],
    })
  })

  it("reads renames and paths containing spaces, newlines and glob characters", () => {
    const repo = makeRepo()
    repo.write("old name.txt", "same content\n")
    repo.git("add", ".")
    repo.commit("init")
    repo.git("mv", "old name.txt", "new name.txt")
    repo.write("odd\nname*.txt", "x\n")
    expect(status(repo).entries).toEqual([
      { _tag: "Tracked", path: "new name.txt", from: "old name.txt", staged: "renamed", unstaged: null, submodule: false },
      { _tag: "Untracked", path: "odd\nname*.txt" },
    ])
  })

  it("reports a detached head and an upstream's ahead/behind counts", () => {
    const repo = makeRepo()
    const base = repo.commit("base")
    repo.git("branch", "feature")
    repo.commit("main only")
    repo.git("switch", "-q", "feature")
    repo.commit("feature 1")
    repo.commit("feature 2")
    repo.git("branch", "--set-upstream-to=main")
    expect(status(repo).upstream).toEqual({ name: "main", ahead: 2, behind: 1 })
    repo.git("switch", "-q", "--detach", base)
    expect(status(repo).head).toEqual({ _tag: "Detached", oid: base })
  })

  it("reports conflicts with their two-letter code", () => {
    const repo = makeRepo()
    repo.write("a.txt", "base\n")
    repo.git("add", ".")
    repo.commit("base")
    repo.git("switch", "-q", "-c", "other")
    repo.write("a.txt", "other\n")
    repo.git("commit", "-q", "-am", "other")
    repo.git("switch", "-q", "main")
    repo.write("a.txt", "main\n")
    repo.git("commit", "-q", "-am", "main")
    expect(() => repo.git("merge", "-q", "other")).toThrow()
    expect(status(repo).entries).toEqual([{ _tag: "Conflicted", path: "a.txt", code: "UU" }])
  })
})
