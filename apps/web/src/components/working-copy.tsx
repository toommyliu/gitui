import { useAtomValue } from "@effect/atom-react"
import type {
  Change,
  LineAction,
  LineSelection,
  Operation,
  RepoId,
  RepoPath,
  Status,
  StatusEntry,
} from "@gitui/contracts"
import type { CodeViewDiffItem, CodeViewLineSelection } from "@pierre/diffs"
import type { CodeViewHandle } from "@pierre/diffs/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "cn"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { basename, dirname } from "@/lib/format"
import {
  type ClickMode,
  click,
  type FileSelection,
  move,
  reconcile,
  selectAll,
  selectedRows,
  type Side,
} from "@/lib/file-selection"
import { diffAtom, diffKey, latest, statusAtom, useGitAction } from "@/lib/git"
import { hunkChanges, selectedChanges } from "@/lib/lines"
import { ChangeLetter } from "./change-letter"
import { HistoryButton } from "./commit-detail"
import { useConfirm } from "./confirm"
import { Loading, Nothing } from "./loading"
import { useStashPrompt } from "./stash-prompt"
import { useDraft } from "@/lib/draft"
import { ChevronDownIcon, ChevronRightIcon, ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react"
import {
  type Collapse,
  DiffStack,
  type DiffItemMeta,
  GutterButton,
  hasText,
  type HoveredLine,
  itemMeta,
  patchItems,
  useCollapse,
} from "./diff-view"

type Area = "unstaged" | "untracked" | "conflicted" | "staged"

interface FileRow {
  readonly area: Area
  readonly path: RepoPath
  readonly paths: ReadonlyArray<RepoPath>
  readonly change: Change
  readonly label: string
}

const MAX_UNTRACKED_PREVIEWS = 50
const ROW = 28

const classify = (entries: ReadonlyArray<StatusEntry>) => {
  const unstaged: Array<FileRow> = []
  const staged: Array<FileRow> = []
  for (const entry of entries) {
    switch (entry._tag) {
      case "Untracked":
        unstaged.push({ area: "untracked", path: entry.path, paths: [entry.path], change: "added", label: "untracked" })
        break
      case "Conflicted":
        unstaged.push({
          area: "conflicted",
          path: entry.path,
          paths: [entry.path],
          change: "modified",
          label: "conflict",
        })
        break
      case "Tracked": {
        if (entry.unstaged !== null) {
          unstaged.push({ area: "unstaged", path: entry.path, paths: [entry.path], change: entry.unstaged, label: "" })
        }
        if (entry.staged !== null) {
          const paths = entry.from === null ? [entry.path] : [entry.from, entry.path]
          staged.push({ area: "staged", path: entry.path, paths, change: entry.staged, label: entry.from ?? "" })
        }
        break
      }
    }
  }
  return { unstaged, staged }
}

type SideLabels = { readonly ours: string; readonly theirs: string }

const sideLabels: Record<Operation, SideLabels> = {
  merge: { ours: "Keep mine", theirs: "Take theirs" },
  rebase: { ours: "Keep upstream", theirs: "Keep my commit" },
  "cherry-pick": { ours: "Keep mine", theirs: "Take picked" },
  revert: { ours: "Keep mine", theirs: "Take revert" },
  bisect: { ours: "Keep mine", theirs: "Take theirs" },
}

const operationNames: Record<Operation, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
  bisect: "Bisect",
}

