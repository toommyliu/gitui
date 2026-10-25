import type { RepoPath } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { click, reconcile } from "./file-selection"

const row = (path: string, area: string) => ({ path: path as RepoPath, area })
const readme = row("README.md", "conflicted")
const notes = row("notes.txt", "untracked")
const config = row("src/config.ts", "conflicted")
const app = row("src/app.ts", "unstaged")
const lists = (...unstaged: Array<ReturnType<typeof row>>) => ({ unstaged, staged: [] })

const selectedAfter = (path: string, before: ReturnType<typeof lists>, after: ReturnType<typeof lists>) =>
  reconcile(click(null, before, "unstaged", path as RepoPath, "only"), after)?.lead ?? null

describe("keeping a selection when its file leaves the list", () => {
  it("moves from a resolved conflict to the next conflict, skipping other files", () => {
    expect(selectedAfter("README.md", lists(readme, notes, config), lists(notes, config))).toBe("src/config.ts")
  })

  it("moves back to an earlier conflict when the resolved one was the last", () => {
    expect(selectedAfter("src/config.ts", lists(readme, notes, config), lists(readme, notes))).toBe("README.md")
  })

  it("moves to a neighbouring file once no conflicts are left", () => {
    expect(selectedAfter("src/config.ts", lists(notes, config), lists(notes))).toBe("notes.txt")
  })

  it("moves from a staged file to the next file, conflicted or not", () => {
    expect(selectedAfter("notes.txt", lists(notes, config, app), lists(config, app))).toBe("src/config.ts")
    expect(selectedAfter("src/app.ts", lists(readme, notes, app), lists(readme, notes))).toBe("notes.txt")
  })
})
