import type { SelectHow } from "@/components/file-tree"

export interface RefSelection {
  readonly current: string
  readonly marked: ReadonlySet<string>
  readonly anchor: string
}

export const single = (key: string): RefSelection => ({ current: key, marked: new Set([key]), anchor: key })

export const selectRef = (options: {
  readonly from: RefSelection
  readonly key: string
  readonly how: SelectHow
  readonly order: ReadonlyArray<string>
  readonly sectionOf: (key: string) => string | undefined
}): RefSelection => {
  const { from, key, how, order, sectionOf } = options
  const section = sectionOf(key)
  if (how === "replace" || sectionOf(from.anchor) !== section) return single(key)
  if (how === "range") {
    const start = order.indexOf(from.anchor)
    const end = order.indexOf(key)
    if (start === -1 || end === -1) return single(key)
    const range = order
      .slice(Math.min(start, end), Math.max(start, end) + 1)
      .filter((value) => sectionOf(value) === section)
    return { current: key, marked: new Set(range), anchor: from.anchor }
  }
  const marked = new Set([...from.marked].filter((value) => sectionOf(value) === section))
  if (marked.has(key)) marked.delete(key)
  else marked.add(key)
  const last = [...marked].at(-1)
  if (last === undefined) return single(key)
  return { current: marked.has(key) ? key : last, marked, anchor: key }
}
