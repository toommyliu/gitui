import type { Refs } from "@gitui/contracts"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { Field, FieldLabel } from "@ui-sdk/solid/field"
import { Input } from "@ui-sdk/solid/input"
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/solid/segmented-control"
import { createMemo, createSignal, Match, Show, Switch, untrack } from "solid-js"
import type { RefOption } from "@/lib/comparison"
import { basename } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { describeError } from "@/lib/rpc"
import { active, openRepo } from "@/lib/workspaces"
import { RefInput } from "../compare/ref-input"
import { Alert, Button } from "../ui"

type Source = "new" | "existing"

export const siblingPath = (refs: Refs, fallback: string, branch: string) => {
  const main = refs.worktrees.find((worktree) => worktree.isMain)?.path ?? fallback
  return `${main}-${branch.trim().replace(/[^\w.-]+/g, "-")}`
}

function AddForm(props: { branch: string | undefined; onClose: () => void }) {
  const repo = useRepo()
  const preset = untrack(() => props.branch)
  const [source, setSource] = createSignal<Source>(preset === undefined ? "new" : "existing")
  const [newBranch, setNewBranch] = createSignal("")
  const [existing, setExisting] = createSignal(preset ?? "")
  const [typedPath, setTypedPath] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal(false)
  const [added, setAdded] = createSignal<string | null>(null)

  const free = createMemo((): ReadonlyArray<RefOption> => {
    const taken = new Set(
      repo.refs().worktrees.flatMap((worktree) => (worktree.head._tag === "Branch" ? [worktree.head.name] : [])),
    )
    return repo
      .refs()
      .branches.filter((branch) => !taken.has(branch.name))
      .map((branch) => ({ ref: branch.name, label: branch.name, kind: "branch" }))
  })
  const branch = () => (source() === "new" ? newBranch() : existing()).trim()
  const path = () => typedPath() ?? (branch() === "" ? "" : siblingPath(repo.refs(), repo.id, branch()))
  const head = () => {
    const value = repo.status().head
    return value._tag === "Detached" ? value.oid.slice(0, 7) : value.name
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const name = branch()
    const target = path().trim()
    if (name === "") return setError("Enter a branch name.")
    if (source() === "existing" && !free().some((option) => option.label === name))
      return setError(`${name} isn't a local branch that's free to check out.`)
    if (source() === "new" && repo.refs().branches.some((candidate) => candidate.name === name))
      return setError(`${name} already exists. Choose “Existing branch” to check it out.`)
    if (target === "") return setError("Enter a folder for the worktree.")
    setPending(true)
    setError(null)
    try {
      await repo.mutate(["refs"], (git) =>
        git.AddWorktree({ repo: repo.id, path: target, branch: name, startPoint: null }),
      )
      setAdded(target)
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <Show
      when={added()}
      fallback={
        <form class="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <SegmentedControl
            aria-label="Branch"
            value={source()}
            onValueChange={(next: Source | null) => {
              if (next === null) return
              setSource(next)
              setError(null)
            }}
            class="self-start"
          >
            <SegmentedControlItem value="new">New branch</SegmentedControlItem>
            <SegmentedControlItem value="existing">Existing branch</SegmentedControlItem>
          </SegmentedControl>
          <Switch>
            <Match when={source() === "new"}>
              <Field>
                <FieldLabel>Branch name</FieldLabel>
                <Input
                  autofocus
                  spellcheck={false}
                  autocomplete="off"
                  placeholder="feature/name"
                  class="font-mono"
                  value={newBranch()}
                  onValueChange={(value) => setNewBranch(value)}
                />
                <p class="text-2xs text-muted-foreground">Starts from {head()}.</p>
              </Field>
            </Match>
            <Match when={source() === "existing"}>
              <div class="flex flex-col gap-1">
                <RefInput
                  label="Branch"
                  placeholder="Pick a local branch"
                  value={existing()}
                  options={free()}
                  onValueChange={setExisting}
                  autofocus={preset === undefined}
                />
                <Show when={free().length === 0}>
                  <p class="text-2xs text-muted-foreground">Every local branch is already checked out somewhere.</p>
                </Show>
              </div>
            </Match>
          </Switch>
          <Field>
            <FieldLabel>Folder</FieldLabel>
            <Input
              autofocus={preset !== undefined}
              spellcheck={false}
              autocomplete="off"
              placeholder="Next to the main worktree"
              class="font-mono"
              value={path()}
              onValueChange={(value) => setTypedPath(value)}
            />
          </Field>
          <Show when={error()}>{(message) => <Alert tone="error">{message()}</Alert>}</Show>
          <div class="flex justify-end gap-1.5">
            <Button disabled={pending()} onClick={() => props.onClose()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending()}>
              Add worktree
            </Button>
          </div>
        </form>
      }
    >
      {(target) => (
        <div class="flex flex-col gap-3">
          <Alert tone="success" title={`Added ${basename(target())}`}>
            <span class="font-mono break-all select-text">{target()}</span>
          </Alert>
          <div class="flex justify-end gap-1.5">
            <Button onClick={() => props.onClose()}>Done</Button>
            <Button
              variant="primary"
              autofocus
              onClick={() => {
                props.onClose()
                openRepo(target(), active() ?? undefined)
              }}
            >
              Open
            </Button>
          </div>
        </div>
      )}
    </Show>
  )
}

export function AddWorktreeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  branch?: string | undefined
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <DialogBackdrop />
      <DialogContent class="w-[min(28rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <DialogTitle>Add worktree</DialogTitle>
          <DialogDescription>
            Checks out a branch in its own folder, so you can work on it side by side.
          </DialogDescription>
        </div>
        <Show when={props.open}>
          <AddForm branch={props.branch} onClose={() => props.onOpenChange(false)} />
        </Show>
      </DialogContent>
    </Dialog>
  )
}
