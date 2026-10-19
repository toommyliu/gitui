import type { GraphRow } from "@gitui/contracts"

export const MAX_GRAPH_LANES = 24

export interface GraphState {
  readonly lanes: ReadonlyArray<string | null>
  readonly colors: ReadonlyArray<number>
  readonly nextColor: number
}

const clip = (edges: Array<number>) => {
  const out: Array<number> = []
  for (let i = 0; i < edges.length; i += 3) {
    const from = edges[i]!
    const to = edges[i + 1]!
    if (from >= MAX_GRAPH_LANES && to >= MAX_GRAPH_LANES) continue
    out.push(Math.min(from, MAX_GRAPH_LANES), Math.min(to, MAX_GRAPH_LANES), edges[i + 2]!)
  }
  return out
}

export class GraphLayout {
  private readonly lanes: Array<string | null>
  private readonly colors: Array<number>
  private nextColor: number

  constructor(state: GraphState = { lanes: [], colors: [], nextColor: 0 }) {
    this.lanes = [...state.lanes]
    this.colors = [...state.colors]
    this.nextColor = state.nextColor
  }

  state(): GraphState {
    return { lanes: [...this.lanes], colors: [...this.colors], nextColor: this.nextColor }
  }

  push(oid: string, parents: ReadonlyArray<string>): GraphRow {
    const up: Array<number> = []
    const down: Array<number> = []

    let lane = this.lanes.indexOf(oid)
    if (lane === -1) {
      lane = this.claim()
      this.colors[lane] = this.nextColor++
    }

    for (let j = 0; j < this.lanes.length; j++) {
      const expected = this.lanes[j]
      if (expected === null) continue
      if (expected === oid) {
        up.push(j, lane, this.colors[j]!)
        if (j !== lane) this.lanes[j] = null
      } else {
        up.push(j, j, this.colors[j]!)
      }
    }

    const color = this.colors[lane]!
    const [first, ...rest] = parents
    const joined = first === undefined ? -1 : this.lanes.indexOf(first)
    if (joined === -1) {
      this.lanes[lane] = first ?? null
    } else {
      this.lanes[lane] = null
      down.push(lane, joined, color)
    }
    const opened = new Set<number>()
    for (const parent of rest) {
      let target = this.lanes.indexOf(parent)
      if (target === -1) {
        target = this.claim()
        this.lanes[target] = parent
        this.colors[target] = this.nextColor++
        opened.add(target)
      }
      down.push(lane, target, this.colors[target]!)
    }

    for (let j = 0; j < this.lanes.length; j++) {
      if (this.lanes[j] === null || opened.has(j)) continue
      down.push(j, j, this.colors[j]!)
    }

    while (this.lanes.length > 0 && this.lanes[this.lanes.length - 1] === null) {
      this.lanes.pop()
      this.colors.pop()
    }
    return { lane: Math.min(lane, MAX_GRAPH_LANES), color, up: clip(up), down: clip(down) }
  }

  private claim(): number {
    const free = this.lanes.indexOf(null)
    if (free !== -1) return free
    this.lanes.push(null)
    return this.lanes.length - 1
  }
}
