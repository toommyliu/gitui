import { describe, expect, it } from "vite-plus/test"
import { activeAfterClose, cycleTab } from "./tabs"

const tabs = ["/a", "/b", "/c", "/d"]

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
