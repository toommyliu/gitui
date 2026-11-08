import { Hint } from "@/components/ui/tooltip"
import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { FileHistory, FileHistoryEntry, Oid, RepoId, RepoPath } from "@gitui/contracts"
import { cn } from "cn"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useHistoryDate } from "@/lib/dates"
import { type FileTarget, fileHistoryAtom, filePickerAtom, fileKey } from "@/lib/file-investigation"
import { type FileVersion, fileVersions } from "@/lib/file-versions"
import { literalPath } from "@/lib/literal-path"
import { basename, dirname, shortOid } from "@/lib/format"
import { latest, loadError } from "@/lib/git"
import { ChangeLetter } from "./change-letter"
import { FileVersionPane, type VersionTab } from "./file-version"
import { Loading, Nothing } from "./loading"
import { TrackedFilePicker } from "./tracked-file-picker"

export function FilePickerDialog({ repo, onPick }: { repo: RepoId; onPick: (target: FileTarget) => void }) {
  const [open, setOpen] = useAtom(filePickerAtom(repo))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(36rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        {open && (
          <TrackedFilePicker
            repo={repo}
            onPick={(target) => {
              setOpen(false)
              onPick(target)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export function FileHistoryView({
  repo,
  target,
  onPick,
  onOpenCommit,
  onClose,
}: {
  repo: RepoId
  target: FileTarget
  onPick: () => void
  onOpenCommit: (oid: Oid) => void
  onClose: () => void
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
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b pr-1.5 pl-2">
        <Hint label={literalPath(target.path)}>
          <h2 className="min-w-0 flex-1 truncate font-medium">
            <span className="font-normal text-muted-foreground">{dirname(target.path)}</span>
            {basename(target.path)}
            {!atHead && <span className="font-normal text-muted-foreground"> · up to {shortOid(target.revision)}</span>}
            {target.destination !== undefined && target.destination !== target.path && (
              <span className="font-normal text-muted-foreground"> · now at {literalPath(target.destination)}</span>
            )}
          </h2>
        </Hint>
        <Button size="xs" variant="ghost" onClick={onPick}>
          Other file…
        </Button>
        <Button size="xs" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
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
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="35%" minSize="15%">
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
    </div>
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
        className="pb-1"
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
        <p className="px-3 py-2 text-2xs text-muted-foreground">
          Only the {history.entries.length.toLocaleString()} most recent commits are listed.
        </p>
      )}
    </div>
  )
}

const anchorLabels = {
  Head: { badge: "HEAD", title: "Committed version", detail: "without uncommitted changes" },
  Requested: { badge: "Selected", title: "File at this commit", detail: "the commit you opened" },
}

const pathNote = (version: Extract<FileVersion, { entry: FileHistoryEntry }>, investigatedPath: RepoPath) => {
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
  if (version._tag === "Head" || version._tag === "Requested") {
    const label = anchorLabels[version._tag]
    return (
      <>
        <span className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary" className="h-4 shrink-0 rounded-sm px-1 text-2xs">
            {label.badge}
          </Badge>
          <span className="truncate">{label.title}</span>
        </span>
        <span className="truncate text-2xs text-muted-foreground">
          <span className="font-mono">{shortOid(version.source.revision)}</span> · {label.detail}
        </span>
      </>
    )
  }
  const { entry } = version
  const note = pathNote(version, investigatedPath)
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <ChangeLetter change={entry.change} />
        <span className="truncate">{entry.subject}</span>
      </span>
      <span className="flex min-w-0 gap-1.5 pl-5 text-2xs text-muted-foreground">
        <span className="shrink-0 font-mono">{shortOid(entry.oid)}</span>
        <span className="truncate">{entry.author}</span>
        <span className="ml-auto shrink-0 tabular-nums">{date(entry.time)}</span>
      </span>
      {note !== null && (
        <Hint label={note}>
          <span className="truncate pl-5 text-2xs text-muted-foreground">{note}</span>
        </Hint>
      )}
    </>
  )
}
