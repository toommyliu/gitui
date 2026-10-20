import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { CommitDetail as Detail, FileChange, Oid, RepoId } from "@gitui/contracts"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronsDownUpIcon, ChevronsUpDownIcon, HistoryIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { usePanelRef } from "react-resizable-panels"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { FILE_KINDS, type FileKind, type LineCounts, changeBreakdown } from "@/lib/file-kind"
import { longDate, shortOid } from "@/lib/format"
import { commitAtom, diffAtom, diffKey, latest, loadError } from "@/lib/git"
import { useNarrow } from "@/lib/narrow"
import type { Selection } from "@/lib/selection"
import { settingsAtom } from "@/lib/settings"
import { DiffStack, expandableIds, patchItems, useCollapse } from "./diff-view"
import { ChangeLetter } from "./change-letter"
import { Loading, Nothing } from "./loading"

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-right text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  )
}

type CountedFile = { path: string; additions: number | null; deletions: number | null }

const KIND_LABELS: Record<FileKind, string> = { code: "Code", tests: "Tests", mocks: "Mocks", generated: "Generated" }

export function ChangeTotals({ count, files }: { count: number; files: ReadonlyArray<CountedFile> }) {
  const [settings, setSettings] = useAtom(settingsAtom)
  const codeOnly = settings.lineCounts === "code"
  const breakdown = changeBreakdown(files)
  const total = {
    additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
  }
  const shown = codeOnly ? breakdown.code : total
  return (
    <>
      <Badge variant="secondary" className="h-4 rounded-sm px-1 text-[10px] tabular-nums">
        {count.toLocaleString()}
      </Badge>
      <Tooltip disabled={total.additions === 0 && total.deletions === 0}>
        <TooltipTrigger
          closeOnClick={false}
          render={<Button variant="ghost" size="xs" className="-mx-1 px-1 text-xs font-normal tabular-nums" />}
          onClick={() => setSettings({ ...settings, lineCounts: codeOnly ? "all" : "code" })}
        >
          {codeOnly && <span>Code</span>}
          <span className="text-change-added">+{shown.additions}</span>
          <span className="text-change-deleted">−{shown.deletions}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="flex-col items-stretch gap-1.5">
          <div className="grid grid-cols-[auto_auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
            {FILE_KINDS.filter(
              (kind) => kind === "code" || breakdown[kind].additions + breakdown[kind].deletions > 0,
            ).map((kind) => (
              <BreakdownRow
                key={kind}
                label={KIND_LABELS[kind]}
                counts={breakdown[kind]}
                shown={codeOnly && kind === "code"}
              />
            ))}
            <div className="col-span-3 my-0.5 border-t border-background/20" />
            <BreakdownRow label="Total" counts={total} shown={!codeOnly} />
          </div>
          <span className="opacity-60">{codeOnly ? "Click to show all files" : "Click to show code only"}</span>
        </TooltipContent>
      </Tooltip>
    </>
  )
}

function BreakdownRow({ label, counts, shown }: { label: string; counts: LineCounts; shown: boolean }) {
  return (
    <div className={cn("contents", shown && "font-semibold")}>
      <span>{label}</span>
      <span className="text-right">+{counts.additions}</span>
      <span className="text-right">−{counts.deletions}</span>
    </div>
  )
}

function Summary({ detail, onSelect }: { detail: Detail; onSelect: (selection: Selection) => void }) {
  const sameCommitter = detail.committer.name === detail.author.name && detail.committer.email === detail.author.email
  return (
    <div className="border-b px-3 py-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 select-text">
        <Field label="Commit">
          <span className="font-mono select-all">{detail.oid}</span>
        </Field>
        <Field label={detail.parents.length > 1 ? "Parents" : "Parent"}>
          {detail.parents.length === 0 ? (
            <span className="text-muted-foreground">none</span>
          ) : (
            detail.parents.map((parent) => (
              <Button
                key={parent}
                variant="link"
                size="xs"
                className="mr-2 h-auto p-0 font-mono text-xs"
                onClick={() => onSelect({ _tag: "Commit", oid: parent })}
              >
                {shortOid(parent)}
              </Button>
            ))
          )}
        </Field>
        <Field label="Author">
          {detail.author.name} <span className="text-muted-foreground">&lt;{detail.author.email}&gt;</span>
        </Field>
        <Field label="Date">{longDate(detail.author.time)}</Field>
        {!sameCommitter && (
          <Field label="Committer">
            {detail.committer.name} <span className="text-muted-foreground">&lt;{detail.committer.email}&gt;</span>
          </Field>
        )}
      </dl>
      <pre className="mt-3 font-mono text-[12px] leading-5 whitespace-pre-wrap select-text">{detail.message}</pre>
    </div>
  )
}

