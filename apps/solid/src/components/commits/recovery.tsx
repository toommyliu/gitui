import type { Recovery, RecoveryEntry, UndoCommit } from "@gitui/contracts"
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/solid/alert-dialog"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { Input } from "@ui-sdk/solid/input"
import { createMemo, createSignal, For, Loading, Show } from "solid-js"
import { shortDate, shortOid } from "@/lib/format"
import { useCommand } from "@/lib/hotkeys"
import { useRepo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import { Check } from "../icons"
import { Centered, Spinner } from "../state"
import { Alert, Button, CopyHash } from "../ui"
import { Prose } from "../commit-mention"

type Loaded = { readonly ok: true; readonly recovery: Recovery } | { readonly ok: false; readonly message: string }

const createRecovery = () => {
  const repo = useRepo()
  const [opened, setOpened] = createSignal<number | null>(null)
  const loaded = createMemo(() =>
    opened() === null
      ? null
      : call((git) => git.GetRecovery({ repo: repo.id })).then(
          (recovery): Loaded => ({ ok: true, recovery }),
          (error: unknown): Loaded => ({ ok: false, message: describeError(error) }),
        ),
  )
  return {
    loaded,
    isOpen: () => opened() !== null,
    open: () => setOpened((count) => (count ?? 0) + 1),
    close: () => setOpened(null),
  }
}

const matches = (entry: RecoveryEntry, query: string) =>
  `${entry.action} ${entry.subject} ${entry.oid} ${entry.actor}`.toLowerCase().includes(query)

function Entry(props: { entry: RecoveryEntry }) {
  const repo = useRepo()
  const [naming, setNaming] = createSignal(false)
  const [name, setName] = createSignal("")
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [created, setCreated] = createSignal<string | null>(null)

  const restore = async (event: SubmitEvent) => {
    event.preventDefault()
    const branch = name().trim()
    if (branch === "") return
    const oid = props.entry.oid
    setPending(true)
    setError(null)
    try {
      await repo.mutate(["refs"], (git) => git.RecoverCommit({ repo: repo.id, oid, name: branch }))
      setCreated(branch)
      setNaming(false)
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <li class="flex flex-col gap-0.5 px-2.5 py-1">
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 flex-1 truncate font-medium">{props.entry.subject || props.entry.action}</span>
        <time
          class="shrink-0 text-2xs text-muted-foreground tabular-nums"
          datetime={new Date(props.entry.time * 1000).toISOString()}
        >
          {shortDate(props.entry.time)}
        </time>
        <Show
          when={created()}
          fallback={
            <Show when={!naming()}>
              <Button
                aria-label={`Restore ${shortOid(props.entry.oid)} as a branch`}
                onClick={() => {
                  setName(`recovered-${shortOid(props.entry.oid)}`)
                  setError(null)
                  setNaming(true)
                }}
              >
                Restore as branch…
              </Button>
            </Show>
          }
        >
          {(branch) => (
            <span class="flex h-6 shrink-0 items-center gap-1 px-2 text-xs text-change-added">
              <Check />
              Created {branch()}
            </span>
          )}
        </Show>
      </div>
      <div class="flex min-w-0 items-center gap-2 text-2xs text-muted-foreground">
        <CopyHash oid={props.entry.oid} />
        <span class={["shrink-0", props.entry.kind === "rewrite" && "text-change-modified"]}>
          {props.entry.kind === "rewrite" ? props.entry.action : props.entry.action.split(":")[0]}
        </span>
        <span class="min-w-0 truncate">{props.entry.actor}</span>
      </div>
      <Show when={naming()}>
        <form class="mt-0.5 flex items-center gap-1.5" onSubmit={(event) => void restore(event)}>
          <Input
            autofocus
            aria-label="Branch name"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            value={name()}
            readonly={pending()}
            onValueChange={(next) => {
              setName(next)
              setError(null)
            }}
            class="h-6 flex-1 font-mono"
          />
          <Button disabled={pending()} onClick={() => setNaming(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending() || name().trim() === ""}>
            Create branch
          </Button>
        </form>
      </Show>
      <Show when={error()}>
        {(message) => (
          <Alert tone="error" title="Couldn't create the branch">
            {message()}
          </Alert>
        )}
      </Show>
    </li>
  )
}

function Entries(props: { entries: ReadonlyArray<RecoveryEntry> }) {
  const [query, setQuery] = createSignal("")
  const shown = createMemo(() => {
    const text = query().trim().toLowerCase()
    return text === "" ? props.entries : props.entries.filter((entry) => matches(entry, text))
  })
  return (
    <>
      <Input
        aria-label="Find a commit"
        placeholder="Find by message, hash or action"
        value={query()}
        onValueChange={setQuery}
        class="h-6"
      />
      <div class="max-h-[min(26rem,55dvh)] min-h-16 overflow-y-auto overscroll-none rounded-md border">
        <Show
          when={shown().length > 0}
          fallback={
            <p class="px-3 py-4 text-center text-muted-foreground">
              {props.entries.length === 0
                ? "Nothing to recover yet. Commits, resets and history edits show up here."
                : "No matching entries."}
            </p>
          }
        >
          <ul class="divide-y">
            <For each={shown()} keyed={(entry) => `${entry.kind}:${entry.selector}`}>
              {(entry) => <Entry entry={entry()} />}
            </For>
          </ul>
        </Show>
      </div>
    </>
  )
}

function Pending() {
  return (
    <Centered>
      <Spinner />
    </Centered>
  )
}

function RecoveryDialog() {
  const recovery = createRecovery()
  useCommand("repo.recovery", recovery.open)
  return (
    <Dialog open={recovery.isOpen()} onOpenChange={(open) => !open && recovery.close()}>
      <DialogBackdrop />
      <DialogContent class="w-[min(34rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <DialogTitle>Recover commits</DialogTitle>
          <DialogDescription>
            Where HEAD pointed recently, and the history saved before rewrites and undos. Restoring creates a branch;
            the current branch and your files stay as they are.
          </DialogDescription>
        </div>
        <Loading fallback={<Pending />}>
          <Show when={recovery.loaded()} keyed>
            {(result) =>
              result.ok ? (
                <Entries entries={result.recovery.entries} />
              ) : (
                <Alert tone="error" title="Couldn't read the reflog">
                  {result.message}
                </Alert>
              )
            }
          </Show>
        </Loading>
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 text-2xs text-muted-foreground">
            Up to 500 reflog entries. Git expires old ones.
          </span>
          <Button onClick={recovery.close}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type Available = Extract<UndoCommit, { _tag: "Available" }>

function UndoBody(props: { undo: UndoCommit; onClose: () => void }) {
  const repo = useRepo()
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const undo = async (commit: Available) => {
    setPending(true)
    setError(null)
    try {
      await repo.mutate(["refs", "index", "worktree"], (git) =>
        git.UndoCommit({ repo: repo.id, expected: commit.oid, branch: commit.branch }),
      )
      props.onClose()
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <Show
      when={props.undo._tag === "Available" ? props.undo : null}
      fallback={
        <>
          <div class="flex flex-col gap-1">
            <AlertDialogTitle>Can't undo the last commit</AlertDialogTitle>
            <AlertDialogDescription>
              {props.undo._tag === "Unavailable" ? props.undo.reason : ""}
            </AlertDialogDescription>
          </div>
          <div class="flex justify-end">
            <Button onClick={props.onClose}>Close</Button>
          </div>
        </>
      }
    >
      {(commit) => (
        <>
          <div class="flex flex-col gap-1">
            <AlertDialogTitle>Undo “{commit().subject}”?</AlertDialogTitle>
            <AlertDialogDescription>
              <Prose
                text={`Moves ${commit().branch} back to ${shortOid(commit().parent)}. The commit's changes stay staged, along with anything already staged, and unstaged edits stay as they are. A backup shows up in Recover commits. If you already pushed it, the remote keeps it.`}
              />
            </AlertDialogDescription>
          </div>
          <Show when={error()}>{(message) => <Alert tone="error">{message()}</Alert>}</Show>
          <div class="flex justify-end gap-1.5">
            <Button disabled={pending()} onClick={props.onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={pending()} onClick={() => void undo(commit())}>
              Undo commit
            </Button>
          </div>
        </>
      )}
    </Show>
  )
}

function UndoDialog() {
  const recovery = createRecovery()
  useCommand("repo.undoCommit", recovery.open)
  return (
    <AlertDialog open={recovery.isOpen()} onOpenChange={(open) => !open && recovery.close()}>
      <AlertDialogBackdrop />
      <AlertDialogContent>
        <Loading fallback={<Pending />}>
          <Show when={recovery.loaded()} keyed>
            {(result) =>
              result.ok ? (
                <UndoBody undo={result.recovery.undo} onClose={recovery.close} />
              ) : (
                <>
                  <AlertDialogTitle>Can't undo the last commit</AlertDialogTitle>
                  <Alert tone="error">{result.message}</Alert>
                  <div class="flex justify-end">
                    <Button onClick={recovery.close}>Close</Button>
                  </div>
                </>
              )
            }
          </Show>
        </Loading>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function CommitRecovery() {
  return (
    <>
      <RecoveryDialog />
      <UndoDialog />
    </>
  )
}
