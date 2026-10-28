import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { Comparison, CommitRow, Head, Oid, Refs, RefVisibility, RepoId, Status } from "@gitui/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import * as Effect from "effect/Effect"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useCompare } from "@/lib/comparison"
import { copyWithToast } from "@/lib/clipboard"
import { useCommandKeys } from "@/lib/commands"
import { useHistoryDate } from "@/lib/dates"
import { shortOid } from "@/lib/format"
import {
  LOG_PAGE_SIZE,
  describeFailure,
  latest,
  loadError,
  logAtom,
  logIndexAtom,
  logIndexKey,
  logKey,
  logPageAtom,
  logPageKey,
  refsAtom,
  statusAtom,
} from "@/lib/git"
import type { Selection } from "@/lib/selection"
import { locationState } from "@/lib/visibility"
import { useTallList } from "@/lib/tall-list"
import { CommitMenuItems } from "./commit-menu"
import { Nothing } from "./loading"
import { GraphCell, LANE_WIDTH, ROW_HEIGHT, VISIBLE_LANES, lanesUsed } from "./graph"

export type RefLabel = {
  readonly kind: "head" | "branch" | "remote" | "tag" | "stash"
  readonly name: string
  readonly upstream?: string | undefined
}

export const refLabels = (refs: Refs | undefined, head: Head | undefined, visibility: RefVisibility) => {
  const labels = new Map<string, Array<RefLabel>>()
  const add = (oid: string, label: RefLabel) => {
    const list = labels.get(oid)
    if (list === undefined) labels.set(oid, [label])
    else list.push(label)
  }
  const shown = (section: "branches" | "remotes", name: string) =>
    locationState(visibility, { section, name }) === "shown"
  if (head?._tag === "Detached") add(head.oid, { kind: "head", name: "HEAD" })
  const remoteOids = new Map(refs?.remoteBranches.map((remote) => [remote.name, remote.oid]))
  const merged = new Set<string>()
  for (const branch of refs?.branches ?? []) {
    const isHead = head?._tag === "Branch" && head.name === branch.name
    if (!isHead && !shown("branches", branch.name)) continue
    const upstream =
      branch.upstream?._tag === "Tracking" && remoteOids.get(branch.upstream.name) === branch.oid
        ? branch.upstream.name
        : undefined
    if (upstream !== undefined) merged.add(upstream)
    add(branch.oid, { kind: isHead ? "head" : "branch", name: branch.name, upstream })
  }
  for (const remote of refs?.remoteBranches ?? []) {
    if (!merged.has(remote.name) && shown("remotes", remote.name))
      add(remote.oid, { kind: "remote", name: remote.name })
  }
  if (visibility.tags) for (const tag of refs?.tags ?? []) add(tag.oid, { kind: "tag", name: tag.name })
  if (visibility.stashes)
    refs?.stashes.forEach((stash, index) => add(stash.oid, { kind: "stash", name: `stash@{${index}}` }))
  for (const list of labels.values()) list.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind])
  return labels
}

const kindOrder: Record<RefLabel["kind"], number> = { head: 0, branch: 1, remote: 2, tag: 3, stash: 4 }

