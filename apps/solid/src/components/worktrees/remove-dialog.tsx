import type { Worktree } from "@gitui/contracts"
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/solid/alert-dialog"
import { Checkbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { createMemo, createSignal, Errored, Loading, Show, untrack } from "solid-js"
import { basename } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import { forgetRepo } from "@/lib/workspaces"
import { Spinner } from "../state"
import { Alert, Button } from "../ui"

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`

function RemoveForm(props: { worktree: Worktree; deleteBranch: boolean; onClose: () => void }) {
  const repo = useRepo()
  const [deleteBranch, setDeleteBranch] = createSignal(untrack(() => props.deleteBranch))
  const [error, setError] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal(false)
  const branch = () => (props.worktree.head._tag === "Branch" ? props.worktree.head.name : null)
  const missing = () => props.worktree.prunable !== null

  const summary = createMemo(() => {
    const path = props.worktree.path
    if (props.worktree.prunable !== null) return Promise.resolve({ changes: 0, commits: 0 })
    return call((git) => git.GetWorktreeSummaries({ repo: repo.id })).then((summaries) => {
      const found = summaries.find((candidate) => candidate.path === path)
      return { changes: found?.changes ?? 0, commits: found?.commits ?? 0 }
    })
  })

  const losesWork = () => summary().changes > 0 || (deleteBranch() && summary().commits > 0)
  const withBranch = () => deleteBranch() && branch() !== null

  const remove = async () => {
    const path = props.worktree.path
    const name = branch()
    const alsoBranch = withBranch()
    const force = props.worktree.locked !== null || losesWork()
    setPending(true)
    setError(null)
    try {
      if (missing()) {
        await repo.mutate(["refs"], (git) => git.PruneWorktrees({ repo: repo.id }))
        if (alsoBranch && name !== null)
          await repo.mutate(["refs"], (git) => git.DeleteBranch({ repo: repo.id, name, force, removeWorktree: false }))
      } else
        await repo.mutate(["refs"], (git) =>
          git.RemoveWorktree({ repo: repo.id, path, force, deleteBranch: alsoBranch }),
        )
      forgetRepo(path)
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
        <AlertDialogTitle>Remove {basename(props.worktree.path)}?</AlertDialogTitle>
        <AlertDialogDescription>
          {missing()
            ? "Its folder is already gone. This removes the stale entry from the repository."
            : "This deletes the worktree's folder. The repository and its other worktrees stay."}
        </AlertDialogDescription>
        <p class="font-mono text-2xs break-all text-muted-foreground select-text">{props.worktree.path}</p>
      </div>
      <Show when={branch()}>
        {(name) => (
          <label class="flex items-center gap-2">
            <Checkbox checked={deleteBranch()} onCheckedChange={(checked) => setDeleteBranch(checked === true)}>
              <CheckboxIndicator />
            </Checkbox>
            <span class="min-w-0">
              Also delete branch <span class="font-mono break-all">{name()}</span>
            </span>
          </label>
        )}
      </Show>
      <Errored
        fallback={(failure) => <Alert tone="error">Couldn't check this worktree. {describeError(failure())}</Alert>}
      >
        <Loading
          fallback={
            <p role="status" class="flex items-center gap-2 text-muted-foreground">
              <Spinner />
              Checking for changes…
            </p>
          }
        >
          <Show when={props.worktree.locked !== null}>
            <Alert tone="warning" title="This worktree is locked">
              {props.worktree.locked || "Removing it overrides the lock."}
            </Alert>
          </Show>
          <Show when={summary().changes > 0}>
            <Alert tone="warning" title={`${plural(summary().changes, "uncommitted change")} will be lost`}>
              Removing deletes them, along with any untracked files in the folder.
            </Alert>
          </Show>
          <Show when={deleteBranch() && summary().commits > 0}>
            <Alert tone="warning" title={`${plural(summary().commits, "commit")} will be lost`}>
              {branch()} has commits that the base branch doesn't. Deleting the branch leaves them reachable only from
              the reflog.
            </Alert>
          </Show>
          <Show when={error()}>{(message) => <Alert tone="error">{message()}</Alert>}</Show>
          <div class="flex justify-end gap-1.5">
            <Button disabled={pending()} onClick={() => props.onClose()}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending()} onClick={() => void remove()}>
              {losesWork()
                ? withBranch()
                  ? "Discard and delete branch"
                  : "Discard and remove"
                : withBranch()
                  ? "Remove and delete branch"
                  : "Remove"}
            </Button>
          </div>
        </Loading>
      </Errored>
    </>
  )
}

export function RemoveWorktreeDialog(props: {
  worktree: Worktree
  open: boolean
  onOpenChange: (open: boolean) => void
  deleteBranch?: boolean | undefined
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <AlertDialogBackdrop />
      <AlertDialogContent class="w-[min(26rem,calc(100%-2rem))]">
        <Show when={props.open}>
          <RemoveForm
            worktree={props.worktree}
            deleteBranch={props.deleteBranch ?? false}
            onClose={() => props.onOpenChange(false)}
          />
        </Show>
      </AlertDialogContent>
    </AlertDialog>
  )
}
