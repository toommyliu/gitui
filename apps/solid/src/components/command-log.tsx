import type { CommandEntry } from "@gitui/contracts"
import type { JSX } from "@solidjs/web"
import { createResizableController, Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/solid/resizable"
import { createVirtualizer } from "@ui-sdk/core"
import { children, createEffect, createSignal, For, onCleanup, onSettled, Show, untrack } from "solid-js"
import { shortcut, useCommand } from "@/lib/hotkeys"
import { subscribe } from "@/lib/rpc"
import { active, workspaceFor, WorkspaceContext } from "@/lib/workspaces"
import { Prose } from "./commit-mention"
import { Check, ChevronRight, X } from "./icons"
import { Boundary } from "./state"
import { Bar, Button, Empty, ROW, Tip } from "./ui"

const LIMIT = 2000
const PANEL = "command-log"

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})

const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

const quote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)

const shortCommand = (entry: CommandEntry) => ["git", ...entry.args.slice(entry.prefixLength)].map(quote).join(" ")

const fullCommand = (entry: CommandEntry) => ["git", "-C", entry.cwd, ...entry.args].map(quote).join(" ")

const failed = (entry: CommandEntry) =>
  entry.outcome._tag === "SpawnFailed" || (entry.outcome._tag === "Exited" && !entry.outcome.accepted)

const outcomeLabel = (entry: CommandEntry) => {
  const outcome = entry.outcome
  switch (outcome._tag) {
    case "Exited":
      return String(outcome.code)
    case "SpawnFailed":
      return "didn't start"
    case "Streamed":
      return "streamed"
    case "Cancelled":
      return "cancelled"
  }
}

function CopyCommand(props: { text: string }) {
  const [state, setState] = createSignal<"idle" | "copied" | "blocked">("idle")
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = async () => {
    clearTimeout(timer)
    setState(
      await navigator.clipboard.writeText(props.text).then(
        () => "copied" as const,
        () => "blocked" as const,
      ),
    )
    timer = setTimeout(() => setState("idle"), 1500)
  }
  return (
    <Button
      class={
        state() === "copied"
          ? "border-change-added/50 text-change-added"
          : state() === "blocked"
            ? "border-destructive/50 text-destructive"
            : undefined
      }
      onClick={() => void copy()}
    >
      <Show when={state() === "copied"}>
        <Check />
      </Show>
      {state() === "copied" ? "Copied" : state() === "blocked" ? "Clipboard blocked" : "Copy command"}
    </Button>
  )
}

function Row(props: {
  entry: CommandEntry
  open: boolean
  onToggle: () => void
  top: number
  measure: (element: HTMLElement) => () => void
}) {
  const details = () => props.entry.stderr !== "" || props.entry.outcome._tag === "SpawnFailed"
  let row: HTMLDivElement | undefined
  onSettled(() => (row === undefined ? undefined : props.measure(row)))
  return (
    <div
      ref={row}
      class={["absolute inset-x-0 border-b border-border/60", props.open && "bg-muted/40"]}
      style={{ transform: `translateY(${props.top}px)` }}
    >
      <button
        type="button"
        aria-expanded={props.open ? "true" : "false"}
        onClick={() => props.onToggle()}
        class="grid w-full grid-cols-[4.5rem_4.5rem_minmax(0,1fr)_4rem] items-center gap-2 px-3 text-start hover:bg-muted/60"
        style={{ height: `${ROW}px` }}
      >
        <span class="text-2xs text-muted-foreground tabular-nums">{clock.format(props.entry.startedAt)}</span>
        <span
          class={[
            "truncate text-2xs tabular-nums",
            failed(props.entry) ? "font-medium text-destructive" : "text-muted-foreground",
          ]}
        >
          {outcomeLabel(props.entry)}
        </span>
        <span class="flex min-w-0 items-center gap-1">
          <span
            class={[
              "min-w-0 truncate font-mono text-2xs",
              props.entry.kind === "write" ? "text-foreground" : "text-muted-foreground",
            ]}
          >
            {shortCommand(props.entry)}
          </span>
          <Show when={details()}>
            <span class={["shrink-0 text-muted-foreground transition-transform", props.open && "rotate-90"]}>
              <ChevronRight class="size-3" />
            </span>
          </Show>
        </span>
        <span class="text-end text-2xs text-muted-foreground tabular-nums">{duration(props.entry.durationMs)}</span>
      </button>
      <Show when={props.open}>
        <div class="flex flex-col gap-1.5 px-3 pt-0.5 pb-2 select-text">
          <pre class="font-mono text-2xs break-all whitespace-pre-wrap">{fullCommand(props.entry)}</pre>
          <Show when={props.entry.outcome._tag === "SpawnFailed" ? props.entry.outcome.message : null}>
            {(message) => (
              <pre class="font-mono text-2xs whitespace-pre-wrap text-destructive">
                <Prose text={message()} />
              </pre>
            )}
          </Show>
          <Show when={props.entry.stderr}>
            {(stderr) => (
              <pre
                class={[
                  "max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-2xs whitespace-pre-wrap",
                  failed(props.entry) && "text-destructive",
                ]}
              >
                <Prose text={stderr()} />
              </pre>
            )}
          </Show>
          <div>
            <CopyCommand text={fullCommand(props.entry)} />
          </div>
        </div>
      </Show>
    </div>
  )
}

