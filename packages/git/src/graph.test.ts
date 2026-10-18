import { describe, expect, it } from "@effect/vitest"
import { GraphLayout } from "./graph.ts"

const edges = (flat: ReadonlyArray<number>) => {
  const out: Array<string> = []
  for (let i = 0; i < flat.length; i += 3) out.push(`${flat[i]}->${flat[i + 1]} c${flat[i + 2]}`)
  return out.sort()
}

const layout = (commits: ReadonlyArray<[string, ReadonlyArray<string>]>) => {
  const graph = new GraphLayout()
  return commits.map(([oid, parents]) => {
    const row = graph.push(oid, parents)
    return { oid, lane: row.lane, color: row.color, up: edges(row.up), down: edges(row.down) }
  })
}

describe("GraphLayout", () => {
  it("keeps linear history in one lane", () => {
    expect(
      layout([
        ["c", ["b"]],
        ["b", ["a"]],
        ["a", []],
      ]),
    ).toEqual([
      { oid: "c", lane: 0, color: 0, up: [], down: ["0->0 c0"] },
      { oid: "b", lane: 0, color: 0, up: ["0->0 c0"], down: ["0->0 c0"] },
      { oid: "a", lane: 0, color: 0, up: ["0->0 c0"], down: [] },
    ])
  })

  it("opens a lane for a merge's second parent and closes it at the fork point", () => {
    expect(
      layout([
        ["m", ["a", "b"]],
        ["a", ["base"]],
        ["b", ["base"]],
        ["base", []],
      ]),
    ).toEqual([
      { oid: "m", lane: 0, color: 0, up: [], down: ["0->0 c0", "0->1 c1"] },
      { oid: "a", lane: 0, color: 0, up: ["0->0 c0", "1->1 c1"], down: ["0->0 c0", "1->1 c1"] },
      { oid: "b", lane: 1, color: 1, up: ["0->0 c0", "1->1 c1"], down: ["0->0 c0", "1->1 c1"] },
      { oid: "base", lane: 0, color: 0, up: ["0->0 c0", "1->0 c1"], down: [] },
    ])
  })

  it("starts unrelated branch tips in new lanes and reuses freed lanes", () => {
    expect(
      layout([
        ["x", ["base"]],
        ["y", ["base"]],
        ["base", []],
        ["z", []],
      ]),
    ).toEqual([
      { oid: "x", lane: 0, color: 0, up: [], down: ["0->0 c0"] },
      { oid: "y", lane: 1, color: 1, up: ["0->0 c0"], down: ["0->0 c0", "1->1 c1"] },
      { oid: "base", lane: 0, color: 0, up: ["0->0 c0", "1->0 c1"], down: [] },
      { oid: "z", lane: 0, color: 2, up: [], down: [] },
    ])
  })
})
