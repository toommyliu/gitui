import { RegistryContext, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type {
  ConflictCode,
  ConflictDetail,
  ConflictFile,
  ConflictRef,
  Operation,
  RepoId,
  RepoPath,
} from "@gitui/contracts"
import { cleanLastNewline, type CodeViewItem, parseDiffFromFile } from "@pierre/diffs"
import { CodeView } from "@pierre/diffs/react"
import { cn } from "cn"
import { ArrowLeftIcon, ArrowRightIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { type KeyboardEvent, type ReactNode, type RefObject, useContext, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  type Block,
  type BlockState,
  blockState,
  type Choice,
  choiceText,
  fromDisplay,
  joinSegments,
  lineCount,
  normalizeNewlines,
  parseSegments,
  type Segment,
  toDisplay,
  withText,
} from "@/lib/conflict-blocks"
import { type Draft, dropDraft, isDirty, type Resolved, type SessionUpdate } from "@/lib/conflict-session"
import { conflictMarkers, describeConflict, type Sides, sideNames } from "@/lib/conflicts"
import { basename, dirname, shortOid } from "@/lib/format"
import {
  conflictAtom,
  conflictKey,
  latest,
  loadError,
  mergeToolsAtom,
  saveConflictAtom,
  useFailureToast,
  useGitAction,
} from "@/lib/git"
import { useConfirm } from "./confirm"
import { CommitReference } from "./commit-reference"
import { hash, SEPARATOR_HEIGHT, UNSAFE_CSS, useDiffAppearance } from "./diff-view"
import { Loading, Nothing } from "./loading"

export const size = (count: number) =>
  count < 1024
    ? `${count} bytes`
    : count < 1024 * 1024
      ? `${(count / 1024).toFixed(1)} KB`
      : `${(count / 1024 / 1024).toFixed(1)} MB`

export function useConflictActions(repo: RepoId) {
  const git = useGitAction()
  const confirm = useConfirm()
  const fail = useFailureToast()
  const registry = useContext(RegistryContext)
  const toolsAtom = mergeToolsAtom(repo)
  const busy = useAtomValue(toolsAtom)

  const keep = (paths: ReadonlyArray<RepoPath>, side: "ours" | "theirs") =>
    git("Resolve conflict", repo, (c) => c("ResolveConflict", { repo, paths, side }))

  const markResolved = async (path: RepoPath, onDone?: () => void) => {
    const atom = conflictAtom(conflictKey(repo, path))
    registry.refresh(atom)
    const exit = await Effect.runPromiseExit(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
    if (Exit.isFailure(exit)) return fail("Mark resolved", exit.cause)
    const { result } = exit.value
    const markers = result._tag === "Text" ? conflictMarkers(result.content) : 0
    const stage = async () => {
      if (await git("Mark resolved", repo, (c) => c("Stage", { repo, paths: [path] }))) onDone?.()
    }
    if (markers === 0) return void stage()
    confirm({
      title: `Mark ${basename(path)} resolved?`,
      body: (
        <p>
          It still has {markers} unresolved {markers === 1 ? "conflict" : "conflicts"}. Git will stage the file with the
          conflict markers in it.
        </p>
      ),
      confirmLabel: "Mark resolved",
      onConfirm: () => void stage(),
    })
  }

  const runMergeTool = async (path: RepoPath) => {
    registry.update(toolsAtom, (paths) => new Set(paths).add(path))
    await git("Merge tool", repo, (c) => c("RunMergeTool", { repo, path }))
    registry.update(toolsAtom, (paths) => {
      const next = new Set(paths)
      next.delete(path)
      return next
    })
  }

  return {
    busy,
    keep,
    markResolved: (path: RepoPath, onDone?: () => void) => void markResolved(path, onDone),
    runMergeTool,
  }
}

type SaveMode = "next" | "stay" | "unstaged"

export function ConflictFilePane({
  repo,
  path,
  code,
  operation,
  draft,
  update,
  onResolved,
}: {
  repo: RepoId
  path: RepoPath
  code: ConflictCode
  operation: Operation | null
  draft: Draft | undefined
  update: SessionUpdate
  onResolved: (path: RepoPath, resolved: Resolved, advance: boolean) => void
}) {
  const atom = conflictAtom(conflictKey(repo, path))
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const detail = latest(result)
  const error = loadError(result)
  const names = sideNames(operation)

  if (detail === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <FileHeader path={path} code={code} names={names} />
        {error !== undefined ? (
          <Nothing title="Couldn't read this conflict" description={error} onRetry={refresh} />
        ) : (
          <Loading label="Loading conflict" />
        )}
      </div>
    )
  }
  const textual =
    detail.editable && detail.result._tag === "Text" && detail.ours._tag === "Text" && detail.theirs._tag === "Text"
  return textual ? (
    <TextResolver
      repo={repo}
      detail={detail}
      result={detail.result.content}
      code={code}
      names={names}
      stored={draft}
      update={update}
      onResolved={onResolved}
    />
  ) : (
    <Decision
      repo={repo}
      detail={detail}
      code={code}
      names={names}
      draft={draft}
      update={update}
      onResolved={onResolved}
    />
  )
}

function FileHeader({
  path,
  code,
  names,
  children,
}: {
  path: RepoPath
  code: ConflictCode
  names: Sides
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1">
      <h2 className="min-w-0 truncate font-medium">
        <span className="text-muted-foreground">{dirname(path)}</span>
        {basename(path)}
      </h2>
      <span className="shrink-0 text-xs text-destructive">{describeConflict(code, names)}</span>
      {children}
    </div>
  )
}

function useWholeFile({
  repo,
  detail,
  names,
  draft,
  update,
  onResolved,
}: {
  repo: RepoId
  detail: ConflictDetail
  names: Sides
  draft: Draft | undefined
  update: SessionUpdate
  onResolved: (path: RepoPath, resolved: Resolved, advance: boolean) => void
}) {
  const { busy, keep, markResolved } = useConflictActions(repo)
  const confirm = useConfirm()
  const { path } = detail
  const dirty = draft !== undefined && isDirty(draft)
  const guard = (title: string, run: () => void) =>
    dirty
      ? confirm({
          title,
          body: <p>Your unsaved edits to {basename(path)} will be lost.</p>,
          confirmLabel: "Discard edits and continue",
          destructive: true,
          onConfirm: run,
        })
      : run()
  const take = (side: "ours" | "theirs") =>
    guard(`Use ${names[side].toLowerCase()} for the whole file?`, async () => {
      if (!(await keep([path], side))) return
      const file = detail[side]
      update(dropDraft(path, draft))
      onResolved(
        path,
        { how: file._tag === "Missing" ? "deleted" : side, content: file._tag === "Text" ? file.content : null },
        true,
      )
    })
  const asIs = () =>
    guard(`Stage ${basename(path)} as it is on disk?`, () =>
      markResolved(path, () => {
        update(dropDraft(path, draft))
        const result = detail.result
        onResolved(
          path,
          {
            how: result._tag === "Missing" ? "deleted" : "as-is",
            content: result._tag === "Text" ? result.content : null,
          },
          true,
        )
      }),
    )
  const sideLabel = (side: "ours" | "theirs") =>
    detail[side]._tag === "Missing"
      ? `Delete the file, as ${names[side].toLowerCase()} did`
      : `Use ${names[side].toLowerCase()} for the whole file`
  return { running: busy.has(path), take, asIs, sideLabel }
}

function MergeToolButton({
  repo,
  detail,
  dirty,
  onSave,
  onDiscard,
}: {
  repo: RepoId
  detail: ConflictDetail
  dirty: boolean
  onSave: () => Promise<boolean>
  onDiscard: () => void
}) {
  const { busy, runMergeTool } = useConflictActions(repo)
  const confirm = useConfirm()
  const { path, mergeTool } = detail
  if (mergeTool === null) return null
  const running = busy.has(path)
  const open = () =>
    dirty
      ? confirm({
          title: `Open ${basename(path)} in ${mergeTool}?`,
          body: (
            <p>
              You have unsaved edits. {mergeTool} reads the file on disk, so save them first or discard them. Saving
              doesn't stage the file.
            </p>
          ),
          confirmLabel: "Save and open",
          onConfirm: () =>
            void onSave().then((saved) => {
              if (saved) void runMergeTool(path)
            }),
          alternative: {
            label: "Discard and open",
            onClick: () => {
              onDiscard()
              void runMergeTool(path)
            },
          },
        })
      : void runMergeTool(path)
  return (
    <Button size="sm" variant="ghost" disabled={running} onClick={open}>
      {running && <Spinner data-icon="inline-start" />}
      {running ? `Waiting for ${mergeTool}…` : `Open in ${mergeTool}`}
    </Button>
  )
}

function WholeFileMenu({ whole, disabled }: { whole: ReturnType<typeof useWholeFile>; disabled: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={disabled} />}>
        Whole file
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onClick={() => whole.take("ours")}>{whole.sideLabel("ours")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => whole.take("theirs")}>{whole.sideLabel("theirs")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={whole.asIs}>Stage the file on disk as it is</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const stateLabels: Record<BlockState, string> = {
  unresolved: "Unresolved",
  ours: "Mine",
  theirs: "Theirs",
  both: "Both",
  base: "Base",
  edited: "Edited",
}

const stateLabel = (state: BlockState, names: Sides) =>
  state === "ours"
    ? `Uses ${names.ours.toLowerCase()}`
    : state === "theirs"
      ? `Uses ${names.theirs.toLowerCase()}`
      : stateLabels[state]

function TextResolver({
  repo,
  detail,
  result,
  code,
  names,
  stored,
  update,
  onResolved,
}: {
  repo: RepoId
  detail: ConflictDetail
  result: string
  code: ConflictCode
  names: Sides
  stored: Draft | undefined
  update: SessionUpdate
  onResolved: (path: RepoPath, resolved: Resolved, advance: boolean) => void
}) {
  const { path } = detail
  const { style: appearance } = useDiffAppearance()
  const fresh = useMemo<Draft>(() => {
    const baseline = normalizeNewlines(result)
    return { version: detail.version, baseline, segments: parseSegments(baseline, detail) }
  }, [detail, result])
  const dirty = stored !== undefined && isDirty(stored)
  const draft = stored !== undefined && (dirty || stored.version === fresh.version) ? stored : fresh
  const changedOnDisk = dirty && stored.version !== fresh.version
  const content = joinSegments(draft.segments)
  const remaining = conflictMarkers(content)
  const blocks = draft.segments.flatMap((segment, index) => (segment._tag === "Block" ? [index] : []))

  const [view, setView] = useState<"result" | "base">("result")
  const [current, setCurrent] = useState(0)
  const [saving, setSaving] = useState(false)
  const registry = useContext(RegistryContext)
  const save = useAtomSet(saveConflictAtom, { mode: "promiseExit" })
  const fail = useFailureToast()
  const confirm = useConfirm()
  const whole = useWholeFile({ repo, detail, names, draft: stored, update, onResolved })
  const locked = saving || whole.running
  const headers = useRef(new Map<number, HTMLElement>())
  const boxes = useRef(new Map<number, HTMLTextAreaElement>())

  const setSegments = (segments: ReadonlyArray<Segment>) =>
    update((session) => ({
      ...session,
      drafts: new Map(session.drafts).set(path, { version: draft.version, baseline: draft.baseline, segments }),
    }))
  const discard = () => update(dropDraft(path, stored))
  const acceptDisk = () =>
    update((session) => ({
      ...session,
      drafts: new Map(session.drafts).set(path, { ...draft, version: fresh.version, baseline: fresh.baseline }),
    }))

  const write = async (mode: SaveMode) => {
    setSaving(true)
    const stage = mode !== "unstaged"
    const exit = await save({ repo, path, content, expectedVersion: draft.version, stage })
    if (Exit.isFailure(exit)) {
      setSaving(false)
      fail(stage ? "Save and stage" : "Save", exit.cause)
      registry.refresh(conflictAtom(conflictKey(repo, path)))
      return false
    }
    if (stage) {
      update((session) => {
        const saved = new Set(session.saved)
        saved.delete(path)
        return { ...dropDraft(path, stored)(session), saved }
      })
      onResolved(path, { how: "edited", content }, mode === "next")
      return true
    }
    const atom = conflictAtom(conflictKey(repo, path))
    registry.refresh(atom)
    await Effect.runPromiseExit(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }))
    update((session) => ({ ...dropDraft(path, stored)(session), saved: new Set(session.saved).add(path) }))
    setSaving(false)
    return true
  }
  const submit = (mode: SaveMode) => {
    if (locked) return
    if (mode === "unstaged" || remaining === 0) return void write(mode)
    confirm({
      title: `Stage ${basename(path)} with conflict markers?`,
      body: (
        <p>
          It still has {remaining} unresolved {remaining === 1 ? "conflict" : "conflicts"}. Git will stage the file with
          the markers in it. Save without staging to keep working on it later.
        </p>
      ),
      confirmLabel: "Stage with markers",
      onConfirm: () => void write(mode),
    })
  }

  const focusBlock = (position: number) => {
    const index = blocks[position]
    if (index === undefined) return
    setCurrent(position)
    const header = headers.current.get(index)
    header?.scrollIntoView({ block: "nearest" })
    header?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
  }
  const step = (delta: 1 | -1) => {
    if (blocks.length === 0) return
    focusBlock((current + delta + blocks.length) % blocks.length)
  }
  const choose = (index: number, choice: Choice) => {
    const block = draft.segments[index] as Block
    const text = choiceText(block, choice)
    if (text !== null) setSegments(withText(draft.segments, index, text))
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey
    if (event.altKey && !mod && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault()
      step(event.key === "ArrowDown" ? 1 : -1)
    } else if (mod && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault()
      submit("unstaged")
    } else if (mod && !event.altKey && event.key === "Enter") {
      event.preventDefault()
      submit("next")
    }
  }
  const moveBetweenBoxes = (index: number, event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
    const box = event.currentTarget
    if (box.selectionStart !== box.selectionEnd) return
    const edges = [...boxes.current.keys()].sort((a, b) => a - b)
    const target =
      event.key === "ArrowDown" && !box.value.slice(box.selectionStart).includes("\n")
        ? edges.find((i) => i > index)
        : event.key === "ArrowUp" && !box.value.slice(0, box.selectionStart).includes("\n")
          ? edges.findLast((i) => i < index)
          : undefined
    const next = target === undefined ? undefined : boxes.current.get(target)
    if (next === undefined) return
    event.preventDefault()
    next.focus()
    const caret = event.key === "ArrowDown" ? 0 : next.value.length
    next.setSelectionRange(caret, caret)
  }

  const position = Math.min(current, Math.max(blocks.length - 1, 0))
  const starts: Array<number> = []
  let line = 1
  for (const segment of draft.segments) {
    starts.push(line)
    line += lineCount(segment.text)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <FileHeader path={path} code={code} names={names}>
        <span className="ml-auto flex max-w-full flex-wrap items-center gap-1">
          <MergeToolButton
            repo={repo}
            detail={detail}
            dirty={dirty}
            onSave={() => write("unstaged")}
            onDiscard={discard}
          />
          <WholeFileMenu whole={whole} disabled={locked} />
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || locked}
            onClick={() =>
              confirm({
                title: `Discard your edits to ${basename(path)}?`,
                body: <p>The editor goes back to the file on disk.</p>,
                confirmLabel: "Discard edits",
                destructive: true,
                onConfirm: discard,
              })
            }
          >
            Discard edits
          </Button>
          <ButtonGroup>
            <Button size="sm" disabled={locked} onClick={() => submit("next")} title="Save and stage (⌘↩)">
              {saving && <Spinner data-icon="inline-start" />}
              Save and stage
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="icon-sm" disabled={locked} aria-label="More ways to save" />}>
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto">
                <DropdownMenuItem onClick={() => submit("next")}>
                  Save and stage, then open the next file
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => submit("stay")}>Save and stage, stay on this file</DropdownMenuItem>
                <DropdownMenuItem onClick={() => submit("unstaged")}>Save without staging (⌘S)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ButtonGroup>
        </span>
      </FileHeader>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/40 px-2 text-muted-foreground">
        {blocks.length > 0 ? (
          <span className="flex items-center tabular-nums">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous conflict"
              title="Previous conflict (⌥↑)"
              onClick={() => step(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            Conflict {position + 1} of {blocks.length}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next conflict"
              title="Next conflict (⌥↓)"
              onClick={() => step(1)}
            >
              <ChevronRightIcon />
            </Button>
          </span>
        ) : (
          <span>No conflict blocks</span>
        )}
        <span aria-live="polite" className={cn("tabular-nums", remaining > 0 ? "text-destructive" : "text-foreground")}>
          {remaining === 0 ? "No markers left" : `${remaining} ${remaining === 1 ? "conflict" : "conflicts"} left`}
        </span>
        {dirty && <span className="text-amber-600 dark:text-amber-400">Unsaved edits</span>}
        {detail.base._tag === "Missing" && <span>No base: both sides added this file</span>}
        <ToggleGroup
          aria-label="Middle column"
          variant="outline"
          size="sm"
          spacing={0}
          className="ml-auto"
          value={[view]}
          onValueChange={(next: Array<string>) => {
            if (next[0] === "result" || next[0] === "base") setView(next[0])
          }}
        >
          <ToggleGroupItem value="result" className="px-2 text-xs">
            Result
          </ToggleGroupItem>
          <ToggleGroupItem value="base" className="px-2 text-xs">
            Base
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {changedOnDisk && (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-2 py-1.5">
          <span className="min-w-0 flex-1">
            {basename(path)} changed on disk after you started editing. Saving now would overwrite that change.
          </span>
          <Button size="sm" variant="outline" onClick={discard}>
            Reload from disk
          </Button>
          <Button size="sm" variant="ghost" onClick={acceptDisk}>
            Keep my edits
          </Button>
        </div>
      )}
      {view === "base" ? (
        <BaseColumns detail={detail} names={names} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain" role="group" aria-label="Merge editor">
          <div
            className="grid min-w-[42rem] grid-cols-3 font-mono"
            style={{ ...appearance, fontSize: "var(--diffs-font-size)", lineHeight: "var(--diffs-line-height)" }}
          >
            <ColumnHeading
              repo={repo}
              role={names.ours}
              detail={detail.labels.ours}
              className="border-conflict-ours/50 text-conflict-ours"
            />
            <div className="sticky top-0 z-10 flex h-8 min-w-0 items-center gap-2 border-x border-b bg-background px-2 font-sans text-xs">
              <span className="shrink-0 font-medium">Result</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={`Editable · saved to ${path}`}>
                editable · saved to {basename(path)}
              </span>
            </div>
            <ColumnHeading
              repo={repo}
              role={names.theirs}
              detail={detail.labels.theirs}
              className="border-conflict-theirs/50 text-conflict-theirs"
            />
            {draft.segments.map((segment, index) => {
              const start = starts[index]!
              const end = start + lineCount(segment.text) - 1
              const box = (
                <ResultBox
                  index={index}
                  segment={segment}
                  start={start}
                  readOnly={locked}
                  label={
                    segment._tag === "Block"
                      ? `Result for conflict ${blocks.indexOf(index) + 1}`
                      : `Result, lines ${start} to ${Math.max(start, end)}`
                  }
                  boxes={boxes}
                  onChange={(text) => setSegments(withText(draft.segments, index, text))}
                  onKeyDown={(event) => moveBetweenBoxes(index, event)}
                  onFocus={() => {
                    const at = blocks.indexOf(index)
                    if (at !== -1) setCurrent(at)
                  }}
                />
              )
              if (segment._tag === "Plain") {
                return (
                  <div key={index} className="contents">
                    <SourceText text={blocks.length === 0 ? fileText(detail.ours) : segment.original} />
                    {box}
                    <SourceText text={blocks.length === 0 ? fileText(detail.theirs) : segment.original} />
                  </div>
                )
              }
              const state = blockState(segment)
              const number = blocks.indexOf(index) + 1
              return (
                <div key={index} className="contents">
                  <div
                    ref={(element) => {
                      if (element === null) headers.current.delete(index)
                      else headers.current.set(index, element)
                    }}
                    role="group"
                    aria-label={`Conflict ${number} of ${blocks.length}, ${stateLabel(state, names).toLowerCase()}`}
                    className={cn(
                      "col-span-3 grid scroll-mt-8 grid-cols-3 border-y bg-muted/60 font-sans",
                      position === number - 1 && "bg-muted",
                    )}
                  >
                    <span className="flex min-h-8 items-center justify-end gap-1 px-2 py-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="bg-conflict-ours/10 text-conflict-ours hover:bg-conflict-ours/20 hover:text-conflict-ours dark:hover:bg-conflict-ours/20"
                        disabled={locked}
                        onClick={() => choose(index, "ours")}
                      >
                        Use {names.ours.toLowerCase()}
                        <ArrowRightIcon aria-hidden strokeWidth={1.5} data-icon="inline-end" />
                      </Button>
                    </span>
                    <span className="flex min-h-8 items-center gap-1 border-x px-2 py-1">
                      <span
                        title={`Conflict ${number} · ${stateLabel(state, names)}`}
                        className={cn(
                          "mr-auto truncate text-xs font-medium",
                          state === "unresolved" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        Conflict {number} · {stateLabel(state, names)}
                      </span>
                      <Button size="sm" variant="ghost" disabled={locked} onClick={() => choose(index, "both")}>
                        Both
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={locked || segment.base === null}
                        title={
                          segment.base === null
                            ? "The markers don't include the base. Set merge.conflictStyle to diff3 to get it."
                            : undefined
                        }
                        onClick={() => choose(index, "base")}
                      >
                        Base
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={locked || segment.text === segment.raw}
                        onClick={() => choose(index, "reset")}
                      >
                        Reset
                      </Button>
                    </span>
                    <span className="flex min-h-8 items-center gap-1 px-2 py-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="bg-conflict-theirs/10 text-conflict-theirs hover:bg-conflict-theirs/20 hover:text-conflict-theirs dark:hover:bg-conflict-theirs/20"
                        disabled={locked}
                        onClick={() => choose(index, "theirs")}
                      >
                        <ArrowLeftIcon aria-hidden strokeWidth={1.5} data-icon="inline-start" />
                        Use {names.theirs.toLowerCase()}
                      </Button>
                    </span>
                  </div>
                  <SourceText text={segment.ours} tone="ours" />
                  {box}
                  <SourceText text={segment.theirs} tone="theirs" />
                </div>
              )
            })}
          </div>
        </div>
      )}
      <p className="shrink-0 border-t px-2 py-1 text-xs text-muted-foreground">
        {blocks.length === 0
          ? "The side columns show each side's whole file."
          : "The side columns show each conflict with the lines Git merged on its own around it."}{" "}
        Edits stay in gitui until you save. {remaining > 0 && "Saving without staging keeps the file conflicted."}
      </p>
    </div>
  )
}

function ColumnHeading({
  repo,
  role,
  detail,
  className,
}: {
  repo: RepoId
  role: string
  detail: ConflictRef | null
  className: string
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex h-8 min-w-0 items-center gap-2 border-b-2 bg-background px-2 font-sans text-xs",
        className,
      )}
    >
      <span className="shrink-0 font-semibold">{role}</span>
      {detail !== null && <CommitReference repo={repo} reference={detail} />}
    </div>
  )
}

const fileText = (file: ConflictFile) => (file._tag === "Text" ? normalizeNewlines(file.content) : "")

const tones = {
  plain: "text-muted-foreground",
  ours: "bg-conflict-ours/10",
  theirs: "bg-conflict-theirs/10",
}

function SourceText({ text, tone = "plain" }: { text: string; tone?: keyof typeof tones }) {
  return text === "" ? (
    <div className={cn("px-3 font-sans text-xs text-muted-foreground italic", tones[tone])}>No lines</div>
  ) : (
    <pre className={cn("overflow-x-auto px-3 whitespace-pre select-text", tones[tone])}>{toDisplay(text)}</pre>
  )
}

const resultTones: Record<BlockState | "plain", string> = {
  plain: "",
  unresolved: "bg-destructive/10",
  ours: tones.ours,
  theirs: tones.theirs,
  both: "bg-muted/60",
  base: "bg-muted/60",
  edited: "bg-muted/60",
}

function ResultBox({
  index,
  segment,
  start,
  readOnly,
  label,
  boxes,
  onChange,
  onKeyDown,
  onFocus,
}: {
  index: number
  segment: Segment
  start: number
  readOnly: boolean
  label: string
  boxes: RefObject<Map<number, HTMLTextAreaElement>>
  onChange: (text: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus: () => void
}) {
  const value = toDisplay(segment.text)
  const lines = Math.max(1, lineCount(segment.text))
  return (
    <div className={cn("flex border-x", resultTones[segment._tag === "Plain" ? "plain" : blockState(segment)])}>
      <div aria-hidden className="w-10 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">
        {segment.text === "" ? " " : Array.from({ length: lines }, (_, i) => <div key={i}>{start + i}</div>)}
      </div>
      <textarea
        ref={(element) => {
          if (element === null) boxes.current.delete(index)
          else boxes.current.set(index, element)
        }}
        aria-label={label}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        wrap="off"
        rows={lines}
        placeholder={segment.text === "" ? "No lines" : undefined}
        onChange={(event) => onChange(fromDisplay(event.target.value, segment))}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className="min-w-0 flex-1 resize-none overflow-x-auto overflow-y-hidden bg-transparent p-0 pr-2 outline-none placeholder:font-sans placeholder:text-xs placeholder:italic focus-visible:bg-background/60 focus-visible:shadow-[inset_2px_0_0_var(--ring)]"
        style={{ minHeight: `calc(${lines} * var(--diffs-line-height))`, lineHeight: "var(--diffs-line-height)" }}
      />
    </div>
  )
}

function BaseColumns({ detail, names }: { detail: ConflictDetail; names: Sides }) {
  const { path, base } = detail
  const baseText = base._tag === "Text" ? base.content : null
  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 divide-x">
      <Column title={`${names.ours} compared with base`}>
        <SideBody path={path} base={base} side={detail.ours} />
      </Column>
      <Column title="Base · read-only. Your result edits are kept.">
        {baseText !== null ? (
          <FileCode path={path} contents={baseText} />
        ) : base._tag === "Missing" ? (
          <Nothing title="No base version" description="Both sides added this file." />
        ) : (
          unavailable(base, "The base version")
        )}
      </Column>
      <Column title={`${names.theirs} compared with base`}>
        <SideBody path={path} base={base} side={detail.theirs} />
      </Column>
    </div>
  )
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-col">
      <h3 className="flex h-7 shrink-0 items-center truncate border-b px-2 font-medium">{title}</h3>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

const describeFile = (file: ConflictFile) => {
  switch (file._tag) {
    case "Missing":
      return "No file"
    case "Submodule":
      return file.oid === null ? "Submodule is not initialized" : `Submodule at ${shortOid(file.oid)}`
    case "Binary":
      return `Binary file, ${size(file.bytes)}`
    case "TooLarge":
      return `Too large to show, ${size(file.bytes)}`
    case "Text": {
      const lines = lineCount(file.content)
      return `Text, ${lines} ${lines === 1 ? "line" : "lines"}`
    }
  }
}

const decisionTitle = (code: ConflictCode, names: Sides) => {
  const ours = names.ours.toLowerCase()
  const theirs = names.theirs.toLowerCase()
  switch (code) {
    case "UD":
      return `${names.theirs} deleted this file and ${ours} changed it.`
    case "DU":
      return `${names.ours} deleted this file and ${theirs} changed it.`
    case "AU":
      return `Only ${ours} added this file.`
    case "UA":
      return `Only ${theirs} added this file.`
    case "DD":
      return "Both sides deleted this file."
    case "AA":
      return "Both sides added a different file at this path."
    case "UU":
      return "Both sides changed this file."
  }
}

function Decision({
  repo,
  detail,
  code,
  names,
  draft,
  update,
  onResolved,
}: {
  repo: RepoId
  detail: ConflictDetail
  code: ConflictCode
  names: Sides
  draft: Draft | undefined
  update: SessionUpdate
  onResolved: (path: RepoPath, resolved: Resolved, advance: boolean) => void
}) {
  const whole = useWholeFile({ repo, detail, names, draft, update, onResolved })
  const submodule = [detail.base, detail.ours, detail.theirs, detail.result].some((file) => file._tag === "Submodule")
  const textSides = detail.ours._tag === "Text" && detail.theirs._tag === "Text" && detail.result._tag === "Text"
  const note = submodule
    ? "Resolve and commit the changes inside this submodule, then stage its checked-out commit here."
    : textSides
      ? "gitui can only edit regular UTF-8 text files. Pick a side, or edit the file somewhere else and stage it as it is."
      : "Pick the version to keep. Either choice stages the file."
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileHeader path={detail.path} code={code} names={names}>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <MergeToolButton
            repo={repo}
            detail={detail}
            dirty={false}
            onSave={() => Promise.resolve(true)}
            onDiscard={() => {}}
          />
        </span>
      </FileHeader>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <div>
            <h3 className="font-medium">{submodule ? "Submodule conflict" : decisionTitle(code, names)}</h3>
            <p className="text-muted-foreground">{note}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(["ours", "theirs"] as const).map((side) => (
              <section
                key={side}
                aria-label={names[side]}
                className={cn(
                  "flex flex-col gap-1.5 rounded-md border p-3",
                  side === "ours"
                    ? "border-conflict-ours/50 text-conflict-ours"
                    : "border-conflict-theirs/50 text-conflict-theirs",
                )}
              >
                <h4 className="font-semibold">{names[side]}</h4>
                {detail.labels[side] !== null && <CommitReference repo={repo} reference={detail.labels[side]} />}
                <p className="text-foreground">
                  {detail[side]._tag === "Missing" ? "Deleted the file" : describeFile(detail[side])}
                </p>
                {!submodule && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-auto self-start"
                    disabled={whole.running}
                    onClick={() => whole.take(side)}
                  >
                    {whole.sideLabel(side)}
                  </Button>
                )}
              </section>
            ))}
          </div>
          <section aria-label="Working file" className="flex items-center gap-2 rounded-md border p-3">
            <div className="min-w-0 flex-1">
              <h4 className="font-medium">On disk now</h4>
              <p className="text-muted-foreground">
                {describeFile(detail.result)}. Base: {describeFile(detail.base).toLowerCase()}.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={whole.running || (detail.result._tag === "Submodule" && detail.result.oid === null)}
              onClick={whole.asIs}
            >
              {detail.result._tag === "Missing"
                ? "Stage the deletion"
                : submodule
                  ? "Stage submodule"
                  : "Stage it as it is"}
            </Button>
          </section>
          {!submodule && detail.mergeTool === null && (
            <p className="text-xs text-muted-foreground">
              To open this file in a merge tool, set <code className="font-mono">merge.tool</code> in your Git config.
            </p>
          )}
          {(["ours", "theirs"] as const).some((side) => detail[side]._tag === "Text") && (
            <details className="rounded-md border">
              <summary className="cursor-pointer px-3 py-1.5 font-medium">Compare each side with the base</summary>
              <div className="grid h-80 grid-cols-2 divide-x border-t">
                <Column title={names.ours}>
                  <SideBody path={detail.path} base={detail.base} side={detail.ours} />
                </Column>
                <Column title={names.theirs}>
                  <SideBody path={detail.path} base={detail.base} side={detail.theirs} />
                </Column>
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

const unavailable = (file: ConflictFile, whose: string): ReactNode => {
  switch (file._tag) {
    case "Binary":
      return <Nothing title={`${whose} is a binary file`} description={size(file.bytes)} />
    case "TooLarge":
      return <Nothing title={`${whose} is too large to show`} description={size(file.bytes)} />
    case "Submodule":
      return <Nothing title={describeFile(file)} />
    default:
      return null
  }
}

function SideBody({ path, base, side }: { path: RepoPath; base: ConflictFile; side: ConflictFile }) {
  if (side._tag === "Missing") {
    return <Nothing title={base._tag === "Missing" ? "No file on this side" : "This side deleted the file"} />
  }
  if (side._tag !== "Text") return unavailable(side, "This version")
  if (base._tag === "Text" && base.content === side.content) {
    return <Nothing title="This side didn't change the file" description="Its version matches the base." />
  }
  if (base._tag === "Binary" || base._tag === "TooLarge") return <FileCode path={path} contents={side.content} />
  return <SideDiff path={path} base={base._tag === "Text" ? base.content : null} side={side.content} />
}

function SideDiff({ path, base, side }: { path: RepoPath; base: string | null; side: string }) {
  const items = useMemo<ReadonlyArray<CodeViewItem<undefined>>>(
    () => [
      {
        id: path,
        type: "diff",
        fileDiff: parseDiffFromFile(base === null ? null : { name: path, contents: base }, {
          name: path,
          contents: side,
        }),
        version: hash(`${base}\0${side}`),
      },
    ],
    [path, base, side],
  )
  return <Code items={items} />
}

export function FileCode({ path, contents }: { path: RepoPath; contents: string }) {
  const items = useMemo<ReadonlyArray<CodeViewItem<undefined>>>(
    () => [
      { id: path, type: "file", file: { name: path, contents: cleanLastNewline(contents) }, version: hash(contents) },
    ],
    [path, contents],
  )
  return <Code items={items} />
}

function Code({ items }: { items: ReadonlyArray<CodeViewItem<undefined>> }) {
  const { options: look, style, lineHeight } = useDiffAppearance()
  const options = useMemo(
    () => ({
      ...look,
      diffStyle: "unified" as const,
      unsafeCSS: UNSAFE_CSS,
      disableFileHeader: true,
      itemMetrics: {
        lineHeight,
        hunkSeparatorHeight: SEPARATOR_HEIGHT,
        spacing: 0,
        paddingTop: 0,
        paddingBottom: 8,
      },
      layout: { paddingTop: 0, paddingBottom: 8, gap: 0 },
      hunkSeparators: "line-info" as const,
    }),
    [look, lineHeight],
  )
  return (
    <CodeView
      items={items}
      options={options}
      style={style}
      className="h-full overflow-auto overscroll-contain select-text"
    />
  )
}