function Rows(props: {
  entries: ReadonlyArray<CommandEntry>
  expanded: ReadonlySet<number>
  onToggle: (id: number) => void
}) {
  let scroller: HTMLDivElement | undefined
  let stick = true
  const virtual = createVirtualizer({
    count: () => untrack(() => props.entries.length),
    key: (index) => String(untrack(() => props.entries[index]?.id ?? index)),
    estimate: () => ROW,
    overscan: 8,
    scrollMargin: ROW,
  })
  const [rows, setRows] = createSignal(virtual.items())
  const [height, setHeight] = createSignal(virtual.size())
  const sync = () => {
    setRows(virtual.items())
    setHeight(virtual.size())
  }
  onSettled(() => {
    if (scroller === undefined) return
    const disconnect = virtual.connect(scroller)
    const unsubscribe = virtual.subscribe(sync)
    sync()
    scroller.scrollTop = scroller.scrollHeight
    return () => {
      unsubscribe()
      disconnect()
    }
  })
  createEffect(
    () => props.entries.length,
    () => {
      virtual.refresh()
      sync()
      if (stick && scroller !== undefined) scroller.scrollTop = scroller.scrollHeight
    },
  )
  return (
    <div
      ref={(element: HTMLDivElement) => (scroller = element)}
      onScroll={(event) => {
        const element = event.currentTarget
        stick = element.scrollHeight - element.scrollTop - element.clientHeight < 4
      }}
      class="min-h-0 flex-1 overflow-y-auto text-xs"
    >
      <div
        class="sticky top-0 z-10 grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)_4rem] items-center gap-2 border-b bg-background px-3 text-2xs text-muted-foreground"
        style={{ height: `${ROW}px` }}
      >
        <span>Time</span>
        <span>Exit</span>
        <span>Command</span>
        <span class="text-end">Duration</span>
      </div>
      <div class="relative" style={{ height: `${height()}px` }}>
        <For each={rows()} keyed={(item) => item.key}>
          {(item) => (
            <Show when={props.entries[item().index]}>
              {(entry) => (
                <Row
                  entry={entry()}
                  open={props.expanded.has(entry().id)}
                  onToggle={() => props.onToggle(entry().id)}
                  top={item().start}
                  measure={(element) => virtual.measure(item().index, element)}
                />
              )}
            </Show>
          )}
        </For>
      </div>
    </div>
  )
}

function Entries(props: { path: string; onHide: () => void }) {
  const workspace = workspaceFor(props.path)
  const [entries, setEntries] = createSignal<ReadonlyArray<CommandEntry>>([])
  const [expanded, setExpanded] = createSignal<ReadonlySet<number>>(new Set())

  createEffect(
    () => workspace.info().id,
    (repo) =>
      subscribe(
        (git) => git.CommandLog({ repo }),
        (batch) =>
          setEntries((current) => {
            const next = current.concat(batch)
            return next.length > LIMIT ? next.slice(-LIMIT) : next
          }),
      ),
  )

  const toggle = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const failures = () => entries().filter(failed).length

  return (
    <WorkspaceContext value={workspace}>
      <Bar class="ps-3">
        <span class="font-medium">Command log</span>
        <span class="text-muted-foreground tabular-nums">{entries().length}</span>
        <Show when={failures() > 0}>
          <span class="text-destructive tabular-nums">{failures() === 1 ? "1 failed" : `${failures()} failed`}</span>
        </Show>
        <div class="flex-1" />
        <Tip label="Hide the command log" keys={shortcut("log.toggle")}>
          {(trigger) => (
            <Button
              {...trigger}
              variant="ghost"
              aria-label="Hide the command log"
              class="w-6 justify-center px-0"
              onClick={() => props.onHide()}
            >
              <X />
            </Button>
          )}
        </Tip>
      </Bar>
      <Show
        when={entries().length > 0}
        fallback={<Empty title="Nothing logged yet">Git commands for this repository show up here as they run.</Empty>}
      >
        <Rows entries={entries()} expanded={expanded()} onToggle={toggle} />
      </Show>
    </WorkspaceContext>
  )
}

export function CommandLog(props: { children: JSX.Element }) {
  const main = children(() => props.children)
  const controller = createResizableController()
  let size = 35
  const hide = () => {
    size = controller.getLayout()[1] ?? size
    controller.collapse(PANEL)
  }
  const toggle = () => (controller.isCollapsed(PANEL) ? controller.resize(PANEL, size) : hide())
  useCommand("log.toggle", () => void toggle())
  return (
    <Resizable
      orientation="vertical"
      autoSaveId="gitui.command-log"
      controller={controller}
      class="flex min-h-0 flex-1 flex-col"
    >
      <ResizablePanel id="command-log-main" minSize="30%" class="flex min-h-0 flex-col overflow-hidden">
        {main()}
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize the command log"
        class="h-px shrink-0 bg-border hover:bg-ring focus-visible:bg-ring data-collapsed:hidden"
      />
      <ResizablePanel
        id={PANEL}
        defaultSize={0}
        minSize="120px"
        collapsible
        class="flex min-h-0 flex-col overflow-hidden"
      >
        {(state) => (
          <Show when={!state.collapsed}>
            <Show when={active()} keyed fallback={<Empty title="No repository open" />}>
              {(path) => (
                <Boundary label="Opening the command log">
                  <Entries path={path} onHide={hide} />
                </Boundary>
              )}
            </Show>
          </Show>
        )}
      </ResizablePanel>
    </Resizable>
  )
}
