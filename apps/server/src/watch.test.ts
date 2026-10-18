import { join } from "node:path"
import { describe, expect, it } from "@effect/vitest"
import type { RepoId, RepoInfo } from "@gitui/contracts"
import { classify } from "./watch.ts"

const root = "/work/repo"
const repo: RepoInfo = { id: root as RepoId, name: "repo", gitDir: join(root, ".git"), commonDir: join(root, ".git") }

describe("classify", () => {
  it("separates draft saves from ref, index and worktree changes", () => {
    expect(classify(repo, join(root, ".git", "GITUI_MSG"))).toBe("draft")
    expect(classify(repo, join(root, ".git", "index"))).toBe("index")
    expect(classify(repo, join(root, ".git", "refs", "heads", "main"))).toBe("refs")
    expect(classify(repo, join(root, ".git", "index.lock"))).toBe(null)
    expect(classify(repo, join(root, "src", "a.ts"))).toBe("worktree")
  })
})
