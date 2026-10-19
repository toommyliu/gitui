import { RegistryContext, useAtomValue } from "@effect/atom-react"
import type { CommitRow, Head, Oid, Refs, RepoId, Status } from "@gitui/contracts"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Badge } from "@/components/ui/badge"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"
import { CloudIcon, SearchIcon } from "lucide-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { shortDate, shortOid } from "@/lib/format"
import { LOG_PAGE_SIZE, latest, logAtom, logKey, logPageAtom, logPageKey, refsAtom, statusAtom } from "@/lib/git"
import type { Selection } from "@/lib/selection"
import { CommitMenuItems } from "./commit-menu"
import { Nothing } from "./loading"
import { GraphCell, LANE_WIDTH, ROW_HEIGHT, VISIBLE_LANES, lanesUsed } from "./graph"

export type RefLabel = {
  readonly kind: "head" | "branch" | "remote" | "tag"
  readonly name: string
  readonly upstream?: string | undefined
}

export const refLabels = (refs: Refs | undefined, head: Head | undefined) => {
  const labels = new Map<string, Array<RefLabel>>()
  const add = (oid: string, label: RefLabel) => {
    const list = labels.get(oid)
    if (list === undefined) labels.set(oid, [label])
    else list.push(label)
  }
  if (head?._tag === "Detached") add(head.oid, { kind: "head", name: "HEAD" })
  const remoteOids = new Map(refs?.remoteBranches.map((remote) => [remote.name, remote.oid]))
  const merged = new Set<string>()
  for (const branch of refs?.branches ?? []) {
    const isHead = head?._tag === "Branch" && head.name === branch.name
    const upstream =
      branch.upstream?._tag === "Tracking" && remoteOids.get(branch.upstream.name) === branch.oid
        ? branch.upstream.name
        : undefined
    if (upstream !== undefined) merged.add(upstream)
    add(branch.oid, { kind: isHead ? "head" : "branch", name: branch.name, upstream })
  }
  for (const remote of refs?.remoteBranches ?? []) {
    if (!merged.has(remote.name)) add(remote.oid, { kind: "remote", name: remote.name })
  }
  for (const tag of refs?.tags ?? []) add(tag.oid, { kind: "tag", name: tag.name })
  for (const list of labels.values()) list.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind])
  return labels
}

const kindOrder: Record<RefLabel["kind"], number> = { head: 0, branch: 1, remote: 2, tag: 3 }

export function RefBadge({ label, className }: { label: RefLabel; className?: string }) {
  return (
    <Badge
      variant={label.kind === "head" ? "default" : "secondary"}
      className={cn(
        "h-4 rounded-sm px-1 text-[11px] [&>svg]:size-3!",
        label.kind !== "head" && "bg-foreground/8",
        label.kind === "remote" && "text-muted-foreground",
        label.kind === "tag" && "italic",
        className,
      )}
    >
      <span className="truncate">{label.name}</span>
      {label.upstream !== undefined && <CloudIcon strokeWidth={2.5} aria-label={`in sync with ${label.upstream}`} />}
    </Badge>
  )
}

