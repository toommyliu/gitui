import type { FileIdentity, RepoPath } from "@gitui/contracts"
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/solid/alert-dialog"
import { createMemo, createSignal, Errored, Loading, Match, Show, Switch } from "solid-js"
import { basename, shortOid } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import { Spinner } from "../state"
import { Alert, Button } from "../ui"
import { Prose } from "../commit-mention"

function RestoreForm(props: {
  source: FileIdentity
  destination: RepoPath
  onClose: () => void
  onRestored: () => void
}) {
  const repo = useRepo()
  const [error, setError] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal(false)
  const preview = createMemo(() => {
    const source = { revision: props.source.revision, path: props.source.path }
    const destination = props.destination
    repo.track("worktree", "index")
    return call((git) => git.PreviewFileRestore({ repo: repo.id, source, destination }))
  })

  const restore = async () => {
    const { source, destination, version, overwrite } = preview()
    setPending(true)
    setError(null)
    try {
      await repo.mutate(["worktree"], (git) =>
        git.RestoreFile({ repo: repo.id, source, destination, expectedVersion: version, overwrite }),
      )
      props.onRestored()
      props.onClose()
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div class="flex flex-col gap-1">
        <AlertDialogTitle>
          <Prose text={`Restore ${basename(props.source.path)} from ${shortOid(props.source.revision)}?`} />
        </AlertDialogTitle>
        <AlertDialogDescription>
          Writes this version into your working tree. The index isn't touched, so anything staged stays staged.
        </AlertDialogDescription>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 select-text">
        <dt class="text-muted-foreground">From</dt>
        <dd class="min-w-0 font-mono break-all">
          {props.source.path}{" "}
          <span class="text-muted-foreground">
            at <Prose text={shortOid(props.source.revision)} />
          </span>
        </dd>
        <dt class="text-muted-foreground">To</dt>
        <dd class="min-w-0 font-mono break-all">{props.destination}</dd>
      </dl>
      <Errored
        fallback={(failure) => <Alert tone="error">Couldn't check the destination. {describeError(failure())}</Alert>}
      >
        <Loading
          fallback={
            <p role="status" class="flex items-center gap-2 text-muted-foreground">
              <Spinner />
              Checking {props.destination}…
            </p>
          }
        >
          <Switch>
            <Match when={preview().unavailable}>
              {(reason) => (
                <Alert tone="info" title="This version can't be restored">
                  {reason()}
                </Alert>
              )}
            </Match>
            <Match when={preview().overwrite}>
              <Alert tone="warning" title="Your local changes will be lost">
                {props.destination} has changes in the working tree. Restoring replaces them.
              </Alert>
            </Match>
          </Switch>
          <Show when={error()}>{(message) => <Alert tone="error">{message()}</Alert>}</Show>
          <div class="flex justify-end gap-1.5">
            <Button disabled={pending()} onClick={() => props.onClose()}>
              Cancel
            </Button>
            <Button
              variant={preview().overwrite ? "destructive" : "primary"}
              disabled={pending() || preview().unavailable !== null}
              onClick={() => void restore()}
            >
              {preview().overwrite ? "Overwrite and restore" : "Restore"}
            </Button>
          </div>
        </Loading>
      </Errored>
    </>
  )
}

export function RestoreDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: FileIdentity
  destination: RepoPath
  onRestored: () => void
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <AlertDialogBackdrop />
      <AlertDialogContent class="w-[min(28rem,calc(100%-2rem))]">
        <Show when={props.open}>
          <RestoreForm
            source={props.source}
            destination={props.destination}
            onClose={() => props.onOpenChange(false)}
            onRestored={props.onRestored}
          />
        </Show>
      </AlertDialogContent>
    </AlertDialog>
  )
}
