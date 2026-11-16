import type { FileBlame, FileIdentity, Oid } from "@gitui/contracts"
import { createVirtualizer } from "@ui-sdk/core"
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js"
import { longDate, shortOid } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { call } from "@/lib/rpc"
import { Boundary } from "../state"
import { Empty, Tip } from "../ui"
import { listDate } from "@/lib/dates"

type BlameLine = Extract<FileBlame, { _tag: "Lines" }>["lines"][number]

const LINE = 20

const linesOf = (blame: FileBlame) => (blame._tag === "Lines" ? blame.lines : null)

const unavailable = (blame: FileBlame) => (blame._tag === "Unavailable" ? blame.reason : "")
const TAB_SIZE = 4

function Lines(props: {
  lines: ReadonlyArray<BlameLine>
  selected: Oid
  known: (oid: Oid) => boolean
  onSelect: (oid: Oid) => void
}) {
  const starts = createMemo(() => props.lines.map((line, index) => props.lines[index - 1]?.oid !== line.oid))
  const columns = createMemo(() =>
    props.lines.reduce((widest, line) => Math.max(widest, line.content.replaceAll("\t", "    ").length), 0),
  )
  const virtual = createVirtualizer({
    count: () => untrack(() => props.lines.length),
    estimate: () => LINE,
    overscan: 20,
  })
  const [rows, setRows] = createSignal(virtual.items())
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
  createEffect(
    () => props.lines.length,
    () => virtual.refresh(),
  )

  return (
    <div
      ref={scroller}
      tabindex="0"
      role="region"
      aria-label="Blame"
      class="min-h-0 flex-1 overflow-auto overscroll-none bg-background outline-none"
    >
      <div
        class="relative min-w-full font-mono text-xs"
        style={{
          height: `${props.lines.length * LINE}px`,
          width: `calc(15rem + 3.5rem + ${columns()}ch + 1rem)`,
          "tab-size": TAB_SIZE,
        }}
      >
        <For each={rows()} keyed={(item) => item.index}>
          {(item) => {
            const line = () => props.lines[item().index]
            const start = () => starts()[item().index] === true
            return (
              <Show when={line()}>
                {(current) => (
                  <div
                    class={[
                      "absolute inset-x-0 flex",
                      start() && item().index > 0 && "*:shadow-[inset_0_1px_0_var(--border)]",
                      current().oid === props.selected && "bg-selection/50",
                    ]}
                    style={{ top: `${item().start}px`, height: `${LINE}px`, "line-height": `${LINE}px` }}
                  >
                    <div class="sticky start-0 z-10 flex w-60 shrink-0 items-center gap-2 border-e bg-background px-2 font-sans text-2xs text-muted-foreground">
                      <Show when={start()}>
                        <Tip
                          label={
                            <span class="flex max-w-80 flex-col">
                              <span class="font-medium">{current().subject}</span>
                              <span>
                                {current().author}, {longDate(current().time)}
                              </span>
                              <span>
                                Line {current().originalLine} of {current().path}
                              </span>
                            </span>
                          }
                          side="right"
                        >
                          {(trigger) => (
                            <button
                              {...trigger}
                              type="button"
                              disabled={!props.known(current().oid)}
                              aria-label={`Show commit ${shortOid(current().oid)}: ${current().subject}`}
                              class={[
                                "shrink-0 rounded-sm px-0.5 font-mono enabled:hover:bg-muted",
                                current().oid === props.selected ? "text-primary" : "text-foreground",
                              ]}
                              onClick={() => props.onSelect(current().oid)}
                            >
                              {shortOid(current().oid)}
                            </button>
                          )}
                        </Tip>
                        <span class="min-w-0 flex-1 truncate">{current().author}</span>
                        <span class="shrink-0 tabular-nums">{listDate(current().time)}</span>
                      </Show>
                    </div>
                    <span class="sticky start-60 z-10 w-14 shrink-0 bg-background pe-3 text-end text-muted-foreground tabular-nums select-none">
                      {current().line}
                    </span>
                    <span class="ps-1 pe-4 whitespace-pre">{current().content}</span>
                  </div>
                )}
              </Show>
            )
          }}
        </For>
      </div>
    </div>
  )
}

export function Blame(props: {
  source: FileIdentity
  selected: Oid
  known: (oid: Oid) => boolean
  onSelect: (oid: Oid) => void
}) {
  const repo = useRepo()
  const blame = createMemo(() => {
    const { revision, path } = props.source
    return call((git) => git.GetFileBlame({ repo: repo.id, revision, path }))
  })
  return (
    <Boundary label="Reading blame" title="Couldn't read blame">
      <Show when={linesOf(blame())} fallback={<Empty title="Blame isn't available">{unavailable(blame())}</Empty>}>
        {(lines) => (
          <Show when={lines().length > 0} fallback={<Empty title="Empty file" />}>
            <Lines lines={lines()} selected={props.selected} known={props.known} onSelect={props.onSelect} />
          </Show>
        )}
      </Show>
    </Boundary>
  )
}
