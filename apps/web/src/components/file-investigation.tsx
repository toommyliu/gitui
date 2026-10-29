import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { FileHistory, Oid, RepoId, RepoPath } from "@gitui/contracts"
import { cn } from "cn"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useHistoryDate } from "@/lib/dates"
import { type FileTarget, fileHistoryAtom, fileKey, investigationAtom } from "@/lib/file-investigation"
import { type FileVersion, fileVersions } from "@/lib/file-versions"
import { literalPath } from "@/lib/literal-path"
import { basename, shortOid } from "@/lib/format"
import { latest, loadError } from "@/lib/git"
import { useNarrow } from "@/lib/narrow"
import type { Selection } from "@/lib/selection"
import { ChangeLetter } from "./change-letter"
import { FileVersionPane, type VersionTab } from "./file-version"
import { Loading, Nothing } from "./loading"
import { TrackedFilePicker } from "./tracked-file-picker"

export function FileInvestigationDialog({
  repo,
  onSelect,
}: {
  repo: RepoId
  onSelect: (selection: Selection) => void
}) {
  const [investigation, setInvestigation] = useAtom(investigationAtom(repo))
  const openCommit = (oid: Oid) => {
    setInvestigation(null)
    onSelect({ _tag: "Commit", oid })
  }
  return (
    <Dialog
      open={investigation !== null}
      onOpenChange={(open) => {
        if (!open) setInvestigation(null)
      }}
    >
      <DialogContent className="flex h-[min(56rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-7xl">
        {investigation?._tag === "Pick" ? (
          <TrackedFilePicker
            repo={repo}
            onPick={(path) => setInvestigation({ _tag: "File", revision: "HEAD", path })}
          />
        ) : investigation?._tag === "File" ? (
          <FileInvestigation
            key={JSON.stringify([repo, investigation])}
            repo={repo}
            target={investigation}
            onPick={() => setInvestigation({ _tag: "Pick" })}
            onOpenCommit={openCommit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function FileInvestigation({
  repo,
  target,
  onPick,
  onOpenCommit,
}: {
  repo: RepoId
  target: FileTarget
  onPick: () => void
  onOpenCommit: (oid: Oid) => void
}) {
  const atom = fileHistoryAtom(fileKey(repo, target.revision, target.path))
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const history = latest(result)
  const error = loadError(result)
  const atHead = target.revision === "HEAD"
  const versions = useMemo(() => (history === undefined ? [] : fileVersions(history, atHead)), [history, atHead])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selected = versions.find((version) => version.key === selectedKey) ?? versions[0]
  const [tab, setTab] = useState<VersionTab>("contents")
  const narrow = useNarrow()
  return (
    <>
      <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
        <div className="flex items-center gap-3">
          <DialogTitle className="min-w-0 truncate text-sm">History of {basename(target.path)}</DialogTitle>
          <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={onPick}>
            Choose another file…
          </Button>
        </div>
        <DialogDescription className="break-all">
          <span className="font-mono text-foreground">{literalPath(target.path)}</span>{" "}
          {atHead ? (
            "· Committed history at HEAD. Uncommitted changes aren't included."
          ) : (
            <>
              · History up to commit <span className="font-mono">{shortOid(target.revision)}</span>
            </>
          )}
          {target.destination !== undefined && target.destination !== target.path && (
            <span className="block">
              Current working path: <span className="font-mono text-foreground">{literalPath(target.destination)}</span>
            </span>
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1">
        {history === undefined ? (
          error === undefined ? (
            <Loading label="Loading file history" />
          ) : (
            <Nothing title="Couldn't load this file's history" description={error} onRetry={refresh} />
          )
        ) : selected === undefined ? (
          <Nothing
            title="No commits changed this file"
            description={`No commit up to ${shortOid(history.revision)} changed ${history.path}.`}
          />
        ) : (
          <ResizablePanelGroup key={narrow ? "narrow" : "wide"} orientation={narrow ? "vertical" : "horizontal"}>
            <ResizablePanel defaultSize="32%" minSize="15%">
              <HistoryList
                history={history}
                versions={versions}
                selected={selected}
                onSelect={(version) => setSelectedKey(version.key)}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel minSize="30%">
              <FileVersionPane
                key={`${selected.key}\n${selected.source.revision}`}
                repo={repo}
                version={selected}
                investigatedPath={target.destination ?? history.path}
                tab={tab}
                onTabChange={setTab}
                onOpenCommit={onOpenCommit}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </>
  )
}

const keySteps: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (index) => index + 1,
  j: (index) => index + 1,
  ArrowUp: (index) => index - 1,
  k: (index) => index - 1,
  Home: () => 0,
  End: (_, last) => last,
}

function HistoryList({
  history,
  versions,
  selected,
  onSelect,
}: {
  history: FileHistory
  versions: ReadonlyArray<FileVersion>
  selected: FileVersion
  onSelect: (version: FileVersion) => void
}) {
  const id = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const index = versions.indexOf(selected)
  const date = useHistoryDate()
  useEffect(() => {
    listRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    document.getElementById(`${id}-${index}`)?.scrollIntoView({ block: "nearest" })
  }, [id, index])
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label="Versions of this file"
        aria-activedescendant={`${id}-${index}`}
        className="py-1 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        onKeyDown={(event) => {
          const step = keySteps[event.key]
          if (step === undefined || event.metaKey || event.ctrlKey || event.altKey) return
          event.preventDefault()
          const next = versions[Math.max(0, Math.min(versions.length - 1, step(index, versions.length - 1)))]
          if (next !== undefined) onSelect(next)
        }}
      >
        {versions.map((version, i) => (
          <div
            key={version.key}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === index}
            className={cn(
              "grid cursor-default gap-0.5 px-3 py-1.5",
              i === index ? "bg-selection" : "hover:bg-muted/60",
            )}
            onClick={() => {
              listRef.current?.focus({ preventScroll: true })
              onSelect(version)
            }}
          >
            <VersionRow version={version} investigatedPath={history.path} date={date} />
          </div>
        ))}
      </div>
      {history.truncated && (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          Only the {history.entries.length.toLocaleString()} most recent commits are listed.
        </p>
      )}
    </div>
  )
}

const pathNote = (version: Exclude<FileVersion, { _tag: "Head" }>, investigatedPath: RepoPath) => {
  const { entry } = version
  if (version._tag === "BeforeDeletion") return "Deleted here. Shows the version just before."
  if (entry.from !== null) return `${entry.change === "copied" ? "Copied" : "Renamed"} from ${literalPath(entry.from)}`
  if (entry.path !== investigatedPath) return `At ${literalPath(entry.path)}`
  return null
}

function VersionRow({
  version,
  investigatedPath,
  date,
}: {
  version: FileVersion
  investigatedPath: RepoPath
  date: (seconds: number) => string
}) {
  if (version._tag === "Head")
    return (
      <>
        <span className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary" className="h-4 shrink-0 rounded-sm px-1 text-[10px]">
            HEAD
          </Badge>
          <span className="truncate">Committed version</span>
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          <span className="font-mono">{shortOid(version.source.revision)}</span> · without uncommitted changes
        </span>
      </>
    )
  const { entry } = version
  const note = pathNote(version, investigatedPath)
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <ChangeLetter change={entry.change} />
        <span className="truncate">{entry.subject}</span>
      </span>
      <span className="flex min-w-0 gap-1.5 pl-5 text-[11px] text-muted-foreground">
        <span className="shrink-0 font-mono">{shortOid(entry.oid)}</span>
        <span className="truncate">{entry.author}</span>
        <span className="ml-auto shrink-0 tabular-nums">{date(entry.time)}</span>
      </span>
      {note !== null && (
        <span className="truncate pl-5 text-[11px] text-muted-foreground" title={note}>
          {note}
        </span>
      )}
    </>
  )
}
