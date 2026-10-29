import { describe, expect, it } from "vite-plus/test"
import { hiddenLocationTop, locationBeyond, nearestBeyond, READING_SLOP, sideRuns } from "./diff-nav"

const at = (positions: ReadonlyArray<number>) => (index: number) => positions[index]!

const HUNKS = [32, 400, 900]

describe("stepping to the next location in a diff", () => {
  it("skips the hunk already at the reading line going forward", () => {
    expect(locationBeyond(HUNKS.length, at(HUNKS), 33, 1)).toBe(1)
  })

  it("goes back to the start of the hunk being read", () => {
    expect(locationBeyond(HUNKS.length, at(HUNKS), 599, -1)).toBe(1)
  })

  it("does not count a hunk sitting exactly on the edge as past it", () => {
    expect(locationBeyond(HUNKS.length, at(HUNKS), 400, 1)).toBe(2)
    expect(locationBeyond(HUNKS.length, at(HUNKS), 400, -1)).toBe(0)
  })

  it("stops past the last hunk and before the first", () => {
    expect(locationBeyond(HUNKS.length, at(HUNKS), 901, 1)).toBeNull()
    expect(locationBeyond(HUNKS.length, at(HUNKS), 31, -1)).toBeNull()
    expect(locationBeyond(0, at([]), 0, 1)).toBeNull()
  })

  it("lands on the first of several matches that share a line", () => {
    const matches = [100, 250, 250, 250, 400]
    expect(locationBeyond(matches.length, at(matches), 249, 1)).toBe(1)
    expect(locationBeyond(matches.length, at(matches), 251, 1)).toBe(4)
    expect(locationBeyond(matches.length, at(matches), 250, -1)).toBe(0)
  })

  it("finds the neighbours of the reading line among thousands of matches", () => {
    const position = (index: number) => index * 20
    expect(locationBeyond(10_000, position, 50_001, 1)).toBe(2501)
    expect(locationBeyond(10_000, position, 50_000, -1)).toBe(2499)
  })
})

const HEADER = 32

describe("stepping through hunks of a collapsed file", () => {
  const collapsedAtTop = hiddenLocationTop(0, HEADER)
  const reading = HEADER

  it("enters the first hunk of a collapsed file whose header sits at the reading line", () => {
    const hunks = [collapsedAtTop, collapsedAtTop, 64, 400]
    expect(locationBeyond(hunks.length, at(hunks), reading + READING_SLOP, 1)).toBe(0)
    expect(locationBeyond(hunks.length, at(hunks), reading - READING_SLOP, -1)).toBeNull()
  })

  it("steps to the next hunk once that file is open at its first hunk", () => {
    const hunks = [32, 300, 700]
    expect(locationBeyond(hunks.length, at(hunks), reading + READING_SLOP, 1)).toBe(1)
  })

  it("goes back into the last hunk of a collapsed file above", () => {
    const hunks = [collapsedAtTop, collapsedAtTop, 600]
    expect(locationBeyond(hunks.length, at(hunks), 600 - READING_SLOP, -1)).toBe(1)
  })
})

describe("finding the nearest match in a split diff", () => {
  const sides = sideRuns([
    { side: "deletions" },
    { side: "deletions" },
    { side: "additions" },
    { side: "additions" },
    { side: "additions" },
  ])
  const tops = at([32, 412, 32, 52, 72])
  const edge = 232 - READING_SLOP

  it("picks the deletion further down over earlier additions going forward", () => {
    expect(nearestBeyond(sides, tops, edge, 1)).toBe(1)
  })

  it("picks the closest match above going back", () => {
    expect(nearestBeyond(sides, tops, edge, -1)).toBe(4)
  })

  it("wraps to the top and bottom matches on screen order", () => {
    expect(nearestBeyond(sides, tops, 500, 1)).toBeNull()
    expect(nearestBeyond(sides, tops, Number.NEGATIVE_INFINITY, 1)).toBe(0)
    expect(nearestBeyond(sides, tops, Number.POSITIVE_INFINITY, -1)).toBe(1)
  })

  it("breaks ties on one row by match order in the direction of travel", () => {
    const row = sideRuns([{ side: "deletions" }, { side: "additions" }])
    expect(nearestBeyond(row, at([52, 52]), 0, 1)).toBe(0)
    expect(nearestBeyond(row, at([52, 52]), 100, -1)).toBe(1)
  })
})
