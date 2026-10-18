import { useAtomValue } from "@effect/atom-react"
import type { CommitDetail as Detail, FileChange, Oid, RepoId } from "@gitui/contracts"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronsDownUpIcon, ChevronsUpDownIcon, HistoryIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { usePanelRef } from "react-resizable-panels"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "cn"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { longDate, shortOid } from "@/lib/format"
import { commitAtom, diffAtom, diffKey, latest } from "@/lib/git"
import { useNarrow } from "@/lib/narrow"
import type { Selection } from "@/lib/selection"
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

function ChangeTotals({ files }: { files: Detail["files"] }) {
  const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  return (
    <>
      <Badge variant="secondary" className="h-4 rounded-sm px-1 text-[10px] tabular-nums">
        {files.length.toLocaleString()}
      </Badge>
      <span className="font-mono text-[11px] tabular-nums">
        <span className="text-[var(--lane-1)]">+{additions}</span>{" "}
        <span className="text-destructive">−{deletions}</span>
      </span>
    </>
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
  const detail = latest(useAtomValue(commitAtom(`${repo}\n${oid}`)))
  const diff = latest(useAtomValue(diffAtom(diffKey(repo, { _tag: "Commit", oid }))))
  const items = useMemo(() => (diff?._tag === "Patch" ? patchItems(oid, diff.patch) : []), [diff, oid])
  const collapse = useCollapse()
  const expandable = useMemo(() => expandableIds(items), [items])
  const allCollapsed = expandable.every((id) => collapse.ids.has(id))

  if (detail === undefined || detail.oid !== oid) {
    return <Loading label="Loading commit" />
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
        <ChangeTotals files={detail.files} />
      </SectionBar>
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

function SectionBar({ label, actions, children }: { label: string; actions: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b bg-muted/40 px-2">
      <span className="font-medium text-muted-foreground">{label}</span>
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
        <ChangeTotals files={detail.files} />
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
                      open?.path === file.path && "bg-accent",
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
  const diff = latest(useAtomValue(diffAtom(diffKey(repo, { _tag: "Commit", oid }, paths))))
  const items = useMemo(() => (diff?._tag === "Patch" ? patchItems("file", diff.patch) : []), [diff])
  if (diff === undefined) return <Loading label="Loading diff" />
  if (diff._tag === "TooLarge")
    return <Nothing title="Too large to display" description="This file's diff is over 4 MB." />
  return (
    <DiffStack repo={repo} items={items} actions={(meta) => <HistoryButton onClick={() => onHistory(meta.path)} />} />
  )
}
