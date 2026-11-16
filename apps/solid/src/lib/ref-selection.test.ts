import { describe, expect, it } from "vite-plus/test"
import { type RefSelection, selectRef, single } from "./ref-selection"

const order = ["local:a", "local:b", "local:c", "remote:origin/a", "remote:origin/b", "tag:v1"]
const sectionOf = (key: string) => key.split(":")[0]

const select = (from: RefSelection, key: string, how: "replace" | "toggle" | "range") =>
  selectRef({ from, key, how, order, sectionOf })

const marked = (selection: RefSelection) => [...selection.marked].toSorted()

describe("ref selection", () => {
  it("replaces the selection on a plain click", () => {
    const next = select(
      { current: "local:a", marked: new Set(["local:a", "local:b"]), anchor: "local:a" },
      "local:c",
      "replace",
    )
    expect(next).toEqual(single("local:c"))
  })

  it("adds and removes rows with a toggle", () => {
    const added = select(single("local:a"), "local:c", "toggle")
    expect(marked(added)).toEqual(["local:a", "local:c"])
    expect(added.current).toBe("local:c")
    const removed = select(added, "local:c", "toggle")
    expect(marked(removed)).toEqual(["local:a"])
    expect(removed.current).toBe("local:a")
  })

  it("keeps the last row selected when it's toggled off", () => {
    expect(select(single("local:a"), "local:a", "toggle")).toEqual(single("local:a"))
  })

  it("selects a range from the anchor in either direction", () => {
    expect(marked(select(single("local:a"), "local:c", "range"))).toEqual(["local:a", "local:b", "local:c"])
    expect(marked(select(single("local:c"), "local:a", "range"))).toEqual(["local:a", "local:b", "local:c"])
  })

  it("extends a range from the last toggled row and keeps that anchor", () => {
    const toggled = select(single("remote:origin/a"), "remote:origin/b", "toggle")
    const ranged = select(toggled, "remote:origin/a", "range")
    expect(marked(ranged)).toEqual(["remote:origin/a", "remote:origin/b"])
    expect(ranged.anchor).toBe("remote:origin/b")
  })

  it("starts over when a toggle or range crosses into another section", () => {
    const locals = select(single("local:a"), "local:b", "toggle")
    expect(select(locals, "tag:v1", "toggle")).toEqual(single("tag:v1"))
    expect(select(locals, "remote:origin/a", "range")).toEqual(single("remote:origin/a"))
  })

  it("starts over when the anchor is no longer in the list", () => {
    expect(select(single("local:gone"), "local:b", "range")).toEqual(single("local:b"))
  })
})
