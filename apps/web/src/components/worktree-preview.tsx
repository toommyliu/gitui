import { useAtomMount, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import {
  type BaseRef,
  type BranchCommit,
  type Change,
  type MergeCheck,
  type Oid,
  type RepoId,
  type RepoPath,
  type StatusEntry,
  type WorktreeDetail,
} from "@gitui/contracts"
import type { CodeViewHandle } from "@pierre/diffs/react"
import { ArrowUpRightIcon, CheckIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"
import { isTestFile } from "@/lib/file-kind"
import { basename, dirname, shortDate, shortOid } from "@/lib/format"
import { describeFailure, latest, refsAtom, watchAtom } from "@/lib/git"
import { settingsAtom } from "@/lib/settings"
import type { Selection } from "@/lib/selection"
import {
  mergeCheckAtom,
  mergeCheckKey,
  worktreeAtom,
  worktreeDiffAtom,
  worktreeLabel,
  worktreeSummariesAtom,
} from "@/lib/worktrees"
import { ChangeLetter } from "./change-letter"
import { OpenInButton } from "./open-in"
import { ChangeTotals, HistoryButton, SectionBar, TestsToggle } from "./commit-detail"
import { DiffStack, patchItems, useCollapse } from "./diff-view"
import { Loading, Nothing } from "./loading"

const MAX_ROWS = 500
const SECTION = "worktree"

interface FileRow {
  readonly path: RepoPath
  readonly change: Change
  readonly tracked: boolean
}

const fileRow = (entry: StatusEntry): FileRow => {
  switch (entry._tag) {
    case "Untracked":
      return { path: entry.path, change: "added", tracked: false }
    case "Conflicted":
      return { path: entry.path, change: "modified", tracked: true }
    case "Tracked":
      return {
        path: entry.path,
        change: entry.unstaged === "deleted" ? "deleted" : (entry.staged ?? entry.unstaged ?? "modified"),
        tracked: true,
      }
  }
}

const fingerprint = (detail: WorktreeDetail) =>
  [
    detail.head._tag === "Unborn" ? "" : detail.head.oid,
    detail.editedAt ?? "",
    ...detail.entries.map((entry) =>
      entry._tag === "Tracked" ? `${entry.path}:${entry.staged}:${entry.unstaged}` : `${entry._tag}:${entry.path}`,
    ),
  ].join("\n")

const plural = (count: number, word: string) => `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-right text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function OidButton({ oid, onSelect }: { oid: Oid; onSelect: (selection: Selection) => void }) {
  return (
    <Button
      variant="link"
      size="xs"
      className="h-auto p-0 font-mono text-xs"
      onClick={() => onSelect({ _tag: "Commit", oid })}
    >
      {shortOid(oid)}
    </Button>
  )
}

function CommitLine({
  commit,
  base,
  onSelect,
}: {
  commit: BranchCommit
  base: BaseRef
  onSelect: (selection: Selection) => void
}) {
  return (
    <li className="flex items-baseline gap-2 whitespace-nowrap">
      <OidButton oid={commit.oid} onSelect={onSelect} />
      <span className="min-w-0 truncate">{commit.subject}</span>
      <span className="ml-auto shrink-0 text-muted-foreground">
        {commit.landed === null ? (
          shortDate(commit.time)
        ) : (
          <>
            on {base.name} as <OidButton oid={commit.landed} onSelect={onSelect} />
          </>
        )}
      </span>
    </li>
  )
}

function MergeStatus({
  worktree,
  base,
  detail,
  onReveal,
}: {
  worktree: RepoId
  base: BaseRef
  detail: WorktreeDetail
  onReveal: (file: RepoPath) => void
}) {
  const atom = mergeCheckAtom(mergeCheckKey(worktree, base.oid, fingerprint(detail)))
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const current = latest(result)
  const [kept, setKept] = useState<MergeCheck | undefined>(undefined)
  if (current !== undefined && current !== kept) setKept(current)
  const check = current ?? kept
  const busy = result.waiting
  const changed = new Set(detail.entries.map((entry) => entry.path))
  const again = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground"
            aria-label="Check again"
            aria-busy={busy}
            onClick={() => !busy && refresh()}
          />
        }
      >
        <RotateCwIcon className={cn(busy && "animate-spin")} />
      </TooltipTrigger>
      <TooltipContent>Check again</TooltipContent>
    </Tooltip>
  )
  if (result._tag === "Failure" && current === undefined && !busy) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        Couldn't check: {describeFailure(result.cause)}
        {again}
      </span>
    )
  }
  if (check === undefined) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Spinner className="size-3" />
        Checking against {base.name}…
      </span>
    )
  }
  if (check._tag === "Clean") {
    return (
      <span className="flex items-center gap-1.5">
        <CheckIcon className="size-3.5 text-change-added" />
        Applies cleanly onto {base.name}
        {again}
      </span>
    )
  }
  return (
    <>
      <span className="flex items-center gap-1.5 text-change-modified">
        <TriangleAlertIcon className="size-3.5" />
        Conflicts with {base.name} in {plural(check.paths.length, "file")}
        {again}
      </span>
      <p className="flex flex-wrap gap-x-2 text-muted-foreground">
        {check.paths.map((file) =>
          changed.has(file) ? (
            <button key={file} type="button" title={file} className="hover:underline" onClick={() => onReveal(file)}>
              {basename(file)}
            </button>
          ) : (
            <span key={file} title={file}>
              {basename(file)}
            </span>
          ),
        )}
      </p>
    </>
  )
}

function Facts({
  worktree,
  detail,
  onSelect,
  onReveal,
}: {
  worktree: RepoId
  detail: WorktreeDetail
  onSelect: (selection: Selection) => void
  onReveal: (file: RepoPath) => void
}) {
  const { base, commits } = detail
  if (base === null) {
    return (
      <Field label="Commits">
        <span className="text-muted-foreground">No main or master branch to compare with</span>
      </Field>
    )
  }
  if (detail.head._tag === "Unborn") {
    return (
      <Field label="Commits">
        <span className="text-muted-foreground">No commits yet</span>
      </Field>
    )
  }
  const own = detail.unique
  const landed = commits.filter((commit) => commit.landed !== null).length
  return (
    <>
      <Field label="Commits">
        <div>
          {own === 0 ? "None of its own" : `${plural(own, "commit")} not on ${base.name}`}
          {landed > 0 && (
            <span className="text-muted-foreground">
              , {landed} already on {base.name}
            </span>
          )}
        </div>
        {commits.length > 0 && (
          <ul className="mt-0.5">
            {commits.map((commit) => (
              <CommitLine key={commit.oid} commit={commit} base={base} onSelect={onSelect} />
            ))}
          </ul>
        )}
        {detail.truncated && <p className="text-muted-foreground">Showing the newest {commits.length}.</p>}
      </Field>
      <Field label="Base">
        {detail.mergeBase === null ? (
          <span className="text-muted-foreground">No history in common with {base.name}</span>
        ) : (
          <>
            <OidButton oid={detail.mergeBase} onSelect={onSelect} />,{" "}
            {detail.behind === 0
              ? `up to date with ${base.name}`
              : `${plural(detail.behind, "commit")} behind ${base.name}`}
          </>
        )}
      </Field>
      <Field label="Rebase">
        {own === 0 && detail.entries.length === 0 ? (
          <span className="text-muted-foreground">Everything here is already on {base.name}</span>
        ) : (
          <MergeStatus worktree={worktree} base={base} detail={detail} onReveal={onReveal} />
        )}
      </Field>
    </>
  )
}

interface PreviewProps {
  readonly repo: RepoId
  readonly path: string
  readonly onSelect: (selection: Selection) => void
  readonly onOpen: (path: string, family: ReadonlyArray<string>) => void
  readonly onHistory: (path: string) => void
}

export function WorktreePreview(props: PreviewProps) {
  const refs = latest(useAtomValue(refsAtom(props.repo)))
  const gone = refs !== undefined && !refs.worktrees.some((worktree) => worktree.path === props.path)
  const { onSelect } = props
  useEffect(() => {
    if (gone) onSelect({ _tag: "WorkingCopy" })
  }, [gone, onSelect])
  return gone ? null : <Preview {...props} />
}

function Preview({ repo, path, onSelect, onOpen, onHistory }: PreviewProps) {
  const worktree = path as RepoId
  useAtomMount(watchAtom(worktree))
  const result = useAtomValue(worktreeAtom(worktree))
  const detail = latest(result)
  const diffResult = useAtomValue(worktreeDiffAtom(worktree))
  const diff = latest(diffResult)
  const refs = latest(useAtomValue(refsAtom(repo)))
  const summaries = latest(useAtomValue(worktreeSummariesAtom(repo)))
  const { hideTests } = useAtomValue(settingsAtom)
  const items = useMemo(() => (diff?._tag === "Patch" ? patchItems(SECTION, diff.patch) : []), [diff])
  const shownItems = useMemo(
    () => (hideTests ? items.filter((item) => !isTestFile(item.fileDiff.name)) : items),
    [items, hideTests],
  )
  const collapse = useCollapse()
  const viewRef = useRef<CodeViewHandle<undefined, undefined>>(null)

  const counts = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.fileDiff.name,
          item.fileDiff.hunks.reduce(
            (sum, hunk) => ({
              additions: sum.additions + hunk.additionLines,
              deletions: sum.deletions + hunk.deletionLines,
            }),
            { additions: 0, deletions: 0 },
          ),
        ]),
      ),
    [items],
  )
  const overlaps = useMemo(() => {
    const names = new Map((refs?.worktrees ?? []).map((w) => [w.path, worktreeLabel(w)]))
    const byPath = new Map<string, Array<string>>()
    for (const summary of summaries ?? []) {
      if (summary.path === path) continue
      const name = names.get(summary.path) ?? basename(summary.path)
      for (const file of summary.paths) byPath.set(file, [...(byPath.get(file) ?? []), name])
    }
    return byPath
  }, [refs, summaries, path])
  const rows = useMemo(() => (detail?.entries ?? []).map(fileRow), [detail])
  const shownRows = useMemo(() => (hideTests ? rows.filter((row) => !isTestFile(row.path)) : rows), [rows, hideTests])
  const tracked = useMemo(() => new Set(rows.filter((row) => row.tracked).map((row) => row.path)), [rows])

  if (detail === undefined) {
    return result._tag === "Failure" ? (
      <Nothing title="Couldn't read this worktree" description={describeFailure(result.cause)} />
    ) : (
      <Loading label="Reading worktree" />
    )
  }

  const title = detail.head._tag === "Detached" ? `${basename(path)} at ${shortOid(detail.head.oid)}` : detail.head.name
  const reveal = (file: RepoPath) => {
    const id = `${SECTION}\n${file}`
    collapse.set([id], false)
    viewRef.current?.scrollTo({ type: "item", id, align: "start" })
  }
  const open = () => onOpen(path, refs?.worktrees.map((w) => w.path) ?? [])

  const fileList = (
    <ScrollArea className="h-full" viewportProps={{ className: "data-has-overflow-y:pr-2.5" }}>
      <ul className="py-1">
        {shownRows.slice(0, MAX_ROWS).map((row) => {
          const count = counts.get(row.path)
          const others = overlaps.get(row.path) ?? []
          return (
            <li key={row.path} className="flex items-center pr-2">
              <button
                type="button"
                onClick={() => reveal(row.path)}
                className="flex h-6 min-w-0 flex-1 items-center gap-2 px-3 text-left whitespace-nowrap hover:bg-muted/60"
              >
                <ChangeLetter change={row.change} />
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{dirname(row.path)}</span>
                  {basename(row.path)}
                </span>
                {others.length > 0 && (
                  <Badge
                    variant="outline"
                    title={`Also changed in ${others.join(", ")}`}
                    className="h-4 max-w-40 min-w-0 shrink rounded-sm border-change-modified/60 px-1 text-[10px] text-change-modified"
                  >
                    <span className="truncate">
                      also {others[0]}
                      {others.length > 1 && ` +${others.length - 1}`}
                    </span>
                  </Badge>
                )}
                <span className="ml-auto shrink-0 tabular-nums">
                  {count !== undefined && count.deletions > 0 && (
                    <span className="text-change-deleted">-{count.deletions} </span>
                  )}
                  {count !== undefined && count.additions > 0 && (
                    <span className="text-change-added">+{count.additions}</span>
                  )}
                </span>
              </button>
              <OpenInButton repo={worktree} file={{ path: row.path }} compact disabled={row.change === "deleted"} />
            </li>
          )
        })}
        {shownRows.length > MAX_ROWS && (
          <li className="px-3 py-1 text-muted-foreground">and {plural(shownRows.length - MAX_ROWS, "more file")}</li>
        )}
      </ul>
    </ScrollArea>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="max-h-[40%] shrink-0 overflow-auto p-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
          <Button size="sm" variant="outline" className="ml-auto" onClick={open}>
            Open in new tab
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
          <OpenInButton repo={worktree} compact />
        </div>
        <p className="truncate text-muted-foreground">
          <span className="font-mono text-xs select-text">{path}</span>
          {detail.editedAt !== null && <> · edited {shortDate(detail.editedAt)}</>}
        </p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <Facts worktree={worktree} detail={detail} onSelect={onSelect} onReveal={reveal} />
        </dl>
      </div>
      <SectionBar label="Uncommitted" actions={<TestsToggle paths={rows.map((row) => row.path)} />}>
        {rows.length > 0 && (
          <ChangeTotals count={rows.length} files={[...counts].map(([path, count]) => ({ path, ...count }))} />
        )}
      </SectionBar>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-muted-foreground">No uncommitted changes</p>
      ) : (
        <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="35%" minSize="10%">
            {fileList}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize="20%">
            {diff === undefined ? (
              diffResult._tag === "Failure" ? (
                <Nothing title="Couldn't load the diff" description={describeFailure(diffResult.cause)} />
              ) : (
                <Loading label="Loading diff" />
              )
            ) : diff._tag === "TooLarge" ? (
              <Nothing
                title="Too large to diff"
                description="These changes are over 4 MB, so they aren't shown together."
              />
            ) : items.length === 0 ? (
              <Nothing title="Nothing to diff" />
            ) : shownItems.length === 0 ? (
              <Nothing title="Only tests changed" description="Show tests to see their diffs." />
            ) : (
              <DiffStack
                repo={worktree}
                items={shownItems}
                collapse={collapse}
                viewRef={viewRef}
                actions={(meta) =>
                  tracked.has(meta.path) ? <HistoryButton onClick={() => onHistory(meta.path)} /> : null
                }
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
