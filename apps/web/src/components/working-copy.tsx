import { useAtomValue } from "@effect/atom-react"
import type { Change, RepoId, RepoPath, Status, StatusEntry } from "@gitui/contracts"
import type { CodeViewHandle } from "@pierre/diffs/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@workspace/ui/components/resizable"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "cn"
import { useEffect, useMemo, useRef, useState } from "react"
import { basename, dirname } from "@/lib/format"
import { diffAtom, diffKey, latest, statusAtom, useGitAction } from "@/lib/git"
import { ChangeLetter } from "./commit-detail"
import { useConfirm } from "./confirm"
import { Loading, Nothing } from "./loading"
import { DiffStack, type DiffItemMeta, patchItems } from "./diff-view"

type Area = "unstaged" | "untracked" | "conflicted" | "staged"

interface FileRow {
  readonly area: Area
  readonly path: RepoPath
  readonly paths: ReadonlyArray<RepoPath>
  readonly change: Change
  readonly label: string
}

type ListRow = { readonly kind: "header"; readonly side: "unstaged" | "staged"; readonly count: number } | FileRow

const MAX_UNTRACKED_PREVIEWS = 50
const ROW = 22

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

const draftKey = (repo: RepoId) => `gitui.draft:${repo}`

export function WorkingCopy({ repo }: { repo: RepoId }) {
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
  const untrackedDiff = latest(useAtomValue(diffAtom(diffKey(repo, { _tag: "Untracked" }, untrackedPaths))))

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

  const viewRef = useRef<CodeViewHandle<undefined, undefined>>(null)
  const reveal = (row: FileRow) => {
    const section = row.area === "staged" ? "staged" : row.area === "untracked" ? "untracked" : "unstaged"
    viewRef.current?.scrollTo({ type: "item", id: `${section}\n${row.path}`, align: "start" })
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
    return row.area === "staged" ? (
      <Button size="xs" variant="outline" onClick={() => unstage(row.paths)}>
        Unstage
      </Button>
    ) : (
      <span className="flex gap-1">
        <Button size="xs" variant="ghost" onClick={() => discard([row])}>
          Discard
        </Button>
        <Button size="xs" variant="outline" onClick={() => stage(row.paths)}>
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
          <CommitBox repo={repo} status={status} stagedCount={staged.length} />
          <FileLists
            unstaged={unstaged}
            staged={staged}
            onReveal={reveal}
            onStage={(rows) => stage(rows.flatMap((r) => r.paths))}
            onUnstage={(rows) => unstage(rows.flatMap((r) => r.paths))}
            onDiscard={discard}
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
          <Nothing title="No changes" description="The working tree matches HEAD." />
        ) : (
          <DiffStack items={items} actions={actions} viewRef={viewRef} />
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function CommitBox({ repo, status, stagedCount }: { repo: RepoId; status: Status; stagedCount: number }) {
  const [message, setMessage] = useState(() => localStorage.getItem(draftKey(repo)) ?? "")
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const git = useGitAction()

  useEffect(() => {
    if (message === "") localStorage.removeItem(draftKey(repo))
    else localStorage.setItem(draftKey(repo), message)
  }, [repo, message])

  const canCommit = !busy && message.trim() !== "" && (stagedCount > 0 || amend) && status.operation !== "rebase"
  const commit = async () => {
    if (!canCommit) return
    setBusy(true)
    const ok = await git(amend ? "Amend" : "Commit", repo, (c) => c("Commit", { repo, message, amend }))
    setBusy(false)
    if (ok) {
      setMessage("")
      setAmend(false)
    }
  }

  return (
    <div className="shrink-0 space-y-1.5 border-b p-2">
      <Textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
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
          <FieldLabel htmlFor={`amend-${repo}`} className="font-normal text-muted-foreground">
            Amend previous commit
          </FieldLabel>
        </Field>
        <Button size="sm" className="ml-auto" disabled={!canCommit} onClick={() => void commit()}>
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
  onStage,
  onUnstage,
  onDiscard,
}: {
  unstaged: ReadonlyArray<FileRow>
  staged: ReadonlyArray<FileRow>
  onReveal: (row: FileRow) => void
  onStage: (rows: ReadonlyArray<FileRow>) => void
  onUnstage: (rows: ReadonlyArray<FileRow>) => void
  onDiscard: (rows: ReadonlyArray<FileRow>) => void
}) {
  const rows = useMemo<Array<ListRow>>(
    () => [
      { kind: "header", side: "unstaged", count: unstaged.length },
      ...unstaged,
      { kind: "header", side: "staged", count: staged.length },
      ...staged,
    ],
    [unstaged, staged],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  })

  return (
    <ScrollArea className="min-h-0 flex-1" viewportRef={scrollRef} viewportProps={{ className: "[contain:strict]" }}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!
          return (
            <div
              key={item.key}
              className="absolute top-0 left-0 w-full"
              style={{ height: ROW, transform: `translateY(${item.start}px)` }}
            >
              {"kind" in row ? (
                <div className="flex h-full items-center gap-2 bg-muted/40 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {row.side === "unstaged" ? "Unstaged" : "Staged"}
                  <Badge variant="secondary" className="h-4 rounded-sm px-1 text-[10px] tabular-nums">
                    {row.count}
                  </Badge>
                  {row.count > 0 && (
                    <span className="ml-auto flex gap-1 normal-case">
                      {row.side === "unstaged" ? (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => onDiscard(unstaged.filter((r) => r.area !== "conflicted"))}
                          >
                            Discard all
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => onStage(unstaged)}>
                            Stage all
                          </Button>
                        </>
                      ) : (
                        <Button size="xs" variant="ghost" onClick={() => onUnstage(staged)}>
                          Unstage all
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              ) : (
                <div className="group flex h-full items-center gap-2 px-2 hover:bg-muted/60">
                  <button
                    type="button"
                    onClick={() => onReveal(row)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
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
                  <span className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 max-md:opacity-100">
                    {row.area === "staged" ? (
                      <Button size="xs" variant="ghost" onClick={() => onUnstage([row])}>
                        Unstage
                      </Button>
                    ) : (
                      <>
                        {row.area !== "conflicted" && (
                          <Button size="xs" variant="ghost" onClick={() => onDiscard([row])}>
                            Discard
                          </Button>
                        )}
                        <Button size="xs" variant="ghost" onClick={() => onStage([row])}>
                          Stage
                        </Button>
                      </>
                    )}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