function OperationBanner({ repo, operation, conflicts }: { repo: RepoId; operation: Operation; conflicts: number }) {
  const git = useGitAction()
  const confirm = useConfirm()
  const name = operationNames[operation]
  const canSkip = operation === "rebase" || operation === "cherry-pick" || operation === "revert"
  return (
    <Alert className="m-2 w-auto">
      <AlertTitle>{name} in progress</AlertTitle>
      <AlertDescription>
        {conflicts > 0
          ? `${conflicts} ${conflicts === 1 ? "file has" : "files have"} conflicts. Resolve them, then continue.`
          : "No conflicts left. Continue to finish."}
      </AlertDescription>
      <div className="col-span-full mt-1 flex gap-1">
        {operation !== "bisect" && (
          <Button
            size="xs"
            disabled={conflicts > 0}
            onClick={() => void git(`Continue ${name.toLowerCase()}`, repo, (c) => c("ContinueOperation", { repo }))}
          >
            Continue
          </Button>
        )}
        {canSkip && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => void git(`Skip`, repo, (c) => c("SkipOperation", { repo }))}
          >
            Skip this commit
          </Button>
        )}
        <Button
          size="xs"
          variant="destructive"
          onClick={() =>
            confirm({
              title: `Abort ${name.toLowerCase()}?`,
              body: <p>The branch goes back to where it was before the {name.toLowerCase()} started.</p>,
              confirmLabel: "Abort",
              destructive: true,
              onConfirm: () => void git(`Abort ${name.toLowerCase()}`, repo, (c) => c("AbortOperation", { repo })),
            })
          }
        >
          Abort
        </Button>
      </div>
    </Alert>
  )
}

