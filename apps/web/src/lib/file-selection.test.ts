import type { RepoPath } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { click, move, reconcile, selectAll, selectedRows, visibleSelection } from "./file-selection"

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

describe("selection in filtered file lists", () => {
  it("drops hidden selections without selecting another file for a mutation", () => {
    const all = lists(notes, config, app)
    const filtered = lists(config, app)
    const selection = click(null, all, "unstaged", notes.path, "only")
    expect(visibleSelection(selection, filtered)).toBeNull()
    expect(selectedRows(visibleSelection(selection, filtered), filtered)).toEqual([])
  })

  it("keeps visible selections and moves and extends only through visible files", () => {
    const filtered = lists(notes, app)
    const selection = visibleSelection(selectAll(lists(notes, config, app), "unstaged"), filtered)
    expect(selectedRows(selection, filtered).map((row) => row.path)).toEqual(["notes.txt", "src/app.ts"])
    const first = click(null, filtered, "unstaged", notes.path, "only")
    expect(move(first, filtered, "unstaged", 1, false)?.lead).toBe("src/app.ts")
    expect(selectedRows(move(first, filtered, "unstaged", 1, true), filtered).map((row) => row.path)).toEqual([
      "notes.txt",
      "src/app.ts",
    ])
  })

  it("reanchors a partially hidden selection to a selected visible file", () => {
    const selection = selectAll(lists(notes, config, app), "unstaged")
    const kept = visibleSelection(selection, lists(config))
    expect(kept?.lead).toBe("src/config.ts")
    expect(kept?.anchor).toBe("src/config.ts")
    expect(kept?.leadIndex).toBe(0)
  })
})
