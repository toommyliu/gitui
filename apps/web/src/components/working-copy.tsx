import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type {
  Change,
  CommitDetail,
  LineAction,
  LineSelection,
  RepoId,
  RepoPath,
  Status,
  StatusEntry,
} from "@gitui/contracts"
import type { CodeViewDiffItem, CodeViewLineSelection } from "@pierre/diffs"
import type { CodeViewHandle } from "@pierre/diffs/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ButtonGroup } from "@/components/ui/button-group"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "cn"
import { type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react"
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
import { useAppHotkeys } from "@tanstack/react-hotkeys"
import { commitAtom, diffAtom, diffKey, latest, loadError, statusAtom, useGitAction } from "@/lib/git"
import { commitRunAtom, useCommit } from "@/lib/commit-workflow"
import { settingsAtom } from "@/lib/settings"
import { hunkChanges, selectedChanges, type WholeFile, wholeFile } from "@/lib/lines"
import { stashBlocked, stashFiles } from "@/lib/stash"
import { type CommandId, type KeyBinding, useCommand, useCommandKeys } from "@/lib/commands"
import { ChangeLetter } from "./change-letter"
import { CommitFeedback } from "./commit-feedback"
import { IdentityDialog, IdentityLine } from "./commit-identity"
import { useConflictActions } from "./conflict-view"
import { OperationBanner, openConflicts } from "./conflict-workspace"
import { OpenInButton } from "./open-in"
import { HistoryButton } from "./commit-detail"
import { useConfirm } from "./confirm"
import { useDiscard } from "./discard-recovery"
import { LargeDiff, Loading, Nothing } from "./loading"
import { Shortcut } from "./shortcut"
import { useStashPrompt } from "./stash-prompt"
import { useDraft } from "@/lib/draft"
import { describeConflict, keepLabels, type Sides, sideNames } from "@/lib/conflicts"
import { dirtyPaths, useConflictSession } from "@/lib/conflict-session"
import { rebaseStateAtom } from "@/lib/rewrite"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
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

const withoutConflicts = (rows: ReadonlyArray<FileRow>) => rows.filter((row) => row.area !== "conflicted")

const wholeFileNames: Record<WholeFile, string> = {
  symlink: "Symlinks",
  submodule: "Submodules",
  mode: "Files with a mode change",
  type: "File type changes",
}

const wholeFileNote = (kind: WholeFile, section: string) =>
  `${wholeFileNames[kind]} ${section === "staged" ? "unstage" : "stage"} as a whole.`

const noPaths: ReadonlySet<RepoPath> = new Set()

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

function EmptyDiff({ files }: { files: number }) {
  if (files > 0)
    return <Nothing title="No text diff" description="These changes are binary or only change file modes." />
  return <Nothing title="No changes" description="The working tree matches HEAD." />
}

function useLastLoaded<A>(key: string, value: A | undefined): A | undefined {
  const [kept, setKept] = useState<{ readonly key: string; readonly value: A } | null>(null)
  if (value !== undefined && (kept?.value !== value || kept.key !== key)) setKept({ key, value })
  return value ?? (kept?.key === key ? kept.value : undefined)
}

export function WorkingCopy({ repo, onHistory }: { repo: RepoId; onHistory: (path: string) => void }) {
  const [allowLarge, setAllowLarge] = useState(false)
  const statusResult = useAtomValue(statusAtom(repo))
  const refreshStatus = useAtomRefresh(statusAtom(repo))
  const status = latest(statusResult)
  const { unstaged, staged } = useMemo(() => classify(status?.entries ?? []), [status])
  const conflicts = useMemo(
    () => (status?.entries ?? []).flatMap((entry) => (entry._tag === "Conflicted" ? [entry] : [])),
    [status],
  )
  const conflictPaths = useMemo(() => conflicts.map((entry) => entry.path), [conflicts])
  const lists = useMemo(() => ({ unstaged, staged }), [unstaged, staged])
  const [storedFileSelection, setFileSelection] = useState<FileSelection | null>(null)
  const fileSelection = reconcile(storedFileSelection, lists)
  if (fileSelection !== storedFileSelection) setFileSelection(fileSelection)
  const lead = fileSelection === null ? undefined : lists[fileSelection.side][fileSelection.leadIndex]
  const inspected = lead?.area === "conflicted" && fileSelection?.paths.has(lead.path) === true ? lead.path : null
  const untrackedPaths = useMemo(
    () =>
      unstaged
        .filter((f) => f.area === "untracked")
        .slice(0, MAX_UNTRACKED_PREVIEWS)
        .map((f) => f.path),
    [unstaged],
  )
  const [onDemand, setOnDemand] = useState<RepoPath | null>(null)
  const onDemandPaths = useMemo(
    () =>
      onDemand !== null &&
      !untrackedPaths.includes(onDemand) &&
      unstaged.some((f) => f.area === "untracked" && f.path === onDemand)
        ? [onDemand]
        : [],
    [onDemand, untrackedPaths, unstaged],
  )

  const unstagedAtom = diffAtom(diffKey(repo, { _tag: "Unstaged" }, [], false, allowLarge))
  const stagedAtom = diffAtom(diffKey(repo, { _tag: "Staged" }, [], false, allowLarge))
  const untrackedAtom = diffAtom(diffKey(repo, { _tag: "Untracked" }, untrackedPaths, false, allowLarge))
  const onDemandAtom = diffAtom(diffKey(repo, { _tag: "Untracked" }, onDemandPaths, false, allowLarge))
  const unstagedResult = useAtomValue(unstagedAtom)
  const stagedResult = useAtomValue(stagedAtom)
  const untrackedResult = useAtomValue(untrackedAtom)
  const onDemandResult = useAtomValue(onDemandAtom)
  const unstagedDiff = latest(unstagedResult)
  const stagedDiff = latest(stagedResult)
  const loadedKey = `${repo}\n${allowLarge}`
  const untrackedDiff = useLastLoaded(loadedKey, latest(untrackedResult))
  const onDemandDiff = useLastLoaded(loadedKey, latest(onDemandResult))
  const registry = useContext(RegistryContext)

  const items = useMemo(
    () => [
      ...(unstagedDiff?._tag === "Patch" ? patchItems("unstaged", unstagedDiff.patch) : []),
      ...(untrackedPaths.length > 0 && untrackedDiff?._tag === "Patch"
        ? patchItems("untracked", untrackedDiff.patch)
        : []),
      ...(onDemandPaths.length > 0 && onDemandDiff?._tag === "Patch"
        ? patchItems("untracked", onDemandDiff.patch)
        : []),
      ...(stagedDiff?._tag === "Patch" ? patchItems("staged", stagedDiff.patch) : []),
    ],
    [unstagedDiff, stagedDiff, untrackedDiff, untrackedPaths.length, onDemandDiff, onDemandPaths.length],
  )
  const diffs = [
    unstagedDiff,
    stagedDiff,
    ...(untrackedPaths.length > 0 ? [untrackedDiff] : []),
    ...(onDemandPaths.length > 0 ? [onDemandDiff] : []),
  ]
  const diffsLoading = diffs.some((d) => d === undefined)
  const diffError = diffsLoading
    ? [
        unstagedResult,
        stagedResult,
        ...(untrackedPaths.length > 0 ? [untrackedResult] : []),
        ...(onDemandPaths.length > 0 ? [onDemandResult] : []),
      ]
        .map(loadError)
        .find((error) => error !== undefined)
    : undefined
  const tooLarge = diffs.some((d) => d?._tag === "TooLarge")
  const largeBytes = tooLarge
    ? diffs.reduce(
        (sum, diff) =>
          sum +
          (diff?._tag === "TooLarge"
            ? diff.bytes
            : diff?._tag === "Patch"
              ? new TextEncoder().encode(diff.patch).length
              : 0),
        0,
      )
    : 0

  const git = useGitAction()
  const runDiscard = useDiscard()
  const confirm = useConfirm()
  const conflictActions = useConflictActions(repo)
  const [conflictSession, openSession] = useConflictSession(repo)
  const stage = (paths: ReadonlyArray<RepoPath>) => git("Stage", repo, (c) => c("Stage", { repo, paths }))
  const unstage = (paths: ReadonlyArray<RepoPath>) => git("Unstage", repo, (c) => c("Unstage", { repo, paths }))
  const discard = (rows: ReadonlyArray<FileRow>) =>
    confirm({
      title: rows.length === 1 ? `Discard changes to ${basename(rows[0]!.path)}?` : `Discard ${rows.length} files?`,
      body: rows.some((r) => r.area === "untracked") ? (
        <p>Untracked files will be deleted. You can undo this, or restore them later from Recovery.</p>
      ) : (
        <p>
          The working tree copy will be reset to the staged version. You can undo this, or restore it later from
          Recovery.
        </p>
      ),
      confirmLabel: "Discard",
      destructive: true,
      onConfirm: () => void runDiscard({ _tag: "Files", repo, paths: rows.flatMap((r) => r.paths) }),
    })

  const fileTypeChanges = useMemo(
    () =>
      new Set(
        [...unstaged, ...staged].filter((row) => row.change === "typechange").map((row) => `${row.area}\n${row.path}`),
      ),
    [unstaged, staged],
  )
  const [selection, setSelection] = useState<CodeViewLineSelection | null>(null)
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const selected = useMemo(() => {
    const item = selection === null ? undefined : itemsById.get(selection.id)
    if (selection === null || item === undefined) return null
    const changes = selectedChanges(item.fileDiff, selection.range)
    return changes.length === 0
      ? null
      : {
          meta: itemMeta(item.id),
          changes,
          whole: fileTypeChanges.has(item.id) ? ("type" as const) : wholeFile(item.fileDiff),
        }
  }, [selection, itemsById, fileTypeChanges])

  const applyLines = async (action: LineAction, path: RepoPath, lines: ReadonlyArray<LineSelection>) => {
    const applied =
      action === "discard"
        ? await runDiscard({ _tag: "Lines", repo, path, lines })
        : await git(action === "stage" ? "Stage lines" : "Unstage lines", repo, (c) =>
            c("ApplyLines", { repo, action, path, lines }),
          )
    if (applied) setSelection(null)
  }
  const discardLines = (path: RepoPath, lines: ReadonlyArray<LineSelection>) =>
    confirm({
      title: `Discard ${lines.length} ${lines.length === 1 ? "line" : "lines"} in ${basename(path)}?`,
      body: (
        <p>The working tree will lose these changes. You can undo this, or restore the file later from Recovery.</p>
      ),
      confirmLabel: "Discard",
      destructive: true,
      onConfirm: () => void applyLines("discard", path, lines),
    })

  const hunkAt = (line: HoveredLine, item: CodeViewDiffItem) => {
    if (fileTypeChanges.has(item.id) || wholeFile(item.fileDiff) !== null) return null
    const meta = itemMeta(item.id)
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
  const [revealing, setRevealing] = useState<{ readonly id: string } | null>(null)
  const revealed = useRef<object | null>(null)
  useEffect(() => {
    if (diffsLoading || tooLarge || diffError !== undefined) return
    if (revealing === null || revealed.current === revealing || !itemsById.has(revealing.id)) return
    revealed.current = revealing
    // A CodeView that mounts in this commit (after "Too large to diff") ignores a scrollTo until it has laid out.
    requestAnimationFrame(() => viewRef.current?.scrollTo({ type: "item", id: revealing.id, align: "start" }))
  }, [revealing, itemsById, diffsLoading, tooLarge, diffError])
  const reveal = (row: FileRow) => {
    if (row.area === "conflicted") return
    const section = row.area === "staged" ? "staged" : row.area === "untracked" ? "untracked" : "unstaged"
    const id = `${section}\n${row.path}`
    collapse.set([id], false)
    setOnDemand(row.area === "untracked" && !untrackedPaths.includes(row.path) ? row.path : null)
    setRevealing({ id })
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

  if (status === undefined) {
    const error = loadError(statusResult)
    return error === undefined ? (
      <Loading label="Loading changes" />
    ) : (
      <Nothing title="Couldn't read the working copy" description={error} onRetry={refreshStatus} />
    )
  }

  const firstConflict = conflictPaths[0]
  const shownConflict =
    inspected ??
    (firstConflict !== undefined && !diffsLoading && diffError === undefined && items.length === 0
      ? firstConflict
      : null)
  const conflictIndex = shownConflict === null ? -1 : conflictPaths.indexOf(shownConflict)
  const conflictEntry = conflicts[conflictIndex]

  return (
    <ResizablePanelGroup orientation="vertical">
      <ResizablePanel defaultSize="42%" minSize="20%">
        <div className="flex h-full flex-col">
          {(status.operation !== null || conflicts.length > 0 || dirtyPaths(conflictSession).length > 0) && (
            <OperationBanner repo={repo} status={status} conflicts={conflicts.length} />
          )}
          <CommitBox
            repo={repo}
            status={status}
            stagedCount={staged.length}
            selection={fileSelection?.paths ?? noPaths}
          />
          <FileLists
            repo={repo}
            lists={lists}
            selection={fileSelection}
            onSelectionChange={setFileSelection}
            onReveal={reveal}
            diffToggle={(side) => <DiffToggle side={side} ids={sectionIds[side]} collapse={collapse} />}
            onStage={(rows) => stage(rows.flatMap((r) => r.paths))}
            onUnstage={(rows) => unstage(rows.flatMap((r) => r.paths))}
            onDiscard={discard}
            sides={keepLabels(status.operation)}
            busy={conflictActions.busy}
            onResolve={(rows, side) =>
              conflictActions.keep(
                rows.map((r) => r.path),
                side,
              )
            }
            onMarkResolved={(row) => conflictActions.markResolved(row.path)}
            onOpenConflict={(row) => openSession(openConflicts(row.path))}
          />
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel minSize="20%">
        {conflictEntry !== undefined ? (
          <Nothing
            title={inspected === null ? "Resolve conflicts" : `${basename(conflictEntry.path)} has conflicts`}
            description={
              inspected === null
                ? `${conflicts.length} ${conflicts.length === 1 ? "file has" : "files have"} conflicts. Open the resolver to work through them.`
                : `${describeConflict(conflictEntry.code, sideNames(status.operation))}. Open it in the resolver, or press Enter.`
            }
            action={{ label: "Open in resolver", onClick: () => openSession(openConflicts(conflictEntry.path)) }}
          />
        ) : diffError !== undefined ? (
          <Nothing
            title="Couldn't load the diffs"
            description={diffError}
            onRetry={() =>
              [unstagedAtom, stagedAtom, untrackedAtom, onDemandAtom].forEach((atom) => registry.refresh(atom))
            }
          />
        ) : diffsLoading ? (
          <Loading label="Loading diffs" />
        ) : tooLarge ? (
          <LargeDiff bytes={largeBytes} onShow={() => setAllowLarge(true)} />
        ) : items.length === 0 ? (
          <EmptyDiff files={unstaged.length + staged.length} />
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
                {selected.whole !== null ? (
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                    {wholeFileNote(selected.whole, selected.meta.section)}
                  </span>
                ) : selected.meta.section === "staged" ? (
                  <Button size="xs" onClick={() => void applyLines("unstage", selected.meta.path, selected.changes)}>
                    Unstage
                  </Button>
                ) : (
                  <>
                    {selected.meta.section !== "untracked" && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => discardLines(selected.meta.path, selected.changes)}
                      >
                        Discard
                      </Button>
                    )}
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

const noCommit = Atom.make(AsyncResult.initial<CommitDetail, never>())

function CommitBox({
  repo,
  status,
  stagedCount,
  selection,
}: {
  repo: RepoId
  status: Status
  stagedCount: number
  selection: ReadonlySet<RepoPath>
}) {
  const rebase = latest(useAtomValue(rebaseStateAtom(repo)))
  const editing = status.operation === "rebase" && rebase?._tag === "Rebase" && rebase.phase === "edit"
  const splitting = editing && rebase.split
  const draft = useDraft(repo)
  const [amend, setAmend] = useState(false)
  const [amendEdit, setAmendEdit] = useState<string | null>(null)
  const [identityOpen, setIdentityOpen] = useState(false)
  const running = useAtomValue(commitRunAtom(repo))?._tag === "Running"
  const committer = useCommit(repo)
  const stash = useStashPrompt(repo)
  const stashDisabled = running || status.entries.length === 0 || stashBlocked(status)
  const selectedFiles = useMemo(() => stashFiles(status, selection).files.length, [status, selection])

  const amendOid =
    status.head._tag === "Unborn" ||
    splitting ||
    (status.operation !== null && status.operation !== "bisect" && !editing)
      ? null
      : status.head.oid
  const amending = amend && amendOid !== null
  const head = latest(useAtomValue(amending ? commitAtom(`${repo}\n${amendOid}`) : noCommit))
  const message = amending ? (amendEdit ?? head?.message ?? "") : draft.message
  const setMessage = amending ? setAmendEdit : draft.setMessage
  const toggleAmend = (checked: boolean) => {
    setAmend(checked)
    setAmendEdit(null)
  }

  const canCommit =
    !running && message.trim() !== "" && (stagedCount > 0 || amending) && (status.operation !== "rebase" || editing)
  const commit = async () => {
    if (!canCommit) return
    if (!(await committer.run({ message, amend: amending }))) return
    if (amending) toggleAmend(false)
    else draft.clear()
  }
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useCommandKeys([{ id: "commit.create", run: () => void commit() }], { target: textareaRef })
  const commitHotkey = useAppHotkeys()["commit.create"].hotkey
  const guide = useAtomValue(settingsAtom).subjectGuide
  const subjectLength = message.split("\n", 1)[0]?.length ?? 0

  return (
    <div className="shrink-0 space-y-1.5 border-b p-2">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onFocus={draft.onFocus}
          onBlur={draft.onBlur}
          readOnly={running}
          placeholder={
            amending && head === undefined
              ? "Loading the previous commit message…"
              : status.operation === null
                ? "Commit message"
                : `Commit message (${status.operation} in progress)`
          }
          rows={3}
          className={cn("min-h-0 resize-none font-mono text-xs", guide !== "off" && "pb-5")}
        />
        {guide !== "off" && subjectLength > 0 && (
          <span
            className={cn(
              "pointer-events-none absolute right-2 bottom-1.5 text-[11px] tabular-nums",
              subjectLength > Number(guide) ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {subjectLength}/{guide}
          </span>
        )}
      </div>
      <IdentityLine
        repo={repo}
        amending={amending}
        originalAuthor={head?.author}
        onEdit={() => setIdentityOpen(true)}
      />
      <div className="flex items-center gap-2">
        <Field orientation="horizontal" className="w-auto" data-disabled={amendOid === null || running}>
          <Checkbox
            id={`amend-${repo}`}
            checked={amending}
            disabled={amendOid === null || running}
            onCheckedChange={toggleAmend}
          />
          <FieldLabel
            htmlFor={`amend-${repo}`}
            className="block py-1 font-normal text-muted-foreground [text-box:trim-both_cap_alphabetic]"
          >
            Amend previous commit
          </FieldLabel>
        </Field>
        <ButtonGroup className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            disabled={stashDisabled}
            onClick={() => stash(status, { _tag: "All", keepIndex: false })}
          >
            Stash…
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="outline"
                  disabled={stashDisabled}
                  aria-label="More ways to stash"
                  title="More ways to stash"
                />
              }
            >
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuItem onClick={() => stash(status, { _tag: "All", keepIndex: false })}>
                Stash all changes…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={stagedCount === 0}
                onClick={() => stash(status, { _tag: "All", keepIndex: true })}
              >
                Stash unstaged, keep staged…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={selectedFiles === 0}
                onClick={() => stash(status, { _tag: "Files", paths: selection })}
              >
                {selectedFiles === 0
                  ? "Stash selected files…"
                  : `Stash ${selectedFiles} selected ${selectedFiles === 1 ? "file" : "files"}…`}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
        <Button size="sm" disabled={!canCommit} onClick={() => void commit()}>
          {running && <Spinner data-icon="inline-start" />}
          {amending
            ? "Amend"
            : stagedCount > 0
              ? `Commit ${stagedCount} ${stagedCount === 1 ? "file" : "files"}`
              : "Commit"}
          {commitHotkey !== null && <Shortcut hotkey={commitHotkey} className="max-md:hidden" />}
        </Button>
      </div>
      <CommitFeedback repo={repo} onEditIdentity={() => setIdentityOpen(true)} />
      <IdentityDialog repo={repo} open={identityOpen} onOpenChange={setIdentityOpen} />
    </div>
  )
}

function FileLists({
  repo,
  lists,
  selection,
  onSelectionChange: setSelection,
  onReveal,
  diffToggle,
  ...actions
}: RowActions & {
  repo: RepoId
  lists: Readonly<Record<Side, ReadonlyArray<FileRow>>>
  selection: FileSelection | null
  onSelectionChange: (selection: FileSelection | null) => void
  onReveal: (row: FileRow) => void
  diffToggle: (side: Side) => ReactNode
}) {
  const { unstaged, staged } = lists
  const { onStage, onUnstage, onDiscard, onMarkResolved } = actions
  const selected = selectedRows(selection, lists)
  const unstagedViewport = useRef<HTMLDivElement>(null)
  const stagedViewport = useRef<HTMLDivElement>(null)
  const viewports = { unstaged: unstagedViewport, staged: stagedViewport }
  const [closed, setClosed] = useState<ReadonlySet<Side>>(() => new Set())
  const [focusRequest, setFocusRequest] = useState<{ readonly side: Side } | null>(null)
  useEffect(() => {
    if (focusRequest === null) return
    const viewport = focusRequest.side === "unstaged" ? unstagedViewport : stagedViewport
    viewport.current?.focus({ preventScroll: true })
  }, [focusRequest])

  const toggleSection = (side: Side) => {
    const next = new Set(closed)
    if (!next.delete(side)) next.add(side)
    setClosed(next)
    if (next.has(side) && selection?.side === side) setSelection(null)
  }

  const select = (next: FileSelection | null, reveal: boolean) => {
    setSelection(next)
    if (next === null) return
    setFocusRequest({ side: next.side })
    if (reveal) onReveal(lists[next.side][next.leadIndex]!)
  }

  const fileKeys = (side: Side): ReadonlyArray<KeyBinding> => {
    const current = selection?.side === side ? selection : null
    const step = (delta: 1 | -1, extend: boolean) => () => {
      const next = move(current, lists, side, delta, extend)
      if (next !== current && (next === null || !closed.has(next.side))) select(next, true)
    }
    const bindings: ReadonlyArray<readonly [CommandId, () => void]> = [
      ["list.next", step(1, false)],
      ["list.previous", step(-1, false)],
      ["files.extendNext", step(1, true)],
      ["files.extendPrevious", step(-1, true)],
      ["files.selectAll", () => select(selectAll(lists, side), false)],
      ["files.clear", () => setSelection(null)],
      [
        "files.stage",
        () => {
          if (current === null) return
          const only = selected.length === 1 ? selected[0]! : null
          if (side === "staged") onUnstage(selected)
          else if (only?.area === "conflicted") {
            if (!actions.busy.has(only.path)) onMarkResolved(only)
          } else onStage(withoutConflicts(selected))
        },
      ],
      [
        "files.discard",
        () => {
          const rows = withoutConflicts(selected)
          if (current !== null && side === "unstaged" && rows.length > 0) onDiscard(rows)
        },
      ],
    ]
    return bindings.map(([id, run]) => ({
      id,
      run: (event) => {
        const target = event.target
        if (target !== event.currentTarget && !(target instanceof Element && target.role === "option")) return
        event.preventDefault()
        run()
      },
    }))
  }
  const stageable = withoutConflicts(unstaged)
  useCommand("files.stageAll", () => onStage(stageable), { enabled: stageable.length > 0 })
  useCommand("files.unstageAll", () => onUnstage(staged), { enabled: staged.length > 0 })
  const listKeys = { preventDefault: false, stopPropagation: false }
  useCommandKeys(fileKeys("unstaged"), { ...listKeys, target: unstagedViewport })
  useCommandKeys(fileKeys("staged"), { ...listKeys, target: stagedViewport })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(["unstaged", "staged"] as const).map((side) => (
        <FileSection
          repo={repo}
          key={side}
          side={side}
          rows={lists[side]}
          open={!closed.has(side)}
          onToggle={() => toggleSection(side)}
          selection={selection?.side === side ? selection : null}
          selected={selection?.side === side ? selected : []}
          viewportRef={viewports[side]}
          onClick={(row, mode) => select(click(selection, lists, side, row.path, mode), mode === "only")}
          onEnter={() => {
            const lead = selection?.side === side ? lists[side][selection.leadIndex] : undefined
            if (lead?.area !== "conflicted") return false
            actions.onOpenConflict(lead)
            return true
          }}
          diffToggle={diffToggle}
          {...actions}
        />
      ))}
    </div>
  )
}

interface RowActions {
  readonly sides: Sides
  readonly busy: ReadonlySet<RepoPath>
  readonly onStage: (rows: ReadonlyArray<FileRow>) => void
  readonly onUnstage: (rows: ReadonlyArray<FileRow>) => void
  readonly onDiscard: (rows: ReadonlyArray<FileRow>) => void
  readonly onResolve: (rows: ReadonlyArray<FileRow>, side: "ours" | "theirs") => void
  readonly onMarkResolved: (row: FileRow) => void
  readonly onOpenConflict: (row: FileRow) => void
}

function FileSection({
  repo,
  side,
  rows,
  open,
  onToggle,
  selection,
  selected,
  viewportRef,
  onClick,
  onEnter,
  diffToggle,
  ...actions
}: RowActions & {
  repo: RepoId
  side: Side
  rows: ReadonlyArray<FileRow>
  open: boolean
  onToggle: () => void
  selection: FileSelection | null
  selected: ReadonlyArray<FileRow>
  viewportRef: React.RefObject<HTMLDivElement | null>
  onClick: (row: FileRow, mode: ClickMode) => void
  onEnter: () => boolean
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
        scrollbarClassName="opacity-0 transition-opacity duration-500 hover:opacity-100 hover:duration-150 data-scrolling:opacity-100 data-scrolling:duration-150"
        viewportProps={{
          tabIndex: open && rows.length > 0 ? 0 : -1,
          role: "listbox",
          "aria-label": `${label} files`,
          "aria-multiselectable": true,
          onKeyDown: (event) => {
            if (event.key === "Enter" && event.target === event.currentTarget && onEnter()) event.preventDefault()
          },
          className: "[contain:strict] focus-visible:ring-0 focus-visible:outline-none",
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
                  repo={repo}
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
  busy,
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
  const count = (subset: ReadonlyArray<FileRow>) => (multi || subset.length < rows.length ? subset.length : "all")
  const changes = withoutConflicts(targets)
  const conflicted = targets.filter((r) => r.area === "conflicted")
  const toolOpen = conflicted.some((r) => busy.has(r.path))
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
              {multi && conflicted.length > 0 && (
                <>
                  <Button size="sm" variant="ghost" disabled={toolOpen} onClick={() => onResolve(conflicted, "ours")}>
                    {sides.ours} {conflicted.length}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={toolOpen} onClick={() => onResolve(conflicted, "theirs")}>
                    {sides.theirs} {conflicted.length}
                  </Button>
                </>
              )}
              {changes.length > 0 && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => onDiscard(changes)}>
                    Discard {count(changes)}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onStage(changes)}>
                    Stage {count(changes)}
                  </Button>
                </>
              )}
            </>
          )}
        </span>
      )}
    </div>
  )
}

function FileRowView({
  repo,
  row,
  selected,
  onClick,
  sides,
  busy,
  onStage,
  onUnstage,
  onDiscard,
  onResolve,
  onMarkResolved,
  onOpenConflict,
}: RowActions & {
  repo: RepoId
  row: FileRow
  selected: boolean
  onClick: (row: FileRow, mode: ClickMode) => void
}) {
  const toolOpen = busy.has(row.path)
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
        onDoubleClick={() => row.area === "conflicted" && onOpenConflict(row)}
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
        <OpenInButton repo={repo} file={{ path: row.path }} compact disabled={row.change === "deleted"} />
        {row.area === "staged" ? (
          <Button size="sm" variant="ghost" onClick={() => onUnstage([row])}>
            Unstage
          </Button>
        ) : (
          <>
            {row.area === "conflicted" ? (
              <>
                <Button size="sm" variant="ghost" disabled={toolOpen} onClick={() => onResolve([row], "ours")}>
                  {sides.ours}
                </Button>
                <Button size="sm" variant="ghost" disabled={toolOpen} onClick={() => onResolve([row], "theirs")}>
                  {sides.theirs}
                </Button>
                <Button size="sm" variant="ghost" disabled={toolOpen} onClick={() => onMarkResolved(row)}>
                  Mark resolved
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => onDiscard([row])}>
                  Discard
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onStage([row])}>
                  Stage
                </Button>
              </>
            )}
          </>
        )}
      </span>
    </div>
  )
}
