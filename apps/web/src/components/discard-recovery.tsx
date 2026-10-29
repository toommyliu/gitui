import { RegistryContext, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { DiscardBackup, RepoId, RepoPath } from "@gitui/contracts"
import * as Exit from "effect/Exit"
import { useContext, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { basename, dirname, longDate } from "@/lib/format"
import {
  type DiscardConflict,
  type DiscardRequest,
  describeFailure,
  discardAtom,
  discardRecoveryAtom,
  latest,
  loadError,
  recoveryViewAtom,
  restoreDiscardAtom,
  useFailureToast,
} from "@/lib/git"

const PREVIEW_PATHS = 5

const subject = (paths: ReadonlyArray<RepoPath>) => (paths.length === 1 ? basename(paths[0]!) : `${paths.length} files`)

const title = (backup: DiscardBackup): string => {
  switch (backup.kind) {
    case "files":
      return backup.paths.length === 1 ? "Discarded file" : `Discarded ${backup.paths.length} files`
    case "lines":
      return "Discarded lines"
    case "restore":
      return "Replaced by a restore"
  }
}

const notes: Record<DiscardBackup["kind"], string | null> = {
  files: null,
  lines: "Restores the whole file as it was before the line discard.",
  restore: "The versions you had before restoring another backup.",
}

export const useDiscard = () => {
  const discard = useAtomSet(discardAtom, { mode: "promiseExit" })
  const restore = useAtomSet(restoreDiscardAtom, { mode: "promiseExit" })
  const registry = useContext(RegistryContext)
  const fail = useFailureToast()
  const undo = async (repo: RepoId, backup: DiscardBackup) => {
    const exit = await restore({ repo, id: backup.id, overwriteVersion: null })
    if (Exit.isFailure(exit)) return fail("Undo discard", exit.cause)
    if (exit.value._tag === "Restored") toast.success(`Restored ${subject(backup.paths)}`)
    else
      registry.set(recoveryViewAtom(repo), {
        _tag: "Conflict",
        conflict: { backup, paths: exit.value.paths, version: exit.value.version },
      })
  }
  return async (request: DiscardRequest) => {
    const exit = await discard(request)
    if (Exit.isFailure(exit)) {
      fail(request._tag === "Files" ? "Discard" : "Discard lines", exit.cause)
      return false
    }
    const backup = exit.value
    if (backup !== null)
      toast.success(
        request._tag === "Files"
          ? `Discarded ${subject(backup.paths)}`
          : `Discarded ${request.lines.length} ${request.lines.length === 1 ? "line" : "lines"} in ${basename(request.path)}`,
        {
          description: "A backup stays in Recovery.",
          action: { label: "Undo", onClick: () => void undo(request.repo, backup) },
          duration: Infinity,
          closeButton: true,
        },
      )
    return true
  }
}

function PathList({ paths, limit = paths.length }: { paths: ReadonlyArray<RepoPath>; limit?: number }) {
  return (
    <ul className="grid gap-0.5">
      {paths.slice(0, limit).map((path) => (
        <li key={path} className="break-all">
          <span className="text-muted-foreground">{dirname(path)}</span>
          {basename(path)}
        </li>
      ))}
      {paths.length > limit && <li className="text-muted-foreground">and {paths.length - limit} more</li>}
    </ul>
  )
}

export function DiscardBackups({
  repo,
  onRestored,
  onConflict,
}: {
  repo: RepoId
  onRestored: (message: string) => void
  onConflict: (conflict: DiscardConflict) => void
}) {
  const atom = discardRecoveryAtom(repo)
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const backups = latest(result)
  const error = loadError(result)
  const restore = useAtomSet(restoreDiscardAtom, { mode: "promiseExit" })
  const [restoring, setRestoring] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ readonly id: string; readonly message: string } | null>(null)
  const start = async (backup: DiscardBackup) => {
    if (restoring !== null) return
    setRestoring(backup.id)
    setFailure(null)
    const exit = await restore({ repo, id: backup.id, overwriteVersion: null })
    setRestoring(null)
    if (Exit.isFailure(exit)) setFailure({ id: backup.id, message: describeFailure(exit.cause) })
    else if (exit.value._tag === "Restored") onRestored(`Restored ${subject(backup.paths)}.`)
    else onConflict({ backup, paths: exit.value.paths, version: exit.value.version })
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="me-auto text-muted-foreground">
          Restoring puts each file back as it was right before the discard. Staged changes stay as they are.
        </p>
        <Button variant="ghost" size="sm" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <div className="max-h-[min(28rem,50dvh)] overflow-y-auto overscroll-contain rounded-md border">
        {error !== undefined ? (
          <p role="alert" className="p-3 text-destructive">
            {error}
          </p>
        ) : backups === undefined ? (
          <p className="p-3 text-muted-foreground">Loading discarded changes…</p>
        ) : backups.length === 0 ? (
          <p className="p-3 text-muted-foreground">
            No discarded changes yet. When you discard files or lines, a backup appears here.
          </p>
        ) : (
          <ul>
            {backups.map((backup) => {
              const note = notes[backup.kind]
              return (
                <li key={backup.id} className="grid gap-2 border-b p-3 last:border-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-medium">{title(backup)}</span>
                    <time className="text-[11px] text-muted-foreground" dateTime={new Date(backup.time).toISOString()}>
                      {longDate(backup.time / 1000)}
                    </time>
                  </div>
                  <PathList paths={backup.paths} limit={PREVIEW_PATHS} />
                  {note !== null && <p className="text-muted-foreground">{note}</p>}
                  {failure?.id === backup.id && (
                    <FieldError role="alert" className="whitespace-pre-line">
                      {failure.message}
                    </FieldError>
                  )}
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={restoring !== null}
                      aria-label={`Restore ${subject(backup.paths)}`}
                      onClick={() => void start(backup)}
                    >
                      {restoring === backup.id && <Spinner />}Restore
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

export function RestoreConflictForm({
  repo,
  conflict: initial,
  onDone,
  onCancel,
}: {
  repo: RepoId
  conflict: DiscardConflict
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const [conflict, setConflict] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [alert, setAlert] = useState<string | null>(null)
  const restore = useAtomSet(restoreDiscardAtom, { mode: "promiseExit" })
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (conflict !== initial) keep.current?.focus()
  }, [conflict, initial])
  const { backup } = conflict
  const replace = async () => {
    if (busy) return
    setBusy(true)
    setAlert(null)
    const exit = await restore({ repo, id: backup.id, overwriteVersion: conflict.version })
    setBusy(false)
    if (Exit.isFailure(exit)) setAlert(describeFailure(exit.cause))
    else if (exit.value._tag === "Restored")
      onDone(`Restored ${subject(backup.paths)}. The files it replaced are saved as the newest backup.`)
    else {
      setConflict({ backup, paths: exit.value.paths, version: exit.value.version })
      setAlert("These files changed again. Check the list, then choose again.")
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Replace newer edits?</DialogTitle>
        <DialogDescription>
          These files changed after the backup was saved. Restoring replaces them with the saved versions.
        </DialogDescription>
      </DialogHeader>
      <div className="max-h-48 overflow-y-auto overscroll-contain rounded-md border p-3">
        <PathList paths={conflict.paths} />
      </div>
      <p className="text-muted-foreground">
        {backup.kind === "lines" && "The backup holds the whole file from before the line discard. "}
        Your current files are saved as a new backup first. Staged changes stay as they are.
      </p>
      {alert !== null && (
        <FieldError role="alert" className="whitespace-pre-line">
          {alert}
        </FieldError>
      )}
      <DialogFooter>
        <Button ref={keep} variant="outline" autoFocus disabled={busy} onClick={onCancel}>
          Keep current files
        </Button>
        <Button disabled={busy} onClick={() => void replace()}>
          {busy && <Spinner />}Back up current files and restore
        </Button>
      </DialogFooter>
    </>
  )
}
