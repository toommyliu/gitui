import { useAtom, useAtomValue } from "@effect/atom-react"
import type { CommandEntry, RepoId } from "@gitui/contracts"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "cn"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { basename } from "@/lib/format"
import { commandLogAtom, isFailure, latest, type LogFilter, logViewAtom } from "@/lib/git"
import { Nothing } from "./loading"

const ROW = 26

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })

const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

const quote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)

const shortCommand = (entry: CommandEntry) => ["git", ...entry.args.slice(entry.prefixLength)].map(quote).join(" ")

const fullCommand = (entry: CommandEntry) => ["git", "-C", entry.cwd, ...entry.args].map(quote).join(" ")

const copyText = (text: string) => {
  if (window.isSecureContext && navigator.clipboard !== undefined) return navigator.clipboard.writeText(text)
  const area = document.createElement("textarea")
  area.value = text
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand("copy")
  area.remove()
  return ok ? Promise.resolve() : Promise.reject(new Error("Copy was blocked"))
}

const filters: ReadonlyArray<readonly [LogFilter, string]> = [
  ["all", "All"],
  ["writes", "Writes"],
  ["failures", "Failures"],
]

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
  }
}

export function CommandLogSheet({ repo }: { repo: RepoId }) {
  const [view, setView] = useAtom(logViewAtom)
  const log = latest(useAtomValue(commandLogAtom))
  const entries = log ?? []
  const [repoOnly, setRepoOnly] = useState(true)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())

  const rows = useMemo(() => {
    const matches = (log ?? []).filter(
      (entry) =>
        (!repoOnly || entry.cwd === repo) &&
        (view.filter === "all" || (view.filter === "writes" ? entry.kind === "write" : isFailure(entry))),
    )
    return matches.reverse()
  }, [log, repoOnly, repo, view.filter])

  const lastId = log?.at(-1)?.id ?? 0
  useEffect(() => {
    if (view.open && lastId > view.seenId) setView((current) => ({ ...current, seenId: lastId }))
  }, [view.open, view.seenId, lastId, setView])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    getItemKey: (index) => rows[index]!.id,
    overscan: 20,
  })

  const toggle = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const copy = (entry: CommandEntry) =>
    copyText(fullCommand(entry)).then(
      () => toast.success("Command copied"),
      () => toast.error("Couldn't copy", { description: "This browser blocked clipboard access." }),
    )

  return (
    <Sheet open={view.open} onOpenChange={(open: boolean) => setView((current) => ({ ...current, open }))}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>Command log</SheetTitle>
          <SheetDescription>
            Every git command the server ran, newest first. Reads refresh status and history; writes change the
            repository.
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <ToggleGroup
              aria-label="Show"
              variant="outline"
              size="sm"
              spacing={0}
              value={[view.filter]}
              onValueChange={(next: Array<string>) => {
                const picked = filters.find(([value]) => value === next[0])
                if (picked !== undefined) setView((current) => ({ ...current, filter: picked[0] }))
              }}
            >
              {filters.map(([value, label]) => (
                <ToggleGroupItem key={value} value={value}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Field orientation="horizontal" className="w-auto">
              <Switch id="log-repo-only" checked={repoOnly} onCheckedChange={setRepoOnly} />
              <FieldLabel htmlFor="log-repo-only" className="font-normal">
                Only {basename(repo)}
              </FieldLabel>
            </Field>
            <span className="ml-auto text-muted-foreground tabular-nums">
              {rows.length} of {entries.length}
            </span>
          </div>
        </SheetHeader>
        {rows.length === 0 ? (
          <Nothing title="Nothing logged" description="Commands appear here as soon as the server runs them." />
        ) : (
          <ScrollArea className="min-h-0 flex-1" viewportRef={scrollRef}>
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
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
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {clock.format(entry.startedAt)}
                      </span>
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
                        <Button size="xs" variant="outline" onClick={() => void copy(entry)}>
                          Copy command
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  )
}
