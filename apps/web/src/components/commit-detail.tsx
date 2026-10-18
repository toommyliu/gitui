import { useAtomValue } from "@effect/atom-react"
import type { CommitDetail as Detail, FileChange, Oid, RepoId } from "@gitui/contracts"
import { cn } from "cn"
import { type ReactNode, useMemo, useState } from "react"
import { longDate, shortOid } from "@/lib/format"
import { commitAtom, diffAtom, diffKey, latest } from "@/lib/git"
import type { Selection } from "@/lib/selection"
import { DiffStack, patchItems } from "./diff-view"

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
              <button
                key={parent}
                type="button"
                className="mr-2 font-mono text-primary underline-offset-2 hover:underline"
                onClick={() => onSelect({ _tag: "Commit", oid: parent })}
              >
                {shortOid(parent)}
              </button>
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
    return <div className="p-3 text-muted-foreground">Loading commit…</div>
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

function LargeCommitFiles({ repo, detail }: { repo: RepoId; detail: Detail }) {
  const [open, setOpen] = useState<FileChange | null>(null)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3 py-2 text-muted-foreground">
        This commit's diff is too large to show at once. Pick a file to view it.
      </p>
      <ul className="max-h-64 shrink-0 overflow-auto border-y">
        {detail.files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              onClick={() => setOpen(file)}
              className={cn(
                "flex h-6 w-full items-center gap-2 px-3 text-left hover:bg-muted/60",
                open?.path === file.path && "bg-accent",
              )}
            >
              <ChangeLetter change={file.change} />
              <span className="truncate">{file.path}</span>
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <SingleFileDiff repo={repo} oid={detail.oid} file={open} />}
    </div>
  )
}

function SingleFileDiff({ repo, oid, file }: { repo: RepoId; oid: Oid; file: FileChange }) {
  const paths = file.from === null ? [file.path] : [file.from, file.path]
  const diff = latest(useAtomValue(diffAtom(diffKey(repo, { _tag: "Commit", oid }, paths))))
  const items = useMemo(() => (diff?._tag === "Patch" ? patchItems("file", diff.patch) : []), [diff])
  if (diff?._tag === "TooLarge")
    return <p className="p-3 text-muted-foreground">This file's diff is too large to display.</p>
  if (diff?._tag === "Binary") return <p className="p-3 text-muted-foreground">Binary file.</p>
  return (
    <div className="min-h-0 flex-1">
      <DiffStack items={items} />
    </div>
  )
}