export function RefBadge({ label, className }: { label: RefLabel; className?: string }) {
  return (
    <Badge
      variant={label.kind === "head" ? "default" : "secondary"}
      className={cn(
        "h-4 rounded-sm px-1 text-[11px] [&>svg]:size-3!",
        label.kind !== "head" && "bg-foreground/8",
        (label.kind === "remote" || label.kind === "stash") && "text-muted-foreground",
        label.kind === "tag" && "pr-0.5 italic",
        className,
      )}
    >
      <span className={cn("truncate", label.kind === "tag" && "pr-0.5")}>{label.name}</span>
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

const idle = Atom.make(AsyncResult.initial<never, never>())

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
  visibility,
  query,
  onQueryChange,
  searchRef,
}: {
  repo: RepoId
  selection: Selection
  onSelect: (selection: Selection) => void
  visibility: RefVisibility
  query: string
  onQueryChange: (query: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
}) {
  const openCompare = useCompare(repo)
  const [range, setRange] = useState<{ anchor: Oid; cursor: Oid; comparison: Comparison } | null>(null)
  const selectionRequest = useRef(0)
  const search = useDebounced(query.trim(), 250)
  const result = useAtomValue(logAtom(logKey(repo, search, visibility)))
  const refreshLog = useAtomRefresh(logAtom(logKey(repo, search, visibility)))
  const fresh = latest(result)
  const [log, setLog] = useState(fresh)
  if (
    fresh !== undefined &&
    fresh !== log &&
    (log === undefined || (fresh.key === log.key && fresh.logId === log.logId))
  )
    setLog(fresh)
  const current = fresh !== undefined && fresh === log ? fresh : undefined
  const filtering = search !== ""
  const status = latest(useAtomValue(statusAtom(repo)))
  const refs = latest(useAtomValue(refsAtom(repo)))
  const labels = useMemo(() => refLabels(refs, status?.head, visibility), [refs, status?.head, visibility])
  const headOid = status?.head._tag === "Unborn" ? undefined : status?.head.oid
  const hasChanges = !filtering && (status?.entries.length ?? 0) > 0
  const offset = hasChanges ? 1 : 0
  const loaded = log?.loaded ?? 0
  const count = loaded + offset

  const list = useTallList({ count, rowHeight: ROW_HEIGHT, overscan: 30, resetKey: search })

  const next = fresh !== undefined && fresh !== log ? fresh : undefined
  const pageOf = (row: number | undefined) =>
    Math.floor(Math.min(Math.max(0, (row ?? 0) - offset), (next?.loaded ?? 1) - 1) / LOG_PAGE_SIZE)
  const firstPage = pageOf(list.rows[0]?.index)
  const lastPage = pageOf(list.rows.at(-1)?.index)
  const nextPageAtom = (page: number) =>
    next === undefined || next.loaded === 0 ? idle : logPageAtom(logPageKey(next.key, next.logId, page))
  const nextFirstRows = useAtomValue(nextPageAtom(firstPage))
  const nextLastRows = useAtomValue(nextPageAtom(lastPage))

  const [lanes, setLanes] = useState(1)
  const [lanesLog, setLanesLog] = useState(log?.logId)
  if (
    next !== undefined &&
    (next.loaded === 0 ? next.done : nextFirstRows._tag !== "Initial" && nextLastRows._tag !== "Initial")
  ) {
    const rows = [...(latest(nextFirstRows) ?? []), ...(lastPage === firstPage ? [] : (latest(nextLastRows) ?? []))]
    const used = list.rows.flatMap(({ index }) => {
      const row = rows[index - offset - firstPage * LOG_PAGE_SIZE]
      return row === undefined ? [] : [lanesUsed(row.graph)]
    })
    setLog(next)
    setLanesLog(next.logId)
    setLanes(Math.min(VISIBLE_LANES, Math.max(1, ...used)))
  } else if (lanesLog !== log?.logId) {
    setLanesLog(log?.logId)
    setLanes(1)
  }
  const report = useCallback((n: number) => setLanes((m) => (n > m ? Math.min(n, VISIBLE_LANES) : m)), [])
  const graphWidth = lanes * LANE_WIDTH + 4

  const registry = useContext(RegistryContext)
  const oidAt = (index: number): Oid | undefined => {
    if (log === undefined) return undefined
    const page = registry.get(logPageAtom(logPageKey(log.key, log.logId, Math.floor(index / LOG_PAGE_SIZE))))
    return AsyncResult.isSuccess(page) ? page.value[index % LOG_PAGE_SIZE]?.oid : undefined
  }

  const renderedIndex = (() => {
    if (selection._tag !== "Commit") return selection._tag === "WorkingCopy" && hasChanges ? 0 : -1
    for (const row of list.rows) {
      if (row.index >= offset && oidAt(row.index - offset) === selection.oid) return row.index
    }
    return -1
  })()
  const activeRange =
    selection._tag === "Comparison" &&
    selection.comparison.mode === "range" &&
    range?.comparison === selection.comparison
      ? range
      : null
  const cursorOid = selection._tag === "Commit" ? selection.oid : activeRange?.cursor
  const lookup =
    cursorOid !== undefined && renderedIndex === -1 && log !== undefined
      ? logIndexKey(repo, log.logId, cursorOid)
      : undefined
  const located = latest(useAtomValue(lookup === undefined ? idle : logIndexAtom(lookup)))
  const anchorIndex = latest(
    useAtomValue(
      activeRange === null || log === undefined ? idle : logIndexAtom(logIndexKey(repo, log.logId, activeRange.anchor)),
    ),
  )
  const selectedRange =
    activeRange !== null && anchorIndex != null && located != null ? { anchor: anchorIndex, cursor: located } : null
  const selectedIndex = renderedIndex !== -1 ? renderedIndex : located == null ? -1 : located + offset

  const { scrollToIndex } = list
  const selectIndex = (index: number, extend = false) => {
    if (index < 0 || index >= count) return
    if (extend && activeRange !== null && selectedRange === null) return
    const request = ++selectionRequest.current
    scrollToIndex(index)
    if (index < offset) return onSelect({ _tag: "WorkingCopy" })
    if (log === undefined) return
    const row = index - offset
    const anchor = extend ? (selectedRange?.anchor ?? Math.max(0, selectedIndex - offset)) : row
    const loadOid = async (at: number) => {
      const oid = oidAt(at)
      if (oid !== undefined) return oid
      const page = logPageAtom(logPageKey(log.key, log.logId, Math.floor(at / LOG_PAGE_SIZE)))
      const rows = await Effect.runPromise(AtomRegistry.getResult(registry, page))
      return rows[at % LOG_PAGE_SIZE]?.oid
    }
    void Promise.all([loadOid(Math.max(anchor, row)), loadOid(Math.min(anchor, row))]).then(
      ([base, head]) => {
        if (request !== selectionRequest.current || base === undefined || head === undefined) return
        if (!extend || anchor === row) return onSelect({ _tag: "Commit", oid: head })
        const comparison: Comparison = { base, head, mode: "range" }
        setRange({ anchor: anchor > row ? base : head, cursor: anchor > row ? head : base, comparison })
        onSelect({ _tag: "Comparison", comparison })
      },
      () => {},
    )
  }

  const follow = selection._tag === "Commit" ? selection.oid : selection._tag
  const followed = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (current === undefined || selectedIndex === -1 || followed.current === follow) return
    followed.current = follow
    scrollToIndex(selectedIndex, true)
  }, [current, selectedIndex, follow, scrollToIndex])

  const picking = useRef(false)
  const pickFirstMatch = () => {
    if (current === undefined || search !== query.trim()) return false
    if (selectedIndex !== -1 || (log?.done === true && count === 0)) return true
    if (count === 0 || (selection._tag === "Commit" && located !== null)) return false
    selectIndex(0)
    return true
  }
  useEffect(() => {
    if (picking.current && pickFirstMatch()) picking.current = false
  })

  const step =
    (delta: number, extend = false) =>
    () => {
      selectIndex(selectedIndex === -1 ? 0 : selectedIndex + delta, extend)
    }
  useCommandKeys(
    [
      { id: "list.next", run: step(1) },
      { id: "list.previous", run: step(-1) },
      { id: "history.extendNext", run: step(1, true) },
      { id: "history.extendPrevious", run: step(-1, true) },
      {
        id: "history.copySha",
        run: () => {
          if (selection._tag === "Commit") void copyWithToast(selection.oid, "SHA copied")
        },
      },
    ],
    { target: list.element },
  )

  const pending = current === undefined || search !== query.trim()
  const failed = result._tag === "Failure" && !result.waiting && search === query.trim()
  const summary =
    query.trim() === ""
      ? null
      : failed
        ? "Search failed"
        : pending || (log?.done !== true && loaded === 0)
          ? "Searching…"
          : `${loaded} ${loaded === 1 ? "commit" : "commits"}${log?.done === true ? "" : " so far"}`

  return (
    <div className="flex h-full flex-col">
      <InputGroup className="h-8 shrink-0 rounded-none border-0 border-b border-border bg-transparent ring-inset has-[[data-slot=input-group-control]:focus-visible]:border-border has-[[data-slot=input-group-control]:focus-visible]:ring-ring dark:bg-transparent">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          ref={searchRef}
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
            if (event.key === "Enter") {
              list.element?.focus()
              picking.current = !pickFirstMatch()
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="xs"
            title="Compare refs, or Shift-select commits for a range"
            onClick={() =>
              openCompare({
                head: selection._tag === "Commit" ? selection.oid : "HEAD",
                mode: selection._tag === "Commit" ? "direct" : "merge-base",
              })
            }
          >
            Compare…
          </InputGroupButton>
        </InputGroupAddon>
        {summary !== null && (
          <InputGroupAddon align="inline-end">
            <InputGroupText className="tabular-nums">{summary}</InputGroupText>
            <InputGroupButton size="xs" onClick={() => onQueryChange("")}>
              Clear
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {failed ? (
        <Nothing
          title={filtering ? "Search failed" : "Couldn't load history"}
          description={describeFailure(result.cause)}
          onRetry={refreshLog}
        />
      ) : filtering && log?.done === true && loaded === 0 && !pending ? (
        <Nothing
          title="No matching commits"
          description="Search looks at HEAD and the locations shown in the sidebar."
        />
      ) : (
        <ScrollArea
          className="@container min-h-0 flex-1"
          viewportRef={list.ref}
          scrollbarClassName="opacity-0 transition-opacity duration-500 hover:opacity-100 hover:duration-150 data-scrolling:opacity-100 data-scrolling:duration-150"
          viewportProps={{
            tabIndex: 0,
            role: "listbox",
            "aria-label": "Commits. Use Shift and arrow keys to compare a range.",
            "aria-multiselectable": true,
            className:
              "[contain:strict] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          }}
        >
          <div className="relative w-full" style={{ height: list.height }}>
            {list.rows.map((row) => (
              <div
                key={row.index}
                className="absolute top-0 left-0 w-full"
                style={{ height: ROW_HEIGHT, transform: `translateY(${row.top}px)` }}
              >
                {row.index < offset && status !== undefined ? (
                  <div
                    role="option"
                    aria-selected={selection._tag === "WorkingCopy"}
                    onClick={() => onSelect({ _tag: "WorkingCopy" })}
                    className={cn(
                      "flex h-full w-full items-center gap-2 px-2 text-left whitespace-nowrap",
                      selection._tag === "WorkingCopy" ? "bg-selection" : "hover:bg-muted/60",
                    )}
                  >
                    <span style={{ width: graphWidth }} className="flex shrink-0 justify-start">
                      <span className="ml-[3px] size-2 rounded-full border-2 border-dashed border-muted-foreground" />
                    </span>
                    <span className="font-medium">Uncommitted changes</span>
                    <span className="truncate text-muted-foreground">{changeSummary(status)}</span>
                  </div>
                ) : log !== undefined ? (
                  <CommitRowView
                    repo={repo}
                    log={log.key}
                    logId={log.logId}
                    index={row.index - offset}
                    graphWidth={graphWidth}
                    labels={labels}
                    headOid={headOid}
                    selectedOid={selection._tag === "Commit" ? selection.oid : undefined}
                    selected={
                      selectedRange !== null &&
                      row.index - offset >= Math.min(selectedRange.anchor, selectedRange.cursor) &&
                      row.index - offset <= Math.max(selectedRange.anchor, selectedRange.cursor)
                    }
                    onPick={(extend) => {
                      list.element?.focus({ preventScroll: true })
                      selectIndex(row.index, extend)
                    }}
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
  log,
  logId,
  index,
  graphWidth,
  labels,
  headOid,
  selectedOid,
  selected,
  onPick,
  report,
}: {
  repo: RepoId
  log: string
  logId: string
  index: number
  graphWidth: number
  labels: Map<string, Array<RefLabel>>
  headOid: string | undefined
  selectedOid: Oid | undefined
  selected: boolean
  onPick: (extend: boolean) => void
  report: (lanes: number) => void
}) {
  const pageAtom = logPageAtom(logPageKey(log, logId, Math.floor(index / LOG_PAGE_SIZE)))
  const page = useAtomValue(pageAtom)
  const refreshPage = useAtomRefresh(pageAtom)
  const date = useHistoryDate()
  const row: CommitRow | undefined = latest(page)?.[index % LOG_PAGE_SIZE]
  const isSelected = selected || (row !== undefined && row.oid === selectedOid)
  useEffect(() => {
    if (row !== undefined) report(lanesUsed(row.graph))
  }, [row, report])

  if (row === undefined) {
    const error = loadError(page)
    return (
      <div className="flex h-full items-center gap-2 px-2">
        <span className="shrink-0" style={{ width: graphWidth }} />
        {error === undefined ? (
          <Skeleton className="h-2.5 w-1/3" />
        ) : (
          <>
            <span className="min-w-0 truncate text-muted-foreground">Couldn't load: {error}</span>
            <Button size="xs" variant="ghost" className="shrink-0" onClick={refreshPage}>
              Retry
            </Button>
          </>
        )}
      </div>
    )
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full">
        <div
          role="option"
          aria-selected={isSelected}
          onClick={(event) => onPick(event.shiftKey)}
          className={cn(
            "flex h-full w-full items-center gap-2 overflow-hidden px-2 text-left",
            isSelected ? "bg-selection" : "hover:bg-muted/60",
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
            {date(row.time)}
          </span>
          <span className="hidden w-14 shrink-0 font-mono text-[11px] text-muted-foreground @3xl:block">
            {shortOid(row.oid)}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <CommitMenuItems repo={repo} row={row} />
      </ContextMenuContent>
    </ContextMenu>
  )
})
