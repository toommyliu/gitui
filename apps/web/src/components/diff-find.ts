import type { PostRenderPhase, SelectionSide } from "@pierre/diffs"
import type { CodeViewHandle } from "@pierre/diffs/react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import type { DiffMatch } from "@/lib/change-search"

export const FIND_HIGHLIGHT = "gitui-find"
export const CURRENT_FIND_HIGHLIGHT = "gitui-find-current"

let registered: { readonly all: Highlight; readonly current: Highlight } | undefined

const highlights = () => {
  if (registered === undefined) {
    const all = new Highlight()
    const current = new Highlight()
    current.priority = 1
    CSS.highlights.set(FIND_HIGHLIGHT, all)
    CSS.highlights.set(CURRENT_FIND_HIGHLIGHT, current)
    registered = { all, current }
  }
  return registered
}

interface LineMatch {
  readonly index: number
  readonly start: number
  readonly end: number
}

type LineKey = `${SelectionSide}:${number}`
type LineMatches = ReadonlyMap<LineKey, ReadonlyArray<LineMatch>>
type ItemMatches = ReadonlyMap<string, LineMatches>

const byLine = (matches: ReadonlyArray<DiffMatch>): ItemMatches => {
  const items = new Map<string, Map<LineKey, Array<LineMatch>>>()
  matches.forEach(({ id, side, lineNumber, start, end }, index) => {
    const lines = items.get(id) ?? new Map<LineKey, Array<LineMatch>>()
    items.set(id, lines)
    const key: LineKey = `${side}:${lineNumber}`
    const line = lines.get(key)
    if (line === undefined) lines.set(key, [{ index, start, end }])
    else line.push({ index, start, end })
  })
  return items
}

const textRange = (line: Element, start: number, end: number): StaticRange | null => {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
  let offset = 0
  let from: { readonly node: Node; readonly offset: number } | null = null
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0
    if (from === null && start < offset + length) from = { node, offset: start - offset }
    if (from !== null && end <= offset + length) {
      return new StaticRange({
        startContainer: from.node,
        startOffset: from.offset,
        endContainer: node,
        endOffset: end - offset,
      })
    }
    offset += length
  }
  return null
}

type Painted = Map<Element, ReadonlyArray<StaticRange>>

const erase = (painted: Painted, element: Element) => {
  const ranges = painted.get(element)
  if (ranges === undefined) return
  const { all, current } = highlights()
  for (const range of ranges) {
    all.delete(range)
    current.delete(range)
  }
  painted.delete(element)
}

const paint = (painted: Painted, element: Element, lines: LineMatches | undefined, current: number | null) => {
  erase(painted, element)
  const root = element.shadowRoot
  if (lines === undefined || root === null) return
  const { all, current: currentHighlight } = highlights()
  const ranges: Array<StaticRange> = []
  for (const line of root.querySelectorAll<HTMLElement>("[data-line]")) {
    const deletion = line.closest("[data-deletions]") !== null || line.dataset.lineType === "change-deletion"
    const key: LineKey = `${deletion ? "deletions" : "additions"}:${Number(line.dataset.line)}`
    for (const match of lines.get(key) ?? []) {
      const range = textRange(line, match.start, match.end)
      if (range === null) continue
      ranges.push(range)
      ;(match.index === current ? currentHighlight : all).add(range)
    }
  }
  painted.set(element, ranges)
}

export const useMatchHighlights = (
  view: CodeViewHandle<undefined, undefined> | null,
  matches: ReadonlyArray<DiffMatch>,
  current: number | null,
) => {
  const painted = useRef<Painted>(new Map())
  const items = useMemo(() => byLine(matches), [matches])
  const latest = useRef({ items, current })
  useLayoutEffect(() => {
    latest.current = { items, current }
  })
  useEffect(() => {
    const shown = painted.current
    for (const item of view?.getInstance()?.getRenderedItems() ?? []) {
      paint(shown, item.element, items.get(item.id), current)
    }
    return () => {
      for (const element of shown.keys()) erase(shown, element)
    }
  }, [view, items, current])
  return useCallback(
    (
      node: HTMLElement,
      _instance: unknown,
      phase: PostRenderPhase,
      context: { readonly item: { readonly id: string } },
    ) => {
      if (phase === "unmount") erase(painted.current, node)
      else paint(painted.current, node, latest.current.items.get(context.item.id), latest.current.current)
    },
    [],
  )
}
