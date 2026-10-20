import { describe, expect, it } from "vite-plus/test"
import { addRecent } from "./places"

describe("addRecent", () => {
  it("moves a path to the front without listing it twice", () => {
    expect(addRecent(["/a", "/b", "/c"], "/c")).toEqual(["/c", "/a", "/b"])
    expect(addRecent(["/a", "/b"], "/new")).toEqual(["/new", "/a", "/b"])
  })

  it("drops the least recent path once the list is full", () => {
    const full = Array.from({ length: 50 }, (_, index) => `/${index}`)
    const next = addRecent(full, "/new")
    expect(next).toHaveLength(50)
    expect(next[0]).toBe("/new")
    expect(next).not.toContain("/49")
  })
})
