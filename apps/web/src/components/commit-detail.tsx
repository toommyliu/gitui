import { useAtomValue } from "@effect/atom-react"
import type { CommitDetail as Detail, FileChange, Oid, RepoId } from "@gitui/contracts"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "cn"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { longDate, shortOid } from "@/lib/format"
import { commitAtom, diffAtom, diffKey, latest } from "@/lib/git"
import type { Selection } from "@/lib/selection"
import { DiffStack, patchItems } from "./diff-view"
import { Loading, Nothing } from "./loading"

const changeLetter: Record<FileChange["change"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  typechange: "T",
}

export const changeColor: Record<FileChange["change"], string> = {
  added: "text-[var(--lane-1)]",
  deleted: "text-destructive",
  modified: "text-[var(--lane-2)]",
  renamed: "text-[var(--lane-0)]",
  copied: "text-[var(--lane-0)]",
  typechange: "text-[var(--lane-6)]",
}

export function ChangeLetter({ change }: { change: FileChange["change"] }) {
  return <span className={cn("w-3 shrink-0 font-mono font-semibold", changeColor[change])}>{changeLetter[change]}</span>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-right text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  )
}

function Summary({ detail, onSelect }: { detail: Detail; onSelect: (selection: Selection) => void }) {
  const sameCommitter = detail.committer.name === detail.author.name && detail.committer.email === detail.author.email
  const additions = detail.files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = detail.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  return (
    <div className="border-b px-3 py-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
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
        <Field label="Changes">
          {detail.files.length} {detail.files.length === 1 ? "file" : "files"}
          <span className="ml-2 text-[var(--lane-1)]">+{additions}</span>
          <span className="ml-1 text-destructive">−{deletions}</span>
        </Field>
      </dl>
      <pre className="mt-3 font-mono text-[12px] leading-5 whitespace-pre-wrap">{detail.message}</pre>
    </div>
  )
}

export function CommitDetail({
  repo,
  oid,
  onSelect,
}: {
  repo: RepoId
  oid: Oid
  onSelect: (selection: Selection) => void
}) {
  const detail = latest(useAtomValue(commitAtom(`${repo}\n${oid}`)))
  const diff = latest(useAtomValue(diffAtom(diffKey(repo, { _tag: "Commit", oid }))))
  const items = useMemo(() => (diff?._tag === "Patch" ? patchItems("commit", diff.patch) : []), [diff])

  if (detail === undefined || detail.oid !== oid) {
    return <Loading label="Loading commit" />
  }
  if (diff?._tag === "TooLarge") {
    return (
      <div className="flex h-full flex-col overflow-auto">
        <Summary detail={detail} onSelect={onSelect} />
        <LargeCommitFiles repo={repo} detail={detail} />
      </div>
    )
  }
  return <DiffStack key={oid} items={items} header={() => <Summary detail={detail} onSelect={onSelect} />} />
}

const FILE_ROW = 24

function LargeCommitFiles({ repo, detail }: { repo: RepoId; detail: Detail }) {
  const [open, setOpen] = useState<FileChange | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: detail.files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FILE_ROW,
    overscan: 20,
  })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Alert className="mx-3 my-2 w-auto">
        <AlertTitle>Too large to show at once</AlertTitle>
        <AlertDescription>Pick a file to see its diff.</AlertDescription>
      </Alert>
      <ScrollArea
        className="h-64 shrink-0 border-y"
        viewportRef={scrollRef}
        viewportProps={{ className: "[contain:strict]" }}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const file = detail.files[item.index]!
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setOpen(file)}
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
      {open !== null && <SingleFileDiff repo={repo} oid={detail.oid} file={open} />}
    </div>
  )
}

function SingleFileDiff({ repo, oid, file }: { repo: RepoId; oid: Oid; file: FileChange }) {
  const paths = file.from === null ? [file.path] : [file.from, file.path]
  const diff = latest(useAtomValue(diffAtom(diffKey(repo, { _tag: "Commit", oid }, paths))))
  const items = useMemo(() => (diff?._tag === "Patch" ? patchItems("file", diff.patch) : []), [diff])
  if (diff === undefined) return <Loading label="Loading diff" />
  if (diff._tag === "TooLarge")
    return <Nothing title="Too large to display" description="This file's diff is over 4 MB." />
  if (diff._tag === "Binary") return <Nothing title="Binary file" />
  return (
    <div className="min-h-0 flex-1">
      <DiffStack items={items} />
    </div>
  )
}