function RefLabels({ labels }: { labels: ReadonlyArray<RefLabel> }) {
  const [first, ...rest] = labels
  if (first === undefined) return null
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex max-w-[40%] min-w-0 shrink-0 items-center gap-1" />}>
        <RefBadge label={first} className="min-w-0 shrink" />
        {rest.length > 0 && (
          <Badge variant="secondary" className="h-4 rounded-sm bg-foreground/8 px-1 text-[11px] tabular-nums">
            +{rest.length}
          </Badge>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="flex-col items-start gap-0.5">
        {labels.map((label) => (
          <span key={`${label.kind}:${label.name}`}>
            {label.name}
            {label.upstream !== undefined && <span className="opacity-60"> · {label.upstream}</span>}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}

const changeSummary = (status: Status) => {
  let staged = 0
  let unstaged = 0
  for (const entry of status.entries) {
    if (entry._tag === "Tracked") {
      if (entry.staged !== null) staged++
      if (entry.unstaged !== null) unstaged++
    } else {
      unstaged++
    }
  }
  return [unstaged > 0 && `${unstaged} unstaged`, staged > 0 && `${staged} staged`].filter(Boolean).join(", ")
}

const useDebounced = <T,>(value: T, ms: number) => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function CommitList({
  repo,
  selection,
  onSelect,
  query,
  onQueryChange,
}: {
  repo: RepoId
  selection: Selection
  onSelect: (selection: Selection) => void
  query: string
  onQueryChange: (query: string) => void
}) {
  const search = useDebounced(query.trim(), 250)
  const result = useAtomValue(logAtom(logKey(repo, search)))
  const current = latest(result)
  const [shown, setShown] = useState(current)
  useEffect(() => {
    if (current !== undefined) setShown(current)
  }, [current])
  const log = current ?? shown
  const filtering = search !== ""
  const status = latest(useAtomValue(statusAtom(repo)))
  const refs = latest(useAtomValue(refsAtom(repo)))
  const labels = useMemo(() => refLabels(refs, status?.head), [refs, status?.head])
  const headOid = status?.head._tag === "Unborn" ? undefined : status?.head.oid
  const hasChanges = !filtering && (status?.entries.length ?? 0) > 0
  const offset = hasChanges ? 1 : 0
  const loaded = log?.loaded ?? 0
  const count = loaded + offset

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 30,
  })

  useEffect(() => virtualizer.scrollToOffset(0), [search, virtualizer])

  const [lanes, setLanes] = useState(1)
  useEffect(() => setLanes(1), [log?.logId])
  const report = useCallback((n: number) => setLanes((m) => (n > m ? Math.min(n, VISIBLE_LANES) : m)), [])
  const graphWidth = lanes * LANE_WIDTH + 4

  const registry = useContext(RegistryContext)
  const oidAt = (index: number): Oid | undefined => {
    if (log === undefined) return undefined
    const page = registry.get(logPageAtom(logPageKey(repo, log.logId, Math.floor(index / LOG_PAGE_SIZE))))
    return AsyncResult.isSuccess(page) ? page.value[index % LOG_PAGE_SIZE]?.oid : undefined
  }

  const selectedIndex = (() => {
    if (selection._tag === "WorkingCopy") return hasChanges ? 0 : -1
    for (const item of virtualizer.getVirtualItems()) {
      if (item.index >= offset && oidAt(item.index - offset) === selection.oid) return item.index
    }
    return -1
  })()

  const selectIndex = (index: number) => {
    if (index < 0 || index >= count) return
    if (index < offset) onSelect({ _tag: "WorkingCopy" })
    else {
      const oid = oidAt(index - offset)
      if (oid !== undefined) onSelect({ _tag: "Commit", oid })
    }
    virtualizer.scrollToIndex(index, { align: "auto" })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta =
      event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0
    if (delta === 0 || selectedIndex === -1) return
    event.preventDefault()
    selectIndex(selectedIndex + delta)
  }

  const pending = current === undefined || search !== query.trim()
  const summary =
    query.trim() === ""
      ? null
      : result._tag === "Failure" && current === undefined
        ? "Search failed"
        : pending || (log?.done !== true && loaded === 0)
          ? "Searching…"
          : `${loaded} ${loaded === 1 ? "commit" : "commits"}${log?.done === true ? "" : " so far"}`

  return (
    <div className="flex h-full flex-col">
      <InputGroup className="h-8 shrink-0 rounded-none border-0 border-b border-border bg-transparent ring-inset dark:bg-transparent">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search history"
          placeholder="Search messages, author:name, path:file or a SHA"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          enterKeyHint="search"
          onKeyDown={(event) => {
            if (event.key === "Escape") onQueryChange("")
            if (event.key === "Enter") event.currentTarget.blur()
          }}
        />
        {summary !== null && (
          <InputGroupAddon align="inline-end">
            <InputGroupText className="tabular-nums">{summary}</InputGroupText>
            <InputGroupButton size="xs" onClick={() => onQueryChange("")}>
              Clear
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {filtering && log?.done === true && loaded === 0 && !pending ? (
        <Nothing title="No matching commits" description="Search looks at branches, remotes and HEAD." />
      ) : (
        <ScrollArea
          className="@container min-h-0 flex-1"
          viewportRef={scrollRef}
          viewportProps={{
            tabIndex: 0,
            onKeyDown,
            role: "listbox",
            "aria-label": "Commits",
            className: "[contain:strict] data-has-overflow-y:pr-2.5",
          }}
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                className="absolute top-0 left-0 w-full"
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                {item.index < offset && status !== undefined ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selection._tag === "WorkingCopy"}
                    onClick={() => onSelect({ _tag: "WorkingCopy" })}
                    className={cn(
                      "flex h-full w-full items-center gap-2 px-2 text-left whitespace-nowrap",
                      selection._tag === "WorkingCopy" ? "bg-accent" : "hover:bg-muted/60",
                    )}
                  >
                    <span style={{ width: graphWidth }} className="flex shrink-0 justify-start">
                      <span className="ml-[3px] size-2 rounded-full border-2 border-dashed border-muted-foreground" />
                    </span>
                    <span className="font-medium">Uncommitted changes</span>
                    <span className="truncate text-muted-foreground">{changeSummary(status)}</span>
                  </button>
                ) : log !== undefined ? (
                  <CommitRowView
                    repo={repo}
                    logId={log.logId}
                    index={item.index - offset}
                    graphWidth={graphWidth}
                    labels={labels}
                    headOid={headOid}
                    selectedOid={selection._tag === "Commit" ? selection.oid : undefined}
                    onSelect={onSelect}
                    report={report}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

const CommitRowView = memo(function CommitRowView({
  repo,
  logId,
  index,
  graphWidth,
  labels,
  headOid,
  selectedOid,
  onSelect,
  report,
}: {
  repo: RepoId
  logId: string
  index: number
  graphWidth: number
  labels: Map<string, Array<RefLabel>>
  headOid: string | undefined
  selectedOid: Oid | undefined
  onSelect: (selection: Selection) => void
  report: (lanes: number) => void
}) {
  const page = useAtomValue(logPageAtom(logPageKey(repo, logId, Math.floor(index / LOG_PAGE_SIZE))))
  const row: CommitRow | undefined = latest(page)?.[index % LOG_PAGE_SIZE]
  useEffect(() => {
    if (row !== undefined) report(lanesUsed(row.graph))
  }, [row, report])

  if (row === undefined) {
    return (
      <div className="flex h-full items-center gap-2 px-2">
        <span className="shrink-0" style={{ width: graphWidth }} />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
    )
  }
  const selected = row.oid === selectedOid
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full">
        <button
          type="button"
          role="option"
          aria-selected={selected}
          onClick={() => onSelect({ _tag: "Commit", oid: row.oid })}
          className={cn(
            "flex h-full w-full items-center gap-2 overflow-hidden px-2 text-left",
            selected ? "bg-accent" : "hover:bg-muted/60",
          )}
        >
          <span className="-my-px flex shrink-0 overflow-hidden" style={{ width: graphWidth }}>
            <GraphCell row={row.graph} width={graphWidth} merge={row.parents.length > 1} head={row.oid === headOid} />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <RefLabels labels={labels.get(row.oid) ?? []} />
            <span className={cn("truncate", row.parents.length > 1 && "text-muted-foreground")}>{row.subject}</span>
          </span>
          <span className="hidden w-28 shrink-0 truncate text-muted-foreground @xl:block">{row.author}</span>
          <span className="hidden w-24 shrink-0 truncate text-right text-muted-foreground @md:block">
            {shortDate(row.time)}
          </span>
          <span className="hidden w-14 shrink-0 font-mono text-[11px] text-muted-foreground @3xl:block">
            {shortOid(row.oid)}
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <CommitMenuItems repo={repo} row={row} />
      </ContextMenuContent>
    </ContextMenu>
  )
})
