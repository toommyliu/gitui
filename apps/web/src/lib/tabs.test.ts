import { describe, expect, it } from "vite-plus/test"
import { activeAfterClose, closeTab, cycleTab, openTab, reopenTab, type TabState, tabNumber } from "./tabs"

const tabs = ["/a", "/b", "/c", "/d"]

describe("closed tabs", () => {
  const initial: TabState = { tabs, active: "/b", closed: [] }

  it("reopens and activates a background tab at its former position", () => {
    const closed = closeTab(initial, "/c")
    expect(closed.tabs).toEqual(["/a", "/b", "/d"])
    expect(closed.active).toBe("/b")

    const restored = reopenTab(closed)
    expect(restored.tabs).toEqual(["/a", "/b", "/c", "/d"])
    expect(restored.active).toBe("/c")
  })

  it("restores tabs in reverse close order, including from an empty tab strip", () => {
    let state: TabState = { tabs: ["/a", "/b"], active: "/a", closed: [] }
    state = closeTab(closeTab(state, "/a"), "/b")
    expect(state.tabs).toEqual([])
    expect(state.active).toBe(null)

    state = reopenTab(state)
    expect(state.tabs).toEqual(["/b"])
    expect(state.active).toBe("/b")
    state = reopenTab(state)
    expect(state.tabs).toEqual(["/a", "/b"])
    expect(state.active).toBe("/a")
    expect(reopenTab(state)).toEqual(state)
  })

  it("skips a manually reopened tab without duplicating it or losing older history", () => {
    let state = closeTab(closeTab(initial, "/b"), "/c")
    state = openTab(state, "/c")
    expect(state.tabs).toEqual(["/a", "/d", "/c"])
    state = reopenTab(state)
    expect(state.tabs).toEqual(["/a", "/b", "/d", "/c"])
    expect(state.active).toBe("/b")
    expect(reopenTab(state)).toEqual(state)
  })

  it("appends a restored tab when its former position is past the remaining tabs", () => {
    let state = closeTab(initial, "/d")
    state = { ...state, tabs: ["/a"], active: "/a" }
    state = reopenTab(state)
    expect(state.tabs).toEqual(["/a", "/d"])
    expect(state.active).toBe("/d")
  })

  it("does nothing when no tab has been closed or the path is not open", () => {
    expect(reopenTab(initial)).toEqual(initial)
    expect(closeTab(initial, "/missing")).toEqual(initial)
  })

  it("retains the 20 most recently closed tabs", () => {
    const paths = Array.from({ length: 21 }, (_, index) => `/repo-${index}`)
    let state: TabState = { tabs: paths, active: paths[0]!, closed: [] }
    for (const path of paths) state = closeTab(state, path)
    const restored = []
    for (let index = 0; index < 20; index++) {
      state = reopenTab(state)
      restored.push(state.active)
    }
    expect(restored).toEqual([
      "/repo-20",
      "/repo-19",
      "/repo-18",
      "/repo-17",
      "/repo-16",
      "/repo-15",
      "/repo-14",
      "/repo-13",
      "/repo-12",
      "/repo-11",
      "/repo-10",
      "/repo-9",
      "/repo-8",
      "/repo-7",
      "/repo-6",
      "/repo-5",
      "/repo-4",
      "/repo-3",
      "/repo-2",
      "/repo-1",
    ])
    expect(reopenTab(state)).toEqual(state)
  })
})

describe("openTab", () => {
  const initial: TabState = { tabs, active: "/a", closed: [] }

  it("activates an already open tab without moving or duplicating it", () => {
    const state = openTab(initial, "/c")
    expect(state.tabs).toEqual(["/a", "/b", "/c", "/d"])
    expect(state.active).toBe("/c")
  })

  it("opens worktrees after adjacent family tabs", () => {
    const state = openTab(initial, "/new", ["/a", "/b", "/new"])
    expect(state.tabs).toEqual(["/a", "/b", "/new", "/c", "/d"])
    expect(state.active).toBe("/new")
  })
})

describe("activeAfterClose", () => {
  it("activates the tab to the right of the closed active tab", () => {
    expect(activeAfterClose(tabs, "/b", "/b")).toBe("/c")
    expect(activeAfterClose(tabs, "/a", "/a")).toBe("/b")
  })

  it("activates the tab to the left when the closed active tab is last", () => {
    expect(activeAfterClose(tabs, "/d", "/d")).toBe("/c")
  })

  it("keeps the current tab when closing a background tab", () => {
    expect(activeAfterClose(tabs, "/a", "/c")).toBe("/a")
    expect(activeAfterClose(tabs, null, "/c")).toBe(null)
  })

  it("falls back to the picker when the only tab closes", () => {
    expect(activeAfterClose(["/a"], "/a", "/a")).toBe(null)
  })
})

describe("cycleTab", () => {
  it("moves to the neighbouring tab and wraps around", () => {
    expect(cycleTab(tabs, "/b", 1)).toBe("/c")
    expect(cycleTab(tabs, "/b", -1)).toBe("/a")
    expect(cycleTab(tabs, "/d", 1)).toBe("/a")
    expect(cycleTab(tabs, "/a", -1)).toBe("/d")
  })

  it("leaves the picker for the first or last tab", () => {
    expect(cycleTab(tabs, null, 1)).toBe("/a")
    expect(cycleTab(tabs, null, -1)).toBe("/d")
  })

  it("stays on the picker when no tabs are open", () => {
    expect(cycleTab([], null, 1)).toBe(null)
    expect(cycleTab([], null, -1)).toBe(null)
  })
})

describe("tabNumber", () => {
  const numbers = (count: number) => Array.from({ length: count }, (_, index) => tabNumber(count, index))

  it("numbers every tab when nine or fewer are open", () => {
    expect(numbers(3)).toEqual([1, 2, 3])
    expect(numbers(9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it("gives 9 to the last tab and skips the ones between", () => {
    expect(numbers(11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, undefined, undefined, 9])
  })
})
