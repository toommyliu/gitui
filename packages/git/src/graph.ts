import type { GraphRow } from "@gitui/contracts"

export class GraphLayout {
  private readonly lanes: Array<string | null> = []
  private readonly colors: Array<number> = []
  private nextColor = 0

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
    this.lanes[lane] = first ?? null
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
    return { lane, color, up, down }
  }

  private claim(): number {
    const free = this.lanes.indexOf(null)
    if (free !== -1) return free
    this.lanes.push(null)
    return this.lanes.length - 1
  }
}
