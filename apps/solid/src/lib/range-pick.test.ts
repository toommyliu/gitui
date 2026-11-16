import { describe, expect, it } from "vite-plus/test"
import { rangeKeys } from "./range-pick"

const order = ["a", "b", "c", "d", "e"]

describe("rangeKeys", () => {
  it("picks one row without Shift", () => {
    expect(rangeKeys(order, "a", "d", false)).toEqual(["d"])
  })

  it("picks every row between the last click and this one with Shift, in either direction", () => {
    expect(rangeKeys(order, "b", "d", true)).toEqual(["b", "c", "d"])
    expect(rangeKeys(order, "e", "c", true)).toEqual(["c", "d", "e"])
  })

  it("falls back to one row when there is no earlier click or it left the list", () => {
    expect(rangeKeys(order, null, "c", true)).toEqual(["c"])
    expect(rangeKeys(order, "gone", "c", true)).toEqual(["c"])
  })
})
