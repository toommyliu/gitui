import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { Oid, RecoveryEntry, RepoId, UndoCommit } from "@gitui/contracts"
import * as Exit from "effect/Exit"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useCommand } from "@/lib/commands"
import { longDate, shortOid } from "@/lib/format"
import { describeFailure, latest, loadError, recoveryAtom, useRunGitAction } from "@/lib/git"

type AvailableUndo = Extract<UndoCommit, { _tag: "Available" }>
type View = { kind: "list" } | { kind: "recover"; entry: RecoveryEntry } | { kind: "undo"; commit: AvailableUndo }

export function RecoveryDialog({ repo, onInspect }: { repo: RepoId; onInspect: (oid: Oid) => void }) {
  const [open, setOpen] = useState(false)
  useCommand("repo.recovery", () => setOpen(true))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-2xl">
        {open && (
          <RecoveryContent
            repo={repo}
            onClose={() => setOpen(false)}
            onInspect={(oid) => {
              setOpen(false)
              onInspect(oid)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RecoveryContent({
  repo,
  onClose,
  onInspect,
}: {
  repo: RepoId
  onClose: () => void
  onInspect: (oid: Oid) => void
}) {
  const atom = recoveryAtom(repo)
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const recovery = latest(result)
  const [view, setView] = useState<View>({ kind: "list" })
  const [message, setMessage] = useState("")
  const [filter, setFilter] = useState("")
  const id = useId()
  const show = (next: View) => {
    setMessage("")
    setView(next)
  }
  if (view.kind === "recover")
    return (
      <RecoverForm
        key={view.entry.oid}
        repo={repo}
        entry={view.entry}
        onDone={(name) => {
          show({ kind: "list" })
          setMessage(`Created branch ${name}. The current branch stayed in place.`)
          refresh()
        }}
        onCancel={() => show({ kind: "list" })}
      />
    )
  if (view.kind === "undo")
    return (
      <UndoForm
        repo={repo}
        commit={view.commit}
        onDone={() => {
          show({ kind: "list" })
          setMessage(
            "Undid the commit. Its changes are staged, together with the previous staged changes. Unstaged edits are unchanged.",
          )
          refresh()
        }}
        onCancel={() => show({ kind: "list" })}
      />
    )
  const query = filter.trim().toLowerCase()
  const entries =
    recovery?.entries.filter((entry) =>
      `${entry.action} ${entry.subject} ${entry.oid} ${entry.actor}`.toLowerCase().includes(query),
    ) ?? []
  const error = loadError(result)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Recovery</DialogTitle>
        <DialogDescription>
          Find previous commits in this worktree's reflog and app backups. Reflog cannot restore discarded uncommitted
          files.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={recovery?.undo._tag !== "Available"}
          onClick={() => {
            if (recovery?.undo._tag === "Available") show({ kind: "undo", commit: recovery.undo })
          }}
        >
          Undo last commit…
        </Button>
        <Button variant="ghost" size="sm" onClick={refresh}>
          Refresh
        </Button>
        {recovery?.undo._tag === "Unavailable" && <p className="text-muted-foreground">{recovery.undo.reason}</p>}
      </div>
      <p role="status" className={message === "" ? "sr-only" : "text-xs text-muted-foreground"}>
        {message}
      </p>
      <Field>
        <FieldLabel htmlFor={`${id}-filter`}>Find a commit or action</FieldLabel>
        <Input
          id={`${id}-filter`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Commit message, SHA, reset, rebase…"
          autoComplete="off"
        />
      </Field>
      <div className="max-h-[min(28rem,50dvh)] overflow-y-auto overscroll-contain rounded-md border">
        {error !== undefined ? (
          <p role="alert" className="p-3 text-destructive">
            {error}
          </p>
        ) : recovery === undefined ? (
          <p className="p-3 text-muted-foreground">Loading recovery…</p>
        ) : entries.length === 0 ? (
          <p className="p-3 text-muted-foreground">
            {query === ""
              ? "No recovery entries yet. Commits and branch changes will appear here."
              : "No matching entries. Try another message, action, or SHA."}
          </p>
        ) : (
          entries.map((entry) => (
            <div key={`${entry.kind}:${entry.selector}`} className="grid gap-2 border-b p-3 last:border-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium break-words">{entry.action}</span>
                <time
                  className="text-[11px] text-muted-foreground"
                  dateTime={new Date(entry.time * 1000).toISOString()}
                >
                  {longDate(entry.time)}
                </time>
              </div>
              <p className="break-words">{entry.subject}</p>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <code>{shortOid(entry.oid)}</code>
                <span>{entry.actor}</span>
                <span className="min-w-0 break-all">{entry.selector}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onInspect(entry.oid)}>
                  Inspect commit
                </Button>
                <Button variant="outline" size="sm" onClick={() => show({ kind: "recover", entry })}>
                  Recover as branch…
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <DialogFooter>
        <span className="me-auto self-center text-[11px] text-muted-foreground">
          Up to 500 reflog entries and 100 app backups. Git may expire reflog entries.
        </span>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  )
}

function RecoverForm({
  repo,
  entry,
  onDone,
  onCancel,
}: {
  repo: RepoId
  entry: RecoveryEntry
  onDone: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(`recovered-${shortOid(entry.oid)}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const run = useRunGitAction()
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        setError(null)
        void run(repo, (client) => client("RecoverCommit", { repo, oid: entry.oid, name: name.trim() })).then(
          (exit) => {
            setBusy(false)
            if (Exit.isSuccess(exit)) onDone(name.trim())
            else setError(describeFailure(exit.cause))
          },
        )
      }}
    >
      <DialogHeader>
        <DialogTitle>Recover as a new branch</DialogTitle>
        <DialogDescription>
          Create a branch at {shortOid(entry.oid)}. Your current branch and working files stay in place.
        </DialogDescription>
      </DialogHeader>
      <p className="break-words">{entry.subject}</p>
      <Field>
        <FieldLabel htmlFor={`${id}-branch`}>Branch name</FieldLabel>
        <Input
          id={`${id}-branch`}
          required
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby={error === null ? undefined : `${id}-error`}
        />
      </Field>
      {error !== null && (
        <FieldError id={`${id}-error`} role="alert" className="whitespace-pre-line">
          {error}
        </FieldError>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}Create recovery branch
        </Button>
      </DialogFooter>
    </form>
  )
}

function UndoForm({
  repo,
  commit,
  onDone,
  onCancel,
}: {
  repo: RepoId
  commit: AvailableUndo
  onDone: () => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useRunGitAction()
  return (
    <>
      <DialogHeader>
        <DialogTitle>Undo last commit on {commit.branch}?</DialogTitle>
        <DialogDescription>
          Move the branch from {shortOid(commit.oid)} to {shortOid(commit.parent)}. The commit's changes become staged.
          Existing staged changes and unstaged edits stay in place.
        </DialogDescription>
      </DialogHeader>
      <p className="break-words">{commit.subject}</p>
      <p className="text-muted-foreground">
        A backup of this commit will appear in Recovery. If you already pushed it, this changes local history and does
        not undo the remote commit.
      </p>
      {error !== null && (
        <FieldError role="alert" className="whitespace-pre-line">
          {error}
        </FieldError>
      )}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            if (busy) return
            setBusy(true)
            setError(null)
            void run(repo, (client) =>
              client("UndoCommit", { repo, expected: commit.oid, branch: commit.branch }),
            ).then((exit) => {
              setBusy(false)
              if (Exit.isSuccess(exit)) onDone()
              else setError(describeFailure(exit.cause))
            })
          }}
        >
          {busy && <Spinner />}Undo commit and keep changes
        </Button>
      </DialogFooter>
    </>
  )
}
