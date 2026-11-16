import { allRefsVisible } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { toggleLocation } from "@/lib/visibility"
import { rowVisibility } from "./model"

describe("rowVisibility", () => {
  it("hides a whole remote and dims its branches without offering a toggle on them", () => {
    const remote = rowVisibility("remote-group:upstream", allRefsVisible, "main")
    expect(remote).toEqual({
      dimmed: false,
      toggle: { hidden: false, location: { section: "remotes", name: "upstream" } },
    })

    const hidden = toggleLocation(allRefsVisible, { section: "remotes", name: "upstream" })
    expect(hidden.hiddenRemotes).toEqual(["upstream"])
    expect(rowVisibility("remote-group:upstream", hidden, "main").toggle?.hidden).toBe(true)
    expect(rowVisibility("remote:upstream/main", hidden, "main")).toEqual({ dimmed: true, toggle: null })
    expect(rowVisibility("remote:origin/main", hidden, "main").dimmed).toBe(false)

    expect(toggleLocation(hidden, { section: "remotes", name: "upstream" }).hiddenRemotes).toEqual([])
  })

  it("never hides the checked-out branch or worktrees", () => {
    const noBranches = toggleLocation(allRefsVisible, { section: "branches" })
    expect(rowVisibility("local:main", noBranches, "main")).toEqual({ dimmed: false, toggle: null })
    expect(rowVisibility("local:feature", noBranches, "main")).toEqual({ dimmed: true, toggle: null })
    expect(rowVisibility("section:worktrees", noBranches, "main").toggle).toBeNull()
  })

  it("dims tags with their section", () => {
    const noTags = toggleLocation(allRefsVisible, { section: "tags" })
    expect(rowVisibility("section:tags", noTags, null).toggle?.hidden).toBe(true)
    expect(rowVisibility("tag:v1", noTags, null)).toEqual({ dimmed: true, toggle: null })
  })
})
