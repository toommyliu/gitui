import type { GraphRow } from "@gitui/contracts"
import { memo } from "react"

export const ROW_HEIGHT = 26
export const LANE_WIDTH = 14
export const MAX_LANES = 24
export const VISIBLE_LANES = 10

const MID = ROW_HEIGHT / 2
const x = (lane: number) => LANE_WIDTH / 2 + lane * LANE_WIDTH

export const laneColor = (color: number) => `var(--lane-${color % 8})`

export const lanesUsed = (row: GraphRow) => {
  let max = row.lane
  for (let i = 0; i < row.up.length; i += 3) max = Math.max(max, row.up[i]!, row.up[i + 1]!)
  for (let i = 0; i < row.down.length; i += 3) max = Math.max(max, row.down[i]!, row.down[i + 1]!)
  return max + 1
}

const segment = (from: number, to: number, y1: number, y2: number) => {
  if (from === to) return `M${x(from)} ${y1}V${y2}`
  const ym = (y1 + y2) / 2
  return `M${x(from)} ${y1}C${x(from)} ${ym} ${x(to)} ${ym} ${x(to)} ${y2}`
}

const edges = (flat: ReadonlyArray<number>, y1: number, y2: number) => {
  const paths = []
  for (let i = 0; i < flat.length; i += 3) {
    const from = flat[i]!
    const to = flat[i + 1]!
    if (from >= MAX_LANES && to >= MAX_LANES) continue
    paths.push(
      <path
        key={`${y1}-${i}`}
        d={segment(Math.min(from, MAX_LANES), Math.min(to, MAX_LANES), y1, y2)}
        stroke={laneColor(flat[i + 2]!)}
      />,
    )
  }
  return paths
}

export const GraphCell = memo(function GraphCell({
  row,
  width,
  merge,
  head,
}: {
  row: GraphRow
  width: number
  merge: boolean
  head: boolean
}) {
  const color = laneColor(row.color)
  const cx = x(Math.min(row.lane, MAX_LANES))
  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0 overflow-visible" aria-hidden>
      <g fill="none" strokeWidth={2}>
        {edges(row.up, 0, MID)}
        {edges(row.down, MID, ROW_HEIGHT)}
      </g>
      {merge ? (
        <circle cx={cx} cy={MID} r={3.5} fill="var(--background)" stroke={color} strokeWidth={2} />
      ) : (
        <circle cx={cx} cy={MID} r={4} fill={color} />
      )}
      {head && <circle cx={cx} cy={MID} r={6.5} fill="none" stroke={color} strokeWidth={1.5} />}
    </svg>
  )
})
