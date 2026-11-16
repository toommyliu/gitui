import type { DiscardBackup, RepoPath } from "@gitui/contracts"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { createMemo, createSignal, For, Show } from "solid-js"
import { basename, dirname, longDate, shortDate } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import { Check } from "./icons"
import { Boundary } from "./state"
import { Alert, Button } from "./ui"

export interface RestoreConflict {
  readonly backup: DiscardBackup
  readonly paths: ReadonlyArray<RepoPath>
  readonly version: string
}

export type Recovery = { readonly kind: "List" } | { readonly kind: "Conflict"; readonly conflict: RestoreConflict }

const PREVIEW_PATHS = 5

export const discardSubject = (paths: ReadonlyArray<string>) =>
  paths.length === 1 ? basename(paths[0] ?? "") : `${paths.length} files`

const titles: Record<DiscardBackup["kind"], (backup: DiscardBackup) => string> = {
  files: (backup) => `Discarded ${discardSubject(backup.paths)}`,
  lines: (backup) => `Discarded lines in ${discardSubject(backup.paths)}`,
  restore: (backup) => `Before restoring ${discardSubject(backup.paths)}`,
}

function Paths(props: { paths: ReadonlyArray<RepoPath>; limit?: number }) {
  const limit = () => props.limit ?? props.paths.length
  return (
    <ul class="flex flex-col font-mono text-2xs">
      <For each={props.paths.slice(0, limit())}>
        {(path) => (
          <li class="truncate">
            <span class="text-muted-foreground">{dirname(path)}</span>
            {basename(path)}
          </li>
        )}
      </For>
      <Show when={props.paths.length > limit()}>
        <li class="font-sans text-muted-foreground">and {props.paths.length - limit()} more</li>
      </Show>
    </ul>
  )
}

function Backups(props: { backups: ReadonlyArray<DiscardBackup>; onConflict: (conflict: RestoreConflict) => void }) {
  const repo = useRepo()
  const [restoring, setRestoring] = createSignal<string | null>(null)
  const [restored, setRestored] = createSignal<ReadonlySet<string>>(new Set())
  const [failure, setFailure] = createSignal<{ readonly id: string; readonly message: string } | null>(null)

  const restore = async (backup: DiscardBackup) => {
    if (restoring() !== null) return
    setRestoring(backup.id)
    setFailure(null)
    try {
      const result = await repo.mutate(["worktree"], (git) =>
        git.RestoreDiscard({ repo: repo.id, id: backup.id, overwriteVersion: null }),
      )
      if (result._tag === "Restored") setRestored((current) => new Set(current).add(backup.id))
      else props.onConflict({ backup, paths: result.paths, version: result.version })
    } catch (error) {
      setFailure({ id: backup.id, message: describeError(error) })
    } finally {
      setRestoring(null)
    }
  }

  return (
    <Show
      when={props.backups.length > 0}
      fallback={
        <p class="px-3 py-4 text-center text-muted-foreground">
          Nothing discarded yet. When you discard files or lines, a backup shows up here.
        </p>
      }
    >
      <ul class="divide-y">
        <For each={props.backups} keyed={(backup) => backup.id}>
          {(backup) => (
            <li class="flex flex-col gap-1 px-3 py-2">
              <div class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-medium">{titles[backup().kind](backup())}</span>
                <time
                  class="shrink-0 text-2xs text-muted-foreground tabular-nums"
                  datetime={new Date(backup().time).toISOString()}
                >
                  {shortDate(backup().time / 1000)}
                </time>
                <Show
                  when={!restored().has(backup().id)}
                  fallback={
                    <span class="flex h-6 shrink-0 items-center gap-1 px-2 text-xs text-change-added">
                      <Check />
                      Restored
                    </span>
                  }
                >
                  <Button
                    disabled={restoring() !== null}
                    aria-label={`Restore ${discardSubject(backup().paths)} from ${longDate(backup().time / 1000)}`}
                    onClick={() => void restore(backup())}
                  >
                    Restore
                  </Button>
                </Show>
              </div>
              <Paths paths={backup().paths} limit={PREVIEW_PATHS} />
              <Show when={failure()?.id === backup().id ? failure() : null}>
                {(current) => (
                  <Alert tone="error" title="Couldn't restore" onDismiss={() => setFailure(null)} class="pe-7">
                    {current().message}
                  </Alert>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  )
}

function ConflictForm(props: { conflict: RestoreConflict; onDone: () => void }) {
  const repo = useRepo()
  const [conflict, setConflict] = createSignal(props.conflict)
  const [busy, setBusy] = createSignal(false)
  const [failure, setFailure] = createSignal<string | null>(null)

  const replace = async () => {
    const current = conflict()
    setBusy(true)
    setFailure(null)
    try {
      const result = await repo.mutate(["worktree"], (git) =>
        git.RestoreDiscard({ repo: repo.id, id: current.backup.id, overwriteVersion: current.version }),
      )
      if (result._tag === "Restored") return props.onDone()
      setConflict({ backup: current.backup, paths: result.paths, version: result.version })
      setFailure("These files changed again. Check the list, then choose again.")
    } catch (error) {
      setFailure(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div class="flex flex-col gap-1">
        <DialogTitle>Replace newer edits?</DialogTitle>
        <DialogDescription>
          These files changed after the backup was saved. Your current versions are backed up first, then replaced.
          Staged changes stay as they are.
        </DialogDescription>
      </div>
      <div class="max-h-48 overflow-y-auto rounded-md border px-2.5 py-1.5">
        <Paths paths={conflict().paths} />
      </div>
      <Show when={failure()}>{(message) => <Alert tone="error">{message()}</Alert>}</Show>
      <div class="flex justify-end gap-1.5">
        <Button disabled={busy()} onClick={() => props.onDone()}>
          Keep current files
        </Button>
        <Button variant="primary" disabled={busy()} onClick={() => void replace()}>
          Back up and restore
        </Button>
      </div>
    </>
  )
}

export function RecoveryDialog(props: { view: Recovery | null; onViewChange: (view: Recovery | null) => void }) {
  const repo = useRepo()
  const backups = createMemo(() =>
    props.view?.kind === "List" ? call((git) => git.GetDiscardRecovery({ repo: repo.id })) : null,
  )
  return (
    <Dialog open={props.view !== null} onOpenChange={(open) => !open && props.onViewChange(null)}>
      <DialogBackdrop />
      <DialogContent class="w-[min(30rem,calc(100%-2rem))]">
        <Show when={props.view} keyed>
          {(current) =>
            current.kind === "Conflict" ? (
              <ConflictForm conflict={current.conflict} onDone={() => props.onViewChange(null)} />
            ) : (
              <>
                <div class="flex flex-col gap-1">
                  <DialogTitle>Discarded changes</DialogTitle>
                  <DialogDescription>
                    Restoring puts each file back as it was right before the discard. Staged changes stay as they are.
                  </DialogDescription>
                </div>
                <div class="max-h-[min(24rem,50dvh)] min-h-16 overflow-y-auto rounded-md border">
                  <Boundary label="Reading backups" title="Couldn't read the backups">
                    <Backups
                      backups={backups() ?? []}
                      onConflict={(conflict) => props.onViewChange({ kind: "Conflict", conflict })}
                    />
                  </Boundary>
                </div>
                <div class="flex justify-end">
                  <Button onClick={() => props.onViewChange(null)}>Done</Button>
                </div>
              </>
            )
          }
        </Show>
      </DialogContent>
    </Dialog>
  )
}
