import { RegistryContext, useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { ConflictCode, Operation, RepoId, RepoPath, Status } from "@gitui/contracts"
import { cn } from "cn"
import { ArrowLeftIcon, CircleAlertIcon, CircleCheckIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react"
import { type KeyboardEvent, useContext, useEffect, useMemo, useRef } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { copyWithToast } from "@/lib/clipboard"
import { joinSegments } from "@/lib/conflict-blocks"
import {
  afterOperationStep,
  type ConflictSession,
  dirtyPaths,
  emptySession,
  nextUnresolved,
  operationPendingAtom,
  railOpenAtom,
  sessionsAtom,
  type Resolved,
  useConflictSession,
  withFiles,
} from "@/lib/conflict-session"
import { describeConflict, operationNames, type Sides, sideNames } from "@/lib/conflicts"
import { basename, dirname } from "@/lib/format"
import { latest, loadError, mergeToolsAtom, statusAtom, useGitAction } from "@/lib/git"
import { ConflictFilePane, FileCode } from "./conflict-view"
import { useConfirm } from "./confirm"
import { Loading, Nothing } from "./loading"

const canSkip = (operation: Operation | null) =>
  operation === "rebase" || operation === "cherry-pick" || operation === "revert"

const unsavedNote = (paths: ReadonlyArray<RepoPath>) =>
  paths.length === 0 ? null : (
    <p>
      {paths.length === 1
        ? `Your unsaved edits to ${basename(paths[0]!)} will be lost.`
        : `Your unsaved edits to ${paths.length} files will be lost.`}
    </p>
  )

export function useOperationActions(repo: RepoId, operation: Operation | null) {
  const git = useGitAction()
  const confirm = useConfirm()
  const [session, update] = useConflictSession(repo)
  const registry = useContext(RegistryContext)
  const pending = operationPendingAtom(repo)
  const busy = useAtomValue(pending)
  const unsaved = dirtyPaths(session)
  const name = operation === null ? "" : operationNames[operation].toLowerCase()

  const perform = async (
    method: "ContinueOperation" | "SkipOperation" | "AbortOperation",
    label: string,
    onDone: (current: ConflictSession) => ConflictSession,
  ) => {
    if (registry.get(pending)) return
    registry.set(pending, true)
    try {
      if (await git(label, repo, (c) => c(method, { repo }))) update(onDone)
    } finally {
      registry.set(pending, false)
    }
  }
  const continueOperation = () => {
    if (unsaved.length > 0) return
    void perform("ContinueOperation", `Continue ${name}`, afterOperationStep)
  }
  const skip = () => {
    const run = () =>
      perform("SkipOperation", "Skip", (current) => ({ ...afterOperationStep(current), drafts: new Map() }))
    if (unsaved.length === 0) return void run()
    confirm({
      title: "Skip this commit?",
      body: unsavedNote(unsaved),
      confirmLabel: "Skip",
      destructive: true,
      onConfirm: () => void run(),
    })
  }
  const abort = () =>
    confirm({
      title: `Abort ${name}?`,
      body: (
        <>
          <p>The branch goes back to where it was before the {name} started.</p>
          {unsavedNote(unsaved)}
        </>
      ),
      confirmLabel: "Abort",
      destructive: true,
      onConfirm: () => void perform("AbortOperation", `Abort ${name}`, () => emptySession),
    })
  return { continueOperation, skip, abort, busy, unsaved, session, update }
}

export const openConflicts = (path: RepoPath | null) => (session: ConflictSession) => ({
  ...session,
  open: true,
  path: path ?? session.path,
})

export function OperationBanner({ repo, status, conflicts }: { repo: RepoId; status: Status; conflicts: number }) {
  const { operation } = status
  const { continueOperation, skip, abort, busy, unsaved, update } = useOperationActions(repo, operation)
  const name = operation === null ? null : operationNames[operation]
  const description =
    conflicts > 0
      ? `${conflicts} ${conflicts === 1 ? "file has" : "files have"} conflicts.`
      : unsaved.length > 0
        ? "Review your unsaved resolver drafts."
        : "No conflicts left. Continue to finish."
  return (
    <Alert className="m-2 w-auto text-xs">
      <AlertTitle>{name === null ? "Conflicts" : `${name} in progress`}</AlertTitle>
      <AlertDescription className="text-xs">
        {description}
        {unsaved.length > 0 &&
          ` ${unsaved.length} ${unsaved.length === 1 ? "file has" : "files have"} unsaved edits in the resolver.`}
      </AlertDescription>
      <div className="col-span-full mt-1 flex gap-1">
        {(conflicts > 0 || unsaved.length > 0) && (
          <Button size="sm" onClick={() => update(openConflicts(null))}>
            {conflicts > 0 ? "Resolve conflicts" : "Review drafts"}
          </Button>
        )}
        {operation !== null && operation !== "bisect" && (
          <Button
            size="sm"
            variant={conflicts > 0 ? "outline" : "default"}
            disabled={busy || conflicts > 0 || unsaved.length > 0}
            onClick={continueOperation}
          >
            Continue
          </Button>
        )}
        {canSkip(operation) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={skip}>
            Skip this commit
          </Button>
        )}
        {operation !== null && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={abort}>
            Abort
          </Button>
        )}
      </div>
    </Alert>
  )
}

