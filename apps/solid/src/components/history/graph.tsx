import type { GraphRow } from "@gitui/contracts"
import { For } from "solid-js"

export const LANE_WIDTH = 12
export const MAX_LANES = 8

export const laneColor = (color: number) => `var(--lane-${color % 8})`

const x = (lane: number) => LANE_WIDTH / 2 + lane * LANE_WIDTH

const edgesOf = (flat: ReadonlyArray<number>) => {
  const edges: Array<{ from: number; to: number; color: number }> = []
  for (let i = 0; i + 2 < flat.length; i += 3)
    edges.push({ from: flat[i] ?? 0, to: flat[i + 1] ?? 0, color: flat[i + 2] ?? 0 })
  return edges
}

const segment = (from: number, to: number, y1: number, y2: number) => {
  if (from === to) return `M${x(from)} ${y1}V${y2}`
  const middle = (y1 + y2) / 2
  return `M${x(from)} ${y1}C${x(from)} ${middle} ${x(to)} ${middle} ${x(to)} ${y2}`
}

export function GraphCell(props: { row: GraphRow; width: number; height: number; merge: boolean }) {
  const middle = () => props.height / 2
  return (
    <svg width={props.width} height={props.height} class="shrink-0" aria-hidden="true">
      <g fill="none" stroke-width="1.5">
        <For each={edgesOf(props.row.up)}>
          {(edge) => <path d={segment(edge.from, edge.to, 0, middle())} stroke={laneColor(edge.color)} />}
        </For>
        <For each={edgesOf(props.row.down)}>
          {(edge) => <path d={segment(edge.from, edge.to, middle(), props.height)} stroke={laneColor(edge.color)} />}
        </For>
      </g>
      {props.merge ? (
        <circle
          cx={x(props.row.lane)}
          cy={middle()}
          r="3"
          fill="var(--background)"
          stroke={laneColor(props.row.color)}
          stroke-width="1.5"
        />
      ) : (
        <circle cx={x(props.row.lane)} cy={middle()} r="3.5" fill={laneColor(props.row.color)} />
      )}
    </svg>
  )
}