function DiffToggle({ side, ids, collapse }: { side: Side; ids: ReadonlyArray<string>; collapse: Collapse }) {
  if (ids.length === 0) return null
  const expanded = ids.some((id) => !collapse.ids.has(id))
  const label = `${expanded ? "Collapse" : "Expand"} ${side} diffs`
  return (
    <Button size="icon-sm" variant="ghost" aria-label={label} title={label} onClick={() => collapse.set(ids, expanded)}>
      {expanded ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
    </Button>
  )
}

function EmptyDiff({ conflicts, files }: { conflicts: boolean; files: number }) {
  if (conflicts) {
    return (
      <Nothing
        title="Resolve conflicts"
        description="Keep one side with the buttons in the file list, or edit the file and mark it resolved."
      />
    )
  }
  if (files > 0)
    return <Nothing title="No text diff" description="These changes are binary or only change file modes." />
  return <Nothing title="No changes" description="The working tree matches HEAD." />
}

function useLastLoaded<A>(repo: RepoId, value: A | undefined): A | undefined {
  const [kept, setKept] = useState<{ readonly repo: RepoId; readonly value: A } | null>(null)
  if (value !== undefined && (kept?.value !== value || kept.repo !== repo)) setKept({ repo, value })
  return value ?? (kept?.repo === repo ? kept.value : undefined)
}

export function WorkingCopy({ repo, onHistory }: { repo: RepoId; onHistory: (path: string) => void }) {
  const status = latest(useAtomValue(statusAtom(repo)))
  const { unstaged, staged } = useMemo(() => classify(status?.entries ?? []), [status])
  const untrackedPaths = useMemo(
    () =>
      unstaged
        .filter((f) => f.area === "untracked")
        .slice(0, MAX_UNTRACKED_PREVIEWS)
        .map((f) => f.path),
    [unstaged],
  )

  const unstagedDiff = latest(useAtomValue(diffAtom(diffKey(repo, { _tag: "Unstaged" }))))
  const stagedDiff = latest(useAtomValue(diffAtom(diffKey(repo, { _tag: "Staged" }))))
  const untrackedDiff = useLastLoaded(
    repo,
    latest(useAtomValue(diffAtom(diffKey(repo, { _tag: "Untracked" }, untrackedPaths)))),
  )

  const items = useMemo(
    () => [
      ...(unstagedDiff?._tag === "Patch" ? patchItems("unstaged", unstagedDiff.patch) : []),
      ...(untrackedPaths.length > 0 && untrackedDiff?._tag === "Patch"
        ? patchItems("untracked", untrackedDiff.patch)
        : []),
      ...(stagedDiff?._tag === "Patch" ? patchItems("staged", stagedDiff.patch) : []),
    ],
    [unstagedDiff, stagedDiff, untrackedDiff, untrackedPaths.length],
  )
  const diffs = untrackedPaths.length > 0 ? [unstagedDiff, stagedDiff, untrackedDiff] : [unstagedDiff, stagedDiff]
  const diffsLoading = diffs.some((d) => d === undefined)
  const tooLarge = diffs.some((d) => d?._tag === "TooLarge")

  const git = useGitAction()
  const confirm = useConfirm()
  const stage = (paths: ReadonlyArray<RepoPath>) => git("Stage", repo, (c) => c("Stage", { repo, paths }))
  const unstage = (paths: ReadonlyArray<RepoPath>) => git("Unstage", repo, (c) => c("Unstage", { repo, paths }))
  const discard = (rows: ReadonlyArray<FileRow>) =>
    confirm({
      title: rows.length === 1 ? `Discard changes to ${basename(rows[0]!.path)}?` : `Discard ${rows.length} files?`,
      body: rows.some((r) => r.area === "untracked") ? (
        <p>Untracked files will be deleted. This can't be undone.</p>
      ) : (
        <p>The working tree copy will be reset to the staged version. This can't be undone.</p>
      ),
      confirmLabel: "Discard",
      destructive: true,
      onConfirm: () => git("Discard", repo, (c) => c("Discard", { repo, paths: rows.flatMap((r) => r.paths) })),
    })

  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null)
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const selected = useMemo(() => {
    const item = selection === null ? undefined : itemsById.get(selection.id)
    if (selection === null || item === undefined) return null
    const changes = selectedChanges(item.fileDiff, selection.range)
    return changes.length === 0 ? null : { meta: itemMeta(item.id), changes }
  }, [selection, itemsById])

  const applyLines = async (action: LineAction, path: RepoPath, lines: ReadonlyArray<LineSelection>) => {
    const label = action === "stage" ? "Stage lines" : action === "unstage" ? "Unstage lines" : "Discard lines"
    if (await git(label, repo, (c) => c("ApplyLines", { repo, action, path, lines }))) setSelection(null)
  }
  const discardLines = (path: RepoPath, lines: ReadonlyArray<LineSelection>) =>
    confirm({
      title: `Discard ${lines.length} ${lines.length === 1 ? "line" : "lines"} in ${basename(path)}?`,
      body: <p>The working tree will lose these changes. This can't be undone.</p>,
      confirmLabel: "Discard",
      destructive: true,
      onConfirm: () => void applyLines("discard", path, lines),
    })

  const hunkAt = (line: HoveredLine, item: CodeViewDiffItem) => {
    const meta = itemMeta(item.id)
    if (meta.section === "untracked") return null
    const lines = hunkChanges(item.fileDiff, line.lineNumber, line.side)
    return lines.length === 0 ? null : { meta, lines, staged: meta.section === "staged" }
  }
  const gutter = (line: HoveredLine, item: CodeViewDiffItem) => {
    const hunk = hunkAt(line, item)
    if (hunk === null) return null
    return (
      <GutterButton
        label={hunk.staged ? "Unstage hunk" : "Stage hunk"}
        onPress={() => void applyLines(hunk.staged ? "unstage" : "stage", hunk.meta.path, hunk.lines)}
      >
        {hunk.staged ? "−" : "+"}
      </GutterButton>
    )
  }

  const collapse = useCollapse()
  const sectionIds = useMemo(() => {
    const unstagedIds: Array<string> = []
    const stagedIds: Array<string> = []
    for (const item of items) {
      if (hasText(item)) (itemMeta(item.id).section === "staged" ? stagedIds : unstagedIds).push(item.id)
    }
    return { unstaged: unstagedIds, staged: stagedIds }
  }, [items])

  const viewRef = useRef<CodeViewHandle<undefined, undefined>>(null)
  const reveal = (row: FileRow) => {
    const section = row.area === "staged" ? "staged" : row.area === "untracked" ? "untracked" : "unstaged"
    const id = `${section}\n${row.path}`
    collapse.set([id], false)
    viewRef.current?.scrollTo({ type: "item", id, align: "start" })
  }

  const rowsByItem = useMemo(() => {
    const map = new Map<string, FileRow>()
    for (const row of [...unstaged, ...staged])
      map.set(`${row.area === "staged" ? "staged" : row.area}\n${row.path}`, row)
    return map
  }, [unstaged, staged])

  const actions = (meta: DiffItemMeta) => {
    const row = rowsByItem.get(`${meta.section}\n${meta.path}`)
    if (row === undefined) return null
    const history = row.area !== "untracked" && <HistoryButton onClick={() => onHistory(row.path)} />
    return row.area === "staged" ? (
      <span className="flex gap-1">
        {history}
        <Button size="sm" variant="outline" onClick={() => unstage(row.paths)}>
          Unstage
        </Button>
      </span>
    ) : (
      <span className="flex gap-1">
        {history}
        <Button size="sm" variant="ghost" onClick={() => discard([row])}>
          Discard
        </Button>
        <Button size="sm" variant="outline" onClick={() => stage(row.paths)}>
          Stage
        </Button>
      </span>
    )
  }

  if (status === undefined) return <Loading label="Loading changes" />

  return (
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel defaultSize="42%" minSize="20%">
        <div className="flex h-full flex-col">
          {status.operation !== null && (
            <OperationBanner
              repo={repo}
              operation={status.operation}
              conflicts={unstaged.filter((row) => row.area === "conflicted").length}
            />
          )}
          <CommitBox repo={repo} status={status} stagedCount={staged.length} />
          <FileLists
            unstaged={unstaged}
            staged={staged}
            onReveal={reveal}
            diffToggle={(side) => <DiffToggle side={side} ids={sectionIds[side]} collapse={collapse} />}
            onStage={(rows) => stage(rows.flatMap((r) => r.paths))}
            onUnstage={(rows) => unstage(rows.flatMap((r) => r.paths))}
            onDiscard={discard}
            sides={status.operation === null ? null : sideLabels[status.operation]}
            onResolve={(rows, side) =>
              void git("Resolve conflict", repo, (c) =>
                c("ResolveConflict", { repo, paths: rows.map((r) => r.path), side }),
              )
            }
          />
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel minSize="20%">
        {diffsLoading ? (
          <Loading label="Loading diffs" />
        ) : tooLarge ? (
          <Nothing
            title="Too large to diff"
            description="These changes are over 4 MB, so they aren't shown together."
          />
        ) : items.length === 0 ? (
          <EmptyDiff
            conflicts={unstaged.some((row) => row.area === "conflicted")}
            files={unstaged.length + staged.length}
          />
        ) : (
          <div className="relative h-full">
            <DiffStack
              repo={repo}
              items={items}
              actions={actions}
              viewRef={viewRef}
              collapse={collapse}
              lines={{ selection, onSelectionChange: setSelection, gutter }}
            />
            {selected !== null && (
              <div className="absolute bottom-3 left-1/2 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-3 py-1.5 text-popover-foreground shadow-md">
                <span className="min-w-0 truncate">
                  {selected.changes.length} {selected.changes.length === 1 ? "line" : "lines"} in{" "}
                  {basename(selected.meta.path)}
                </span>
                {selected.meta.section === "untracked" ? (
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                    Untracked files stage as a whole.
                  </span>
                ) : selected.meta.section === "staged" ? (
                  <Button size="xs" onClick={() => void applyLines("unstage", selected.meta.path, selected.changes)}>
                    Unstage
                  </Button>
                ) : (
                  <>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => discardLines(selected.meta.path, selected.changes)}
                    >
                      Discard
                    </Button>
                    <Button size="xs" onClick={() => void applyLines("stage", selected.meta.path, selected.changes)}>
                      Stage
                    </Button>
                  </>
                )}
                <Button size="xs" variant="ghost" onClick={() => setSelection(null)}>
                  Clear
                </Button>
              </div>
            )}
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function CommitBox({ repo, status, stagedCount }: { repo: RepoId; status: Status; stagedCount: number }) {
  const { message, setMessage, onFocus, onBlur, clear } = useDraft(repo)
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const git = useGitAction()
  const stash = useStashPrompt(repo)

  const canCommit = !busy && message.trim() !== "" && (stagedCount > 0 || amend) && status.operation !== "rebase"
  const commit = async () => {
    if (!canCommit) return
    setBusy(true)
    const ok = await git(amend ? "Amend" : "Commit", repo, (c) => c("Commit", { repo, message, amend }))
    setBusy(false)
    if (ok) {
      clear()
      setAmend(false)
    }
  }

  return (
    <div className="shrink-0 space-y-1.5 border-b p-2">
      <Textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void commit()
          }
        }}
        placeholder={status.operation === null ? "Commit message" : `Commit message (${status.operation} in progress)`}
        rows={3}
        className="min-h-0 resize-none font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <Field orientation="horizontal" className="w-auto">
          <Checkbox id={`amend-${repo}`} checked={amend} onCheckedChange={setAmend} />
          <FieldLabel
            htmlFor={`amend-${repo}`}
            className="block py-1 font-normal text-muted-foreground [text-box:trim-both_cap_alphabetic]"
          >
            Amend previous commit
          </FieldLabel>
        </Field>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={status.entries.length === 0 || status.operation !== null}
          onClick={stash}
        >
          Stash…
        </Button>
        <Button size="sm" disabled={!canCommit} onClick={() => void commit()}>
          {busy && <Spinner data-icon="inline-start" />}
          {amend
            ? "Amend"
            : stagedCount > 0
              ? `Commit ${stagedCount} ${stagedCount === 1 ? "file" : "files"}`
              : "Commit"}
          <KbdGroup className="max-md:hidden">
            <Kbd>⌘</Kbd>
            <Kbd>↩</Kbd>
          </KbdGroup>
        </Button>
      </div>
    </div>
  )
}