export function ConflictWorkspace({ repo }: { repo: RepoId }) {
  const statusResult = useAtomValue(statusAtom(repo))
  const refreshStatus = useAtomRefresh(statusAtom(repo))
  const status = latest(statusResult)
  if (status === undefined) {
    const error = loadError(statusResult)
    return error === undefined ? (
      <Loading label="Loading conflicts" />
    ) : (
      <Nothing title="Couldn't read the working copy" description={error} onRetry={refreshStatus} />
    )
  }
  return <Resolver repo={repo} status={status} />
}

const resolvedText = (resolved: Resolved | undefined, names: Sides) => {
  switch (resolved?.how) {
    case undefined:
      return "Resolved"
    case "edited":
      return "Saved and staged"
    case "ours":
      return `Used ${names.ours.toLowerCase()}`
    case "theirs":
      return `Used ${names.theirs.toLowerCase()}`
    case "deleted":
      return "Deleted"
    case "as-is":
      return "Staged as it was on disk"
  }
}

function Resolver({ repo, status }: { repo: RepoId; status: Status }) {
  const { operation } = status
  const names = sideNames(operation)
  const actions = useOperationActions(repo, operation)
  const { session, update } = actions
  const confirm = useConfirm()
  const busy = useAtomValue(mergeToolsAtom(repo))
  const [railOpen, setRailOpen] = useAtom(railOpenAtom)
  const conflicts = useMemo(
    () => new Map(status.entries.flatMap((entry) => (entry._tag === "Conflicted" ? [[entry.path, entry.code]] : []))),
    [status],
  ) as ReadonlyMap<RepoPath, ConflictCode>
  const conflictPaths = [...conflicts.keys()]
  const conflictSet = new Set(conflictPaths)
  const trackedPaths = [...conflictPaths, ...actions.unsaved]
  const files = withFiles(session.files, trackedPaths)
  const unresolved = (path: RepoPath) => conflictSet.has(path)
  const left = files.filter(unresolved)
  const dirty = new Set(actions.unsaved)
  const nothingLeft = operation === null && conflictPaths.length === 0 && files.length === 0

  useEffect(() => {
    if (files !== session.files)
      update((current) => ({ ...current, files: withFiles(current.files, [...conflictPaths, ...dirtyPaths(current)]) }))
  })
  useEffect(() => {
    if (nothingLeft) update((current) => ({ ...current, open: false, path: null }))
  }, [nothingLeft, update])

  const selected =
    session.path !== null && files.includes(session.path) ? session.path : (left[0] ?? actions.unsaved[0] ?? null)
  const select = (path: RepoPath | null) => update((current) => ({ ...current, path }))
  const back = () =>
    update((current) =>
      left.length === 0 && operation === null && dirtyPaths(current).length === 0
        ? emptySession
        : { ...current, open: false },
    )
  const discardDraft = (path: RepoPath) =>
    confirm({
      title: `Discard unsaved edits to ${basename(path)}?`,
      body: <p>The file on disk and its staged result will stay as they are.</p>,
      confirmLabel: "Discard draft",
      destructive: true,
      onConfirm: () =>
        update((current) => {
          const drafts = new Map(current.drafts)
          drafts.delete(path)
          return { ...current, drafts }
        }),
    })
  const onResolved = (path: RepoPath, resolved: Resolved, advance: boolean) =>
    update((current) => ({
      ...current,
      resolved: new Map(current.resolved).set(path, resolved),
      path: advance ? nextUnresolved(files, (p) => p !== path && unresolved(p), path) : path,
    }))

  const mainRef = useRef<HTMLElement>(null)
  const focusMain = () =>
    mainRef.current?.querySelector<HTMLElement>("textarea, button:not(:disabled), [tabindex='0']")?.focus()

  const code = selected === null ? undefined : conflicts.get(selected)
  const resolvedCount = files.length - left.length

  return (
    <div className="conflict-workspace flex h-full min-h-0 flex-col text-xs">
      <OperationBar
        operation={operation}
        resolved={resolvedCount}
        total={files.length}
        ready={left.length === 0 && dirty.size === 0}
        onBack={back}
        actions={actions}
      />
      <div className="flex min-h-0 flex-1">
        <Rail
          open={railOpen}
          onToggle={() => setRailOpen(!railOpen)}
          files={files}
          selected={selected}
          resolvedCount={resolvedCount}
          onSelect={select}
          onEnter={focusMain}
          row={(path) => ({
            unresolved: unresolved(path),
            description: unresolved(path)
              ? describeConflict(conflicts.get(path)!, names)
              : resolvedText(session.resolved.get(path), names),
            dirty: dirty.has(path),
            saved: session.saved.has(path),
            tool: busy.has(path),
          })}
        />
        <main
          ref={mainRef}
          aria-label="Conflict"
          aria-busy={actions.busy}
          inert={actions.busy}
          className="flex min-w-0 flex-1 flex-col"
        >
          {selected !== null && code !== undefined && unresolved(selected) ? (
            <ConflictFilePane
              key={selected}
              repo={repo}
              path={selected}
              code={code}
              operation={operation}
              draft={session.drafts.get(selected)}
              update={update}
              onResolved={onResolved}
            />
          ) : selected !== null && (left.length > 0 || dirty.has(selected)) ? (
            <ResolvedFile
              path={selected}
              text={resolvedText(session.resolved.get(selected), names)}
              content={session.resolved.get(selected)?.content ?? null}
              left={left.length}
              onNext={() => select(left[0] ?? null)}
              draft={dirty.has(selected) ? joinSegments(session.drafts.get(selected)!.segments) : undefined}
              onDiscard={() => discardDraft(selected)}
            />
          ) : (
            <Ready
              operation={operation}
              unsaved={actions.unsaved.length}
              onReview={() => select(actions.unsaved[0] ?? null)}
              onContinue={actions.continueOperation}
              onBack={back}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function OperationBar({
  operation,
  resolved,
  total,
  ready,
  onBack,
  actions,
}: {
  operation: Operation | null
  resolved: number
  total: number
  ready: boolean
  onBack: () => void
  actions: ReturnType<typeof useOperationActions>
}) {
  const name = operation === null ? null : operationNames[operation]
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1">
      <Button size="sm" variant="ghost" onClick={onBack}>
        <ArrowLeftIcon data-icon="inline-start" />
        Back to changes
      </Button>
      <span className="font-medium">{name === null ? "Resolving conflicts" : `${name} in progress`}</span>
      <span className={cn("tabular-nums", ready ? "text-foreground" : "text-muted-foreground")} aria-live="polite">
        {resolved} of {total} resolved
      </span>
      <span className="ml-auto flex items-center gap-1">
        {canSkip(operation) && (
          <Button size="sm" variant="ghost" disabled={actions.busy} onClick={actions.skip}>
            Skip this commit
          </Button>
        )}
        {operation !== null && (
          <Button size="sm" variant="destructive" disabled={actions.busy} onClick={actions.abort}>
            Abort {name?.toLowerCase()}
          </Button>
        )}
        {operation !== null && operation !== "bisect" && (
          <Button
            size="sm"
            variant={ready ? "default" : "outline"}
            disabled={actions.busy || !ready}
            title={ready ? undefined : "Resolve and stage every file, and review any unsaved drafts first"}
            onClick={actions.continueOperation}
          >
            Continue {name?.toLowerCase()}
          </Button>
        )}
      </span>
    </div>
  )
}

interface RowState {
  readonly unresolved: boolean
  readonly description: string
  readonly dirty: boolean
  readonly saved: boolean
  readonly tool: boolean
}

const optionId = (path: RepoPath) => `conflict-file-${encodeURIComponent(path)}`

function Rail({
  open,
  onToggle,
  files,
  selected,
  resolvedCount,
  onSelect,
  onEnter,
  row,
}: {
  open: boolean
  onToggle: () => void
  files: ReadonlyArray<RepoPath>
  selected: RepoPath | null
  resolvedCount: number
  onSelect: (path: RepoPath) => void
  onEnter: () => void
  row: (path: RepoPath) => RowState
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected !== null) document.getElementById(optionId(selected))?.scrollIntoView({ block: "nearest" })
  }, [selected])

  if (!open) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center gap-2 border-r py-1">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Show conflicted files"
          aria-expanded={false}
          title="Show conflicted files"
          onClick={onToggle}
        >
          <PanelLeftOpenIcon />
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums [writing-mode:vertical-rl]">
          {resolvedCount} of {files.length} resolved
        </span>
      </div>
    )
  }

  const index = selected === null ? -1 : files.indexOf(selected)
  const onKeyDown = (event: KeyboardEvent) => {
    const target =
      event.key === "ArrowDown"
        ? files[Math.min(index + 1, files.length - 1)]
        : event.key === "ArrowUp"
          ? files[Math.max(index - 1, 0)]
          : event.key === "Home"
            ? files[0]
            : event.key === "End"
              ? files.at(-1)
              : undefined
    if (target !== undefined) {
      event.preventDefault()
      onSelect(target)
    } else if (event.key === "Enter") {
      event.preventDefault()
      onEnter()
    }
  }

  return (
    <nav aria-label="Conflicted files" className="flex w-60 shrink-0 flex-col border-r max-md:w-48">
      <div className="flex h-8 shrink-0 items-center gap-2 pr-1 pl-2 text-muted-foreground">
        <span className="text-xs font-semibold tracking-wide uppercase">Conflicted files</span>
        <span className="text-xs tabular-nums">
          {resolvedCount}/{files.length}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          aria-label="Hide conflicted files"
          aria-expanded
          title="Hide conflicted files"
          onClick={onToggle}
        >
          <PanelLeftCloseIcon />
        </Button>
      </div>
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label="Conflicted files"
        aria-activedescendant={selected === null ? undefined : optionId(selected)}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {files.map((path) => {
          const state = row(path)
          return (
            <div
              key={path}
              id={optionId(path)}
              role="option"
              aria-selected={path === selected}
              onClick={() => {
                onSelect(path)
                listRef.current?.focus({ preventScroll: true })
              }}
              className={cn(
                "flex cursor-default gap-2 px-2 py-1",
                path === selected ? "bg-selection" : "hover:bg-muted/60",
              )}
            >
              {state.unresolved ? (
                <CircleAlertIcon aria-label="Unresolved" className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              ) : (
                <CircleCheckIcon aria-label="Resolved" className="mt-0.5 size-3.5 shrink-0 text-[var(--lane-1)]" />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate" title={path}>
                  <span className="text-muted-foreground">{dirname(path)}</span>
                  {basename(path)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {state.description}
                  {state.saved && state.unresolved && " · saved, not staged"}
                </span>
              </span>
              {state.tool ? (
                <Spinner aria-label="Open in merge tool" className="mt-0.5 size-3.5 shrink-0" />
              ) : (
                state.dirty && (
                  <span
                    role="img"
                    aria-label="Unsaved edits"
                    title="Unsaved edits"
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500"
                  />
                )
              )}
            </div>
          )
        })}
      </div>
      <p className="shrink-0 border-t px-2 py-1 text-xs text-muted-foreground">↑↓ to switch files · ↩ to edit</p>
    </nav>
  )
}

function ResolvedFile({
  path,
  text,
  content,
  left,
  onNext,
  draft,
  onDiscard,
}: {
  path: RepoPath
  text: string
  content: string | null
  left: number
  onNext: () => void
  draft: string | undefined
  onDiscard: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1">
        <h2 className="min-w-0 truncate font-medium">
          <span className="text-muted-foreground">{dirname(path)}</span>
          {basename(path)}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">{draft === undefined ? text : "Unsaved draft"}</span>
        {left > 0 && (
          <Button size="sm" className="ml-auto" onClick={onNext}>
            Next unresolved file ({left} left)
          </Button>
        )}
      </div>
      {draft !== undefined ? (
        <>
          <Alert className="m-2 w-auto text-xs">
            <AlertTitle>This file is no longer conflicted</AlertTitle>
            <AlertDescription className="text-xs">
              Your unsaved draft is shown below. Copy any edits you want to keep, then discard the draft to continue.
            </AlertDescription>
            <div className="col-span-full mt-1 flex gap-1">
              <Button size="sm" onClick={() => void copyWithToast(draft, "Draft copied")}>
                Copy draft
              </Button>
              <Button size="sm" variant="outline" onClick={onDiscard}>
                Discard draft
              </Button>
            </div>
          </Alert>
          <div className="min-h-0 flex-1">
            <FileCode path={path} contents={draft} />
          </div>
        </>
      ) : content === null ? (
        <Nothing
          title="This file is resolved"
          description="Its result is staged. Back to changes shows the staged diff."
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="shrink-0 px-2 pt-1.5 pb-1 text-xs text-muted-foreground">
            The staged result, read-only. Back to changes shows the diff.
          </p>
          <div className="min-h-0 flex-1">
            <FileCode path={path} contents={content} />
          </div>
        </div>
      )}
    </div>
  )
}

function Ready({
  operation,
  unsaved,
  onReview,
  onContinue,
  onBack,
}: {
  operation: Operation | null
  unsaved: number
  onReview: () => void
  onContinue: () => void
  onBack: () => void
}) {
  const name = operation === null ? null : operationNames[operation].toLowerCase()
  const next =
    operation === "rebase"
      ? "Continue rebase commits this step and applies the next commit. If that commit conflicts too, its files open here."
      : operation === "merge"
        ? "Continue merge creates the merge commit."
        : operation === "cherry-pick" || operation === "revert"
          ? `Continue ${name} creates the commit.`
          : operation === "bisect"
            ? "Mark the commit as good or bad from the command line to go on bisecting."
            : "The resolved files are staged. Review them and commit when you're ready."
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-md flex-col gap-3 rounded-md border p-4">
        <div>
          <h2 className="font-medium">
            {unsaved > 0 ? "Review your unsaved drafts" : "All conflicts are resolved and staged"}
          </h2>
          <p className="text-muted-foreground">
            {unsaved > 0
              ? `${unsaved} ${unsaved === 1 ? "file has" : "files have"} edits that haven't been saved. Review them before continuing.`
              : next}
          </p>
        </div>
        <div className="flex gap-2">
          {unsaved > 0 ? (
            <Button size="sm" onClick={onReview}>
              Review drafts
            </Button>
          ) : operation !== null && operation !== "bisect" ? (
            <>
              <Button size="sm" onClick={onContinue}>
                Continue {name}
              </Button>
              <Button size="sm" variant="outline" onClick={onBack}>
                Review staged changes
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={onBack}>
              Back to changes
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export const useUnsavedConflictGuard = () => {
  const sessions = useAtomValue(sessionsAtom)
  const dirty = [...sessions.values()].some((session) => dirtyPaths(session).length > 0)
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [dirty])
}