export function CommitDetail({
  repo,
  oid,
  onSelect,
  onHistory,
}: {
  repo: RepoId
  oid: Oid
  onSelect: (selection: Selection) => void
  onHistory: (path: string) => void
}) {
  const commit = commitAtom(`${repo}\n${oid}`)
  const commitResult = useAtomValue(commit)
  const refreshCommit = useAtomRefresh(commit)
  const detail = latest(commitResult)
  const { ignoreWhitespace } = useAtomValue(settingsAtom)
  const patch = diffAtom(diffKey(repo, { _tag: "Commit", oid }, [], ignoreWhitespace))
  const diffResult = useAtomValue(patch)
  const refreshDiff = useAtomRefresh(patch)
  const diff = latest(diffResult)
  const diffError = loadError(diffResult)
  const items = useMemo(() => (diff?._tag === "Patch" ? patchItems(oid, diff.patch) : []), [diff, oid])
  const collapse = useCollapse()
  const expandable = useMemo(() => expandableIds(items), [items])
  const allCollapsed = expandable.every((id) => collapse.ids.has(id))

  if (detail === undefined || detail.oid !== oid) {
    const error = loadError(commitResult)
    return error === undefined ? (
      <Loading label="Loading commit" />
    ) : (
      <Nothing title="Couldn't load this commit" description={error} onRetry={refreshCommit} />
    )
  }
  if (diff?._tag === "TooLarge") {
    return (
      <LargeCommit
        key={oid}
        repo={repo}
        detail={detail}
        summary={<Summary detail={detail} onSelect={onSelect} />}
        onHistory={onHistory}
      />
    )
  }
  return (
    <div className="flex h-full flex-col">
      <SectionBar
        label="Files"
        actions={
          expandable.length > 1 && (
            <BarButton onClick={() => collapse.set(expandable, !allCollapsed)}>
              {allCollapsed ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
              {allCollapsed ? "Expand all" : "Collapse all"}
            </BarButton>
          )
        }
      >
        <ChangeTotals count={detail.files.length} files={detail.files} />
      </SectionBar>
      {diffError === undefined ? (
        <div className="min-h-0 flex-1">
          <DiffStack
            key={oid}
            repo={repo}
            items={items}
            collapse={collapse}
            header={() => <Summary detail={detail} onSelect={onSelect} />}
            actions={(meta) => <HistoryButton onClick={() => onHistory(meta.path)} />}
          />
        </div>
      ) : (
        <>
          <Summary detail={detail} onSelect={onSelect} />
          <div className="min-h-0 flex-1">
            <Nothing title="Couldn't load the diff" description={diffError} onRetry={refreshDiff} />
          </div>
        </>
      )}
    </div>
  )
}

const FILE_ROW = 24

export function HistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="text-muted-foreground"
      aria-label="File history"
      title="File history"
      onClick={onClick}
    >
      <HistoryIcon />
    </Button>
  )
}

export function SectionBar({ label, actions, children }: { label: string; actions: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/40 px-2">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-muted-foreground">{children}</span>
      <span className="flex shrink-0 gap-1">{actions}</span>
    </div>
  )
}

function BarButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick}>
      {children}
    </Button>
  )
}

