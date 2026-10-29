import type { SelectionSide } from "@pierre/diffs"

export const READING_SLOP = 1

export const hiddenLocationTop = (itemTop: number, headerHeight: number) => itemTop + headerHeight + 2 * READING_SLOP

export const locationBeyond = (
  count: number,
  position: (index: number) => number,
  edge: number,
  delta: 1 | -1,
): number | null => {
  let low = 0
  let high = count
  while (low < high) {
    const middle = (low + high) >>> 1
    if (delta === 1 ? position(middle) <= edge : position(middle) < edge) low = middle + 1
    else high = middle
  }
  const index = delta === 1 ? low : low - 1
  return index >= 0 && index < count ? index : null
}

export const sideRuns = (locations: ReadonlyArray<{ readonly side: SelectionSide }>) => {
  const deletions: Array<number> = []
  const additions: Array<number> = []
  locations.forEach(({ side }, index) => (side === "deletions" ? deletions : additions).push(index))
  return [deletions, additions]
}

export const nearestBeyond = (
  runs: ReadonlyArray<ReadonlyArray<number>>,
  position: (index: number) => number,
  edge: number,
  delta: 1 | -1,
): number | null => {
  let best: number | null = null
  for (const run of runs) {
    const found = locationBeyond(run.length, (i) => position(run[i]!), edge, delta)
    const index = found === null ? undefined : run[found]
    if (index === undefined) continue
    if (best === null) {
      best = index
      continue
    }
    const gap = (position(index) - position(best)) * delta
    if (gap < 0 || (gap === 0 && (index - best) * delta < 0)) best = index
  }
  return best
}