function FileLists({
  unstaged,
  staged,
  onReveal,
  diffToggle,
  onStage,
  onUnstage,
  onDiscard,
  sides,
  onResolve,
}: {
  unstaged: ReadonlyArray<FileRow>
  staged: ReadonlyArray<FileRow>
  onReveal: (row: FileRow) => void
  diffToggle: (side: Side) => ReactNode
  onStage: (rows: ReadonlyArray<FileRow>) => void
  onUnstage: (rows: ReadonlyArray<FileRow>) => void
  onDiscard: (rows: ReadonlyArray<FileRow>) => void
  sides: SideLabels | null
  onResolve: (rows: ReadonlyArray<FileRow>, side: "ours" | "theirs") => void
}) {
  const lists = useMemo(() => ({ unstaged, staged }), [unstaged, staged])
  const [storedSelection, setSelection] = useState<FileSelection | null>(null)
  const selection = reconcile(storedSelection, lists)
  if (selection !== storedSelection) setSelection(selection)
  const selected = selectedRows(selection, lists)
  const unstagedViewport = useRef<HTMLDivElement>(null)
  const stagedViewport = useRef<HTMLDivElement>(null)
  const viewports = { unstaged: unstagedViewport, staged: stagedViewport }
  const [closed, setClosed] = useState<ReadonlySet<Side>>(() => new Set())

  const toggleSection = (side: Side) => {
    const next = new Set(closed)
    if (!next.delete(side)) next.add(side)
    setClosed(next)
    if (next.has(side) && selection?.side === side) setSelection(null)
  }

  const select = (next: FileSelection | null, reveal: boolean) => {
    setSelection(next)
    if (next === null) return
    viewports[next.side].current?.focus({ preventScroll: true })
    if (reveal) onReveal(lists[next.side][next.leadIndex]!)
  }

  const onKeyDown = (side: Side) => (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget && (event.target as HTMLElement).getAttribute("role") !== "option") return
    const current = selection?.side === side ? selection : null
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const mod = event.metaKey || event.ctrlKey
    const delta = key === "ArrowDown" || key === "j" ? 1 : key === "ArrowUp" || key === "k" ? -1 : 0
    if (delta !== 0 && !mod && !event.altKey) {
      const next = move(current, lists, side, delta, event.shiftKey)
      if (next !== current && (next === null || !closed.has(next.side))) select(next, true)
    } else if (mod && key === "a") {
      select(selectAll(lists, side), false)
    } else if (key === "Escape" && current !== null) {
      setSelection(null)
    } else if (key === " " && current !== null) {
      if (side === "staged") onUnstage(selected)
      else onStage(selected)
    } else if ((key === "Backspace" || key === "Delete") && current !== null && side === "unstaged") {
      const rows = selected.filter((r) => r.area !== "conflicted")
      if (rows.length > 0) onDiscard(rows)
    } else return
    event.preventDefault()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(["unstaged", "staged"] as const).map((side) => (
        <FileSection
          key={side}
          side={side}
          rows={lists[side]}
          open={!closed.has(side)}
          onToggle={() => toggleSection(side)}
          selection={selection?.side === side ? selection : null}
          selected={selection?.side === side ? selected : []}
          viewportRef={viewports[side]}
          onKeyDown={onKeyDown(side)}
          onClick={(row, mode) => select(click(selection, lists, side, row.path, mode), mode === "only")}
          diffToggle={diffToggle}
          sides={sides}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={onDiscard}
          onResolve={onResolve}
        />
      ))}
    </div>
  )
}