function LargeCommit({
  repo,
  detail,
  summary,
  onHistory,
}: {
  repo: RepoId
  detail: Detail
  summary: ReactNode
  onHistory: (path: string) => void
}) {
  const [open, setOpen] = useState<FileChange | null>(null)
  const [detailsShown, setDetailsShown] = useState(true)
  const [filesShown, setFilesShown] = useState(true)
  const [diffShown, setDiffShown] = useState(true)
  const files = usePanelRef()
  const diff = usePanelRef()
  const narrow = useNarrow()
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: detail.files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FILE_ROW,
    overscan: 20,
  })
  return (
    <div className="flex h-full flex-col">
      <SectionBar
        label="Details"
        actions={<BarButton onClick={() => setDetailsShown(!detailsShown)}>{detailsShown ? "Hide" : "Show"}</BarButton>}
      >
        {!detailsShown && (
          <>
            <span className="font-mono">{shortOid(detail.oid)}</span>
            <span className="truncate text-foreground">{detail.message.split("\n", 1)[0]}</span>
          </>
        )}
      </SectionBar>
      {detailsShown && <div className="max-h-[40%] shrink-0 overflow-auto border-b [&>*]:border-b-0">{summary}</div>}
      <SectionBar
        label="Files"
        actions={
          filesShown ? (
            <>
              {diffShown ? (
                <BarButton onClick={() => diff.current?.collapse()}>Expand</BarButton>
              ) : (
                <BarButton onClick={() => diff.current?.expand()}>Split</BarButton>
              )}
              <BarButton
                onClick={() => {
                  diff.current?.expand()
                  files.current?.collapse()
                }}
              >
                Hide
              </BarButton>
            </>
          ) : (
            <BarButton onClick={() => files.current?.expand()}>Show</BarButton>
          )
        }
      >
        <ChangeTotals count={detail.files.length} files={detail.files} />
      </SectionBar>
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel
          defaultSize="45%"
          minSize="10%"
          collapsible
          panelRef={files}
          onResize={(size) => setFilesShown(size.asPercentage > 0)}
        >
          <ScrollArea
            className="h-full"
            viewportRef={scrollRef}
            viewportProps={{ className: "[contain:strict] data-has-overflow-y:pr-2.5" }}
          >
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const file = detail.files[item.index]!
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setOpen(file)
                      diff.current?.expand()
                      if (narrow) files.current?.collapse()
                    }}
                    className={cn(
                      "absolute top-0 left-0 flex w-full items-center gap-2 px-3 text-left hover:bg-muted/60",
                      open?.path === file.path && "bg-selection",
                    )}
                    style={{ height: FILE_ROW, transform: `translateY(${item.start}px)` }}
                  >
                    <ChangeLetter change={file.change} />
                    <span className="truncate">{file.path}</span>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          minSize="20%"
          collapsible
          panelRef={diff}
          onResize={(size) => setDiffShown(size.asPercentage > 0)}
        >
          {open === null ? (
            <Nothing title="Too large to show at once" description="Pick a file to see its diff." />
          ) : (
            <SingleFileDiff key={open.path} repo={repo} oid={detail.oid} file={open} onHistory={onHistory} />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function SingleFileDiff({
  repo,
  oid,
  file,
  onHistory,
}: {
  repo: RepoId
  oid: Oid
  file: FileChange
  onHistory: (path: string) => void
}) {
  const paths = file.from === null ? [file.path] : [file.from, file.path]
  const { ignoreWhitespace } = useAtomValue(settingsAtom)
  const atom = diffAtom(diffKey(repo, { _tag: "Commit", oid }, paths, ignoreWhitespace))
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const diff = latest(result)
  const items = useMemo(() => (diff?._tag === "Patch" ? patchItems("file", diff.patch) : []), [diff])
  if (diff === undefined) {
    const error = loadError(result)
    return error === undefined ? (
      <Loading label="Loading diff" />
    ) : (
      <Nothing title="Couldn't load the diff" description={error} onRetry={refresh} />
    )
  }
  if (diff._tag === "TooLarge")
    return <Nothing title="Too large to display" description="This file's diff is over 4 MB." />
  return (
    <DiffStack repo={repo} items={items} actions={(meta) => <HistoryButton onClick={() => onHistory(meta.path)} />} />
  )
}
