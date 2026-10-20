import { describe, expect, it } from "vite-plus/test"
import { activeAfterClose } from "./tabs"

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