interface RowActions {
  readonly sides: SideLabels | null
  readonly onStage: (rows: ReadonlyArray<FileRow>) => void
  readonly onUnstage: (rows: ReadonlyArray<FileRow>) => void
  readonly onDiscard: (rows: ReadonlyArray<FileRow>) => void
  readonly onResolve: (rows: ReadonlyArray<FileRow>, side: "ours" | "theirs") => void
}

function FileSection({
  side,
  rows,
  open,
  onToggle,
  selection,
  selected,
  viewportRef,
  onKeyDown,
  onClick,
  diffToggle,
  ...actions
}: RowActions & {
  side: Side
  rows: ReadonlyArray<FileRow>
  open: boolean
  onToggle: () => void
  selection: FileSelection | null
  selected: ReadonlyArray<FileRow>
  viewportRef: React.RefObject<HTMLDivElement | null>
  onKeyDown: (event: React.KeyboardEvent) => void
  onClick: (row: FileRow, mode: ClickMode) => void
  diffToggle: (side: Side) => ReactNode
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  })
  const lead = selection?.leadIndex
  useEffect(() => {
    if (lead !== undefined) virtualizer.scrollToIndex(lead, { align: "auto" })
  }, [lead, virtualizer])

  const label = side === "unstaged" ? "Unstaged" : "Staged"
  const border = side === "staged" ? 1 : 0
  return (
    <section
      aria-label={label}
      className={cn("flex min-h-7 flex-1 basis-0 flex-col", border > 0 && "border-t")}
      style={{ maxHeight: ((open ? rows.length : 0) + 1) * ROW + border }}
    >
      <SectionHeader
        side={side}
        label={label}
        rows={rows}
        open={open}
        onToggle={onToggle}
        selected={selected}
        diffToggle={diffToggle}
        {...actions}
      />
      <ScrollArea
        className={cn("min-h-0 flex-1", !open && "hidden")}
        viewportRef={viewportRef}
        viewportProps={{
          tabIndex: open && rows.length > 0 ? 0 : -1,
          onKeyDown,
          role: "listbox",
          "aria-label": `${label} files`,
          "aria-multiselectable": true,
          className: "[contain:strict] data-has-overflow-y:pr-2.5",
        }}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!
            return (
              <div
                key={item.key}
                className="absolute top-0 left-0 w-full"
                style={{ height: ROW, transform: `translateY(${item.start}px)` }}
              >
                <FileRowView
                  row={row}
                  selected={selection?.paths.has(row.path) === true}
                  onClick={onClick}
                  {...actions}
                />
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </section>
  )
}

