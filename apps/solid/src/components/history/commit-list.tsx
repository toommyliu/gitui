import type { CommitRow } from "@gitui/contracts"
import type { JSX } from "@solidjs/web"
import { createVirtualizer } from "@ui-sdk/core"
import { Listbox, ListboxItem } from "@ui-sdk/solid/listbox"
import { Menu, MenuContent, MenuContextTrigger } from "@ui-sdk/solid/menu"
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js"
import { type RefLabel, refLabels } from "@/lib/ref-labels"
import { useRepo } from "@/lib/repo"
import { type Log, lanesUsed } from "@/lib/log"
import { ROW } from "../ui"
import { GraphCell, LANE_WIDTH, MAX_LANES } from "./graph"
import { listDate } from "@/lib/dates"

const badge: Record<RefLabel["kind"], string> = {
  head: "bg-primary text-primary-foreground font-medium",
  branch: "border border-border text-foreground",
  remote: "border border-dashed border-border text-muted-foreground",
  tag: "bg-muted text-muted-foreground",
}

const SHOWN = 2

function RefBadges(props: { labels: ReadonlyArray<RefLabel> }) {
  return (
    <span class="flex max-w-[45%] min-w-0 shrink items-center gap-1">
      <For each={props.labels.slice(0, SHOWN)}>
        {(label) => (
          <span
            class={[
              "flex h-4 min-w-0 items-center rounded px-1 text-2xs leading-none",
              label.kind === "branch" && label.current ? badge.head : badge[label.kind],
            ]}
          >
            <span class="truncate">{label.name}</span>
          </span>
        )}
      </For>
      <Show when={props.labels.length > SHOWN}>
        <span class="shrink-0 text-2xs text-muted-foreground">+{props.labels.length - SHOWN}</span>
      </Show>
    </span>
  )
}

export interface RowSpan {
  readonly top: number
  readonly bottom: number
}

const shiftHeld = (event: Event | undefined) =>
  (event instanceof MouseEvent || event instanceof KeyboardEvent) && event.shiftKey

export function CommitList(props: {
  log: Log
  selected: number
  range: RowSpan | null
  onSelect: (index: number, extend: boolean) => void
  menu: (row: CommitRow) => JSX.Element
}) {
  const repo = useRepo()
  const labels = createMemo(() => refLabels(repo.refs(), repo.status().head))
  const [menuRow, setMenuRow] = createSignal<CommitRow | null>(null)
  const inRange = (index: number) =>
    props.range !== null && index >= props.range.top && index <= props.range.bottom && index !== props.selected
  const count = () => props.log.handle()?.loaded ?? 0
  const virtual = createVirtualizer({
    count: () => untrack(count),
    estimate: () => ROW,
    keep: () => untrack(() => (props.selected < 0 ? [] : [props.selected])),
  })
  const [rows, setRows] = createSignal(virtual.items())
  const values = createMemo(() => Array.from({ length: count() }, (_, index) => String(index)))
  const graphWidth = createMemo(() => {
    let widest = 1
    for (const item of rows()) {
      const commit = props.log.row(item.index)
      if (commit !== undefined) widest = Math.max(widest, lanesUsed(commit.graph))
    }
    return Math.min(MAX_LANES, widest) * LANE_WIDTH
  })
  let scroller: HTMLDivElement | undefined

  onSettled(() => {
    if (scroller === undefined) return
    const disconnect = virtual.connect(scroller)
    const unsubscribe = virtual.subscribe(() => setRows(virtual.items()))
    setRows(virtual.items())
    return () => {
      unsubscribe()
      disconnect()
    }
  })

  createEffect(count, () => virtual.refresh())

  createEffect(
    () => ({ rows: rows(), handle: props.log.handle() }),
    ({ rows }) => {
      const first = rows[0]
      const last = rows.at(-1)
      if (first !== undefined && last !== undefined) props.log.ensure(first.index, last.index + 1)
    },
  )

  createEffect(
    () => props.selected,
    (index) => {
      if (index < 0) return
      virtual.scrollToIndex(index)
      if (scroller?.contains(document.activeElement))
        requestAnimationFrame(() => scroller?.querySelector<HTMLElement>(`[aria-posinset="${index + 1}"]`)?.focus())
    },
  )

  return (
    <Menu onOpenChange={(open) => open || setMenuRow(null)}>
      <MenuContextTrigger
        ref={(element: HTMLDivElement) => (scroller = element)}
        class="min-h-0 flex-1 overflow-y-auto overscroll-none"
        onContextMenu={(event: MouseEvent) => {
          const element = event.target instanceof Element ? event.target.closest("[data-index]") : null
          const row = element === null ? undefined : props.log.row(Number(element.getAttribute("data-index")))
          if (row === undefined) return event.preventDefault()
          setMenuRow(row)
        }}
      >
        <Listbox
          aria-label="Commits"
          items={values()}
          value={props.selected < 0 ? null : String(props.selected)}
          onValueChange={(value, details) => {
            if (value !== null) props.onSelect(Number(value), shiftHeld(details.event))
          }}
          onHighlight={(_value, details) => {
            if (details.index >= 0) virtual.scrollToIndex(details.index)
          }}
          class="@container relative"
          style={{ height: `${count() * ROW}px` }}
        >
          <For each={rows()} keyed={(item) => item.index}>
            {(item) => {
              const commit = () => props.log.row(item().index)
              return (
                <ListboxItem
                  value={String(item().index)}
                  index={item().index}
                  data-index={item().index}
                  data-range={inRange(item().index) ? "" : undefined}
                  onClick={(event: MouseEvent) => {
                    if (props.range !== null && !event.shiftKey && item().index === props.selected)
                      props.onSelect(item().index, false)
                  }}
                  data-context={menuRow() !== null && menuRow()?.oid === commit()?.oid ? "" : undefined}
                  class="absolute inset-x-0 flex items-center gap-2 ps-1 pe-2 text-xs data-context:outline-1 data-context:-outline-offset-1 data-context:outline-ring data-range:bg-selection data-range:text-selection-foreground"
                  style={{ top: `${item().start}px`, height: `${ROW}px` }}
                >
                  <Show
                    when={commit()}
                    fallback={
                      <>
                        <span class="shrink-0" style={{ width: `${graphWidth()}px` }} />
                        <span class="h-2 w-2/5 rounded-full bg-muted" />
                      </>
                    }
                  >
                    {(row) => (
                      <>
                        <span class="flex shrink-0 overflow-hidden" style={{ width: `${graphWidth()}px` }}>
                          <GraphCell
                            row={row().graph}
                            width={graphWidth()}
                            height={ROW}
                            merge={row().parents.length > 1}
                          />
                        </span>
                        <Show when={labels().get(row().oid)}>{(list) => <RefBadges labels={list()} />}</Show>
                        <span class="min-w-0 flex-1 truncate">{row().subject}</span>
                        <span class="hidden max-w-24 shrink-0 truncate text-2xs text-muted-foreground @md:block">
                          {row().author}
                        </span>
                        <span class="min-w-11 shrink-0 text-end text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
                          {listDate(row().time)}
                        </span>
                      </>
                    )}
                  </Show>
                </ListboxItem>
              )
            }}
          </For>
        </Listbox>
      </MenuContextTrigger>
      <MenuContent class="min-w-60">
        <Show when={menuRow()} keyed>
          {(row) => props.menu(row)}
        </Show>
      </MenuContent>
    </Menu>
  )
}
