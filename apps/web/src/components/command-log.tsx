import { useAtom, useAtomValue } from "@effect/atom-react"
import type { CommandEntry, RepoId } from "@gitui/contracts"
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "cn"
import { ChevronUpIcon } from "lucide-react"
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { copyText } from "@/lib/clipboard"
import { useCommand } from "@/lib/commands"
import { commandLogAtom, isFailure, latest, logOpenAtom, logSeenAtom } from "@/lib/git"
import { Nothing } from "./loading"
import { NetworkStatus } from "./network"

const ROW = 26

type ScrollPosition = { offset: number; measurements: Array<VirtualItem> }

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })

const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

const quote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)

const shortCommand = (entry: CommandEntry) => ["git", ...entry.args.slice(entry.prefixLength)].map(quote).join(" ")

const fullCommand = (entry: CommandEntry) => ["git", "-C", entry.cwd, ...entry.args].map(quote).join(" ")

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle")
  useEffect(() => {
    if (state === "idle") return
    const timer = setTimeout(() => setState("idle"), 1500)
    return () => clearTimeout(timer)
  }, [state])
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={() =>
        copyText(text).then(
          () => setState("copied"),
          () => setState("blocked"),
        )
      }
    >
      {state === "copied" ? "Copied" : state === "blocked" ? "Clipboard blocked" : "Copy command"}
    </Button>
  )
}

function Outcome({ entry }: { entry: CommandEntry }) {
  const { outcome } = entry
  switch (outcome._tag) {
    case "Exited":
      return (
        <Badge variant={outcome.accepted ? "secondary" : "destructive"} className="h-4 rounded-sm px-1 tabular-nums">
          exit {outcome.code}
        </Badge>
      )
    case "SpawnFailed":
      return (
        <Badge variant="destructive" className="h-4 rounded-sm px-1">
          didn't start
        </Badge>
      )
    case "Streamed":
      return (
        <Badge variant="outline" className="h-4 rounded-sm px-1">
          streamed
        </Badge>
      )
    case "Cancelled":
      return (
        <Badge variant="outline" className="h-4 rounded-sm px-1">
          cancelled
        </Badge>
      )
  }
}

export function CommandLogDrawer({ repo, children }: { repo: RepoId; children: ReactNode }) {
  const [open, setOpen] = useAtom(logOpenAtom)
  useCommand("log.toggle", () => setOpen(!open))
  const [seenId, setSeenId] = useAtom(logSeenAtom(repo))
  const log = latest(useAtomValue(commandLogAtom(repo)))
  const entries = log ?? []
  const rows = useMemo(() => (log ?? []).toReversed(), [log])
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const position = useRef<ScrollPosition>({ offset: 0, measurements: [] })

  const lastId = entries.at(-1)?.id ?? 0
  useEffect(() => {
    if (open && lastId > seenId) setSeenId(lastId)
  }, [open, seenId, lastId, setSeenId])

  const unseen = entries.filter((entry) => entry.id > seenId && isFailure(entry)).length

  const bar = (
    <div className={cn("flex h-8 shrink-0 items-center gap-2 px-1.5", open ? "border-b" : "border-t")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group/log flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-1.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <ChevronUpIcon
          className={cn(
            "size-3 text-muted-foreground transition-transform group-hover/log:text-foreground",
            open && "rotate-180",
          )}
        />
        Command log
        {unseen > 0 && (
          <Badge variant="destructive" className="h-4 rounded-sm px-1 tabular-nums">
            {unseen}
          </Badge>
        )}
      </button>
      <NetworkStatus repo={repo} />
    </div>
  )

  return (
    <>
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="main" minSize="30%">
          {children}
        </ResizablePanel>
        {open && (
          <>
            <ResizableHandle />
            <ResizablePanel id="log" defaultSize="35%" minSize={120}>
              <div className="flex h-full flex-col">
                {bar}
                <LogRows rows={rows} expanded={expanded} setExpanded={setExpanded} position={position} />
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {!open && bar}
    </>
  )
}

function LogRows({
  rows,
  expanded,
  setExpanded,
  position,
}: {
  rows: ReadonlyArray<CommandEntry>
  expanded: ReadonlySet<number>
  setExpanded: Dispatch<SetStateAction<ReadonlySet<number>>>
  position: RefObject<ScrollPosition>
}) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW,
    getItemKey: (index) => rows[index]!.id,
    overscan: 20,
    initialOffset: position.current.offset,
    initialMeasurementsCache: position.current.measurements,
  })

  useEffect(
    () => () => {
      position.current = { offset: virtualizer.scrollOffset ?? 0, measurements: virtualizer.measurementsCache }
    },
    [virtualizer, position],
  )

  const toggle = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const total = virtualizer.getTotalSize()

  const jump = (index: number, id: number) => {
    setExpanded((current) => new Set(current).add(id))
    virtualizer.scrollToIndex(index, { align: "center" })
  }

  if (rows.length === 0) {
    return <Nothing title="Nothing logged" description="Git commands for this repository appear here as they run." />
  }

  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportRef={setScrollElement}
      viewportProps={{ className: "data-has-overflow-y:pr-3" }}
      markers={rows.flatMap((entry, index) => {
        const item = virtualizer.measurementsCache[index]
        const failed = isFailure(entry)
        if (item === undefined || (!failed && entry.kind !== "write")) return []
        return (
          <button
            key={entry.id}
            type="button"
            tabIndex={-1}
            title={shortCommand(entry)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => jump(index, entry.id)}
            className={cn(
              "group/marker absolute inset-x-0 flex min-h-2 -translate-y-1/2 items-center px-px",
              failed && "z-10",
            )}
            style={{
              top: `${((item.start + item.size / 2) / total) * 100}%`,
              height: `${(item.size / total) * 100}%`,
            }}
          >
            <span
              className={cn(
                "h-0.5 w-full rounded-full group-hover/marker:h-1",
                failed ? "bg-destructive" : "bg-muted-foreground/60",
              )}
            />
          </button>
        )
      })}
    >
      <div className="relative w-full" style={{ height: total }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = rows[item.index]!
          const open = expanded.has(entry.id)
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className={cn("absolute top-0 left-0 w-full border-b", open && "bg-muted/40")}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <button
                type="button"
                onClick={() => toggle(entry.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 text-left hover:bg-muted/60"
                style={{ height: ROW }}
              >
                <span className="shrink-0 text-muted-foreground tabular-nums">{clock.format(entry.startedAt)}</span>
                <Outcome entry={entry} />
                {entry.kind === "write" && (
                  <Badge variant="outline" className="h-4 rounded-sm px-1">
                    write
                  </Badge>
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{shortCommand(entry)}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{duration(entry.durationMs)}</span>
              </button>
              {open && (
                <div className="space-y-2 px-3 pt-1 pb-3">
                  <pre className="font-mono text-[11px] break-all whitespace-pre-wrap">{fullCommand(entry)}</pre>
                  {entry.outcome._tag === "SpawnFailed" && (
                    <pre className="font-mono text-[11px] whitespace-pre-wrap text-destructive">
                      {entry.outcome.message}
                    </pre>
                  )}
                  {entry.stderr !== "" && (
                    <pre
                      className={cn(
                        "max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap",
                        isFailure(entry) && "text-destructive",
                      )}
                    >
                      {entry.stderr}
                    </pre>
                  )}
                  <CopyButton text={fullCommand(entry)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