function SectionHeader({
  side,
  label,
  rows,
  open,
  onToggle,
  selected,
  diffToggle,
  sides,
  onStage,
  onUnstage,
  onDiscard,
  onResolve,
}: RowActions & {
  side: Side
  label: string
  rows: ReadonlyArray<FileRow>
  open: boolean
  onToggle: () => void
  selected: ReadonlyArray<FileRow>
  diffToggle: (side: Side) => ReactNode
}) {
  const multi = selected.length > 1
  const targets = multi ? selected : rows
  const count = (rows: ReadonlyArray<FileRow>) => (multi ? rows.length : "all")
  const discardable = targets.filter((r) => r.area !== "conflicted")
  const conflicted = targets.filter((r) => r.area === "conflicted")
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 bg-muted/40 px-2 text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="-ml-1 flex h-6 items-center gap-2 rounded-sm px-1 text-[11px] font-semibold tracking-wide uppercase hover:text-foreground"
      >
        {open ? <ChevronDownIcon className="mx-0.5 size-3" /> : <ChevronRightIcon className="mx-0.5 size-3" />}
        <span className="[text-box:trim-both_cap_alphabetic]">{label}</span>
        <Badge variant="secondary" className="h-4 rounded-sm px-1 text-[10px] tabular-nums">
          {rows.length}
        </Badge>
      </button>
      {rows.length > 0 && (
        <span className="ml-auto flex gap-1">
          {diffToggle(side)}
          {side === "staged" ? (
            <Button size="sm" variant="ghost" onClick={() => onUnstage(targets)}>
              Unstage {count(targets)}
            </Button>
          ) : (
            <>
              {multi && sides !== null && conflicted.length > 0 && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => onResolve(conflicted, "ours")}>
                    {sides.ours} {conflicted.length}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onResolve(conflicted, "theirs")}>
                    {sides.theirs} {conflicted.length}
                  </Button>
                </>
              )}
              {discardable.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => onDiscard(discardable)}>
                  Discard {count(discardable)}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onStage(targets)}>
                Stage {count(targets)}
              </Button>
            </>
          )}
        </span>
      )}
    </div>
  )
}

