import type { Person } from "@/lib/trailers"
import { laneColor } from "./history/graph"

const hue = (text: string) => {
  let sum = 0
  for (let index = 0; index < text.length; index++) sum += text.charCodeAt(index)
  return sum
}

export function Avatar(props: { person: Person; layer: number; large?: boolean; class?: string | undefined }) {
  return (
    <span
      class={[
        "relative flex shrink-0 items-center justify-center rounded-full font-semibold text-white uppercase",
        props.large === true ? "size-6 text-[11px]" : "size-4 text-[9px] ring-2 ring-(--avatar-ring,var(--background))",
        props.class,
      ]}
      style={{ background: laneColor(hue(props.person.name)), "z-index": props.layer }}
      aria-hidden="true"
    >
      {props.person.name.trim().charAt(0)}
    </span>
  )
}
