import type { Branch } from "@gitui/contracts"
import type { JSX } from "@solidjs/web"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { Field, FieldLabel } from "@ui-sdk/solid/field"
import { Input } from "@ui-sdk/solid/input"
import { createSignal, Show, untrack } from "solid-js"
import { useRepo } from "@/lib/repo"
import { describeError } from "@/lib/rpc"
import { SelectField } from "../remote/form"
import { Alert, Button } from "../ui"

function BranchDialog(props: {
  title: string
  description: string
  submitLabel: string
  pending: boolean
  error: string | null
  disabled: boolean
  onSubmit: () => void
  onClose: () => void
  children: JSX.Element
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !props.pending && props.onClose()}>
      <DialogBackdrop />
      <DialogContent class="w-[min(26rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </div>
        <form
          class="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!props.pending && !props.disabled) props.onSubmit()
          }}
        >
          {props.children}
          <Show when={props.error}>{(message) => <Alert tone="error">{message()}</Alert>}</Show>
          <div class="flex justify-end gap-1.5">
            <Button disabled={props.pending} onClick={() => props.onClose()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={props.pending || props.disabled}>
              {props.submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const createSubmit = () => {
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const submit = async (work: () => Promise<unknown>, done: () => void) => {
    setPending(true)
    setError(null)
    try {
      await work()
      done()
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setPending(false)
    }
  }
  return { pending, error, setError, submit }
}

export function RenameBranchDialog(props: { branch: Branch; onRenamed: (name: string) => void; onClose: () => void }) {
  const repo = useRepo()
  const [name, setName] = createSignal(untrack(() => props.branch.name))
  const { pending, error, setError, submit } = createSubmit()
  const next = () => name().trim()
  const taken = () =>
    next() !== props.branch.name && repo.refs().branches.some((candidate) => candidate.name === next())

  const rename = () => {
    const from = props.branch.name
    const to = next()
    if (to === from) return props.onClose()
    if (taken()) return setError(`${to} already exists.`)
    void submit(
      () => repo.mutate(["refs"], (git) => git.RenameBranch({ repo: repo.id, from, to })),
      () => props.onRenamed(to),
    )
  }

  return (
    <BranchDialog
      title={`Rename ${props.branch.name}`}
      description="Its upstream and any worktree that has it checked out follow the new name."
      submitLabel="Rename"
      pending={pending()}
      error={error()}
      disabled={next() === ""}
      onSubmit={rename}
      onClose={props.onClose}
    >
      <Field>
        <FieldLabel>New name</FieldLabel>
        <Input
          autofocus
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          value={name()}
          onValueChange={(value) => {
            setName(value)
            setError(null)
          }}
          class="font-mono"
        />
      </Field>
    </BranchDialog>
  )
}

const NONE = "none"

export function UpstreamDialog(props: { branch: Branch; onClose: () => void }) {
  const repo = useRepo()
  const initial = untrack(() => props.branch.upstream?.ref ?? NONE)
  const [upstream, setUpstream] = createSignal(initial)
  const { pending, error, submit } = createSubmit()

  const options = () => {
    const current = props.branch.upstream
    const refs = repo.refs()
    return [
      { value: NONE, label: "No upstream" },
      ...(current?._tag === "Gone" ? [{ value: current.ref, label: current.name, detail: "gone" }] : []),
      ...refs.remoteBranches
        .filter((remote) => !remote.name.endsWith("/HEAD"))
        .map((remote) => ({ value: `refs/remotes/${remote.name}`, label: remote.name })),
      ...refs.branches
        .filter((local) => local.name !== props.branch.name)
        .map((local) => ({ value: `refs/heads/${local.name}`, label: local.name, detail: "local" })),
    ]
  }

  const save = () => {
    const chosen = upstream()
    if (chosen === initial) return props.onClose()
    const branch = props.branch.name
    void submit(
      () =>
        repo.mutate(["refs"], (git) =>
          git.SetUpstream({ repo: repo.id, branch, upstream: chosen === NONE ? null : chosen }),
        ),
      props.onClose,
    )
  }

  return (
    <BranchDialog
      title={`Change upstream for ${props.branch.name}`}
      description="Pull and the ahead and behind counts use this branch. Fetch first if the branch you need is missing."
      submitLabel="Save upstream"
      pending={pending()}
      error={error()}
      disabled={false}
      onSubmit={save}
      onClose={props.onClose}
    >
      <SelectField label="Upstream branch" value={upstream()} options={options()} onChange={setUpstream} />
    </BranchDialog>
  )
}