function FileRowView({
  row,
  selected,
  onClick,
  sides,
  onStage,
  onUnstage,
  onDiscard,
  onResolve,
}: RowActions & {
  row: FileRow
  selected: boolean
  onClick: (row: FileRow, mode: ClickMode) => void
}) {
  return (
    <div className={cn("group flex h-full items-center gap-2 px-2", selected ? "bg-selection" : "hover:bg-muted/60")}>
      <button
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={selected}
        onMouseDown={(event) => event.shiftKey && event.preventDefault()}
        onClick={(event) =>
          onClick(row, event.shiftKey ? "extend" : event.metaKey || event.ctrlKey ? "toggle" : "only")
        }
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <ChangeLetter change={row.change} />
        <span className="truncate">
          <span className="text-muted-foreground">{dirname(row.path)}</span>
          {basename(row.path)}
        </span>
        {row.label !== "" && (
          <span
            className={cn(
              "shrink-0 text-[11px] text-muted-foreground",
              row.area === "conflicted" && "text-destructive",
            )}
          >
            {row.area === "staged" ? `from ${row.label}` : row.label}
          </span>
        )}
      </button>
      <span className="flex shrink-0 gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
        {row.area === "staged" ? (
          <Button size="sm" variant="ghost" onClick={() => onUnstage([row])}>
            Unstage
          </Button>
        ) : (
          <>
            {row.area === "conflicted" && sides !== null ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => onResolve([row], "ours")}>
                  {sides.ours}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onResolve([row], "theirs")}>
                  {sides.theirs}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => onDiscard([row])}>
                Discard
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onStage([row])}>
              {row.area === "conflicted" ? "Mark resolved" : "Stage"}
            </Button>
          </>
        )}
      </span>
    </div>
  )
}
