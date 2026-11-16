import type { PushContext, PushDestination, Refs, Remote } from "@gitui/contracts"
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@ui-sdk/solid/autocomplete"
import { Checkbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { createSignal, For, Show, untrack } from "solid-js"
import type { Failure } from "../ui"
import { Actions, FailureAlert, FormField, SelectField } from "./form"
import type { Outcome } from "@/lib/repo"

export const pushUrls = (remote: Remote) => (remote.pushUrls.length > 0 ? remote.pushUrls : remote.urls)

const upstreamBranch = (context: PushContext) => {
  const { remote, merge } = context.upstream
  const ref =
    merge.length === 1 && context.remotes.some((candidate) => candidate.name === remote) ? merge[0] : undefined
  return ref === undefined ? undefined : /^refs\/heads\/(.+)$/.exec(ref)?.[1]
}

export function PushToDialog(props: {
  context: PushContext
  saved: PushDestination | null
  refs: Refs
  pending: boolean
  onPush: (destination: PushDestination, setUpstream: boolean) => Promise<Outcome>
  onClose: () => void
}) {
  const branch = () => props.context.branch
  const initial = untrack(() => ({
    remote:
      props.saved?.remote ?? (props.context.remotes.length === 1 ? (props.context.remotes[0]?.name ?? null) : null),
    remoteBranch: props.saved?.remoteBranch ?? upstreamBranch(props.context) ?? props.context.branch,
    setUpstream:
      (props.refs.branches.find((candidate) => candidate.name === props.context.branch)?.upstream ?? null) === null,
  }))
  const [remote, setRemote] = createSignal<string | null>(initial.remote)
  const [remoteBranch, setRemoteBranch] = createSignal(initial.remoteBranch)
  const [setUpstream, setSetUpstream] = createSignal(initial.setUpstream)
  const [submitted, setSubmitted] = createSignal(false)
  const [failure, setFailure] = createSignal<Failure | null>(null)

  const remoteProblem = () => {
    const name = remote()
    if (name === null) return "Choose a remote."
    return props.context.remotes.some((candidate) => candidate.name === name) ? null : `${name} no longer exists.`
  }
  const branchProblem = () => (remoteBranch().trim() === "" ? "Enter a branch name." : null)
  const remoteError = () => (submitted() ? remoteProblem() : null)
  const branchError = () => (submitted() ? branchProblem() : null)

  const suggestions = () => {
    const name = remote()
    if (name === null) return []
    const prefix = `${name}/`
    return props.refs.remoteBranches
      .filter((candidate) => candidate.remote === name && candidate.name !== `${prefix}HEAD`)
      .map((candidate) => candidate.name.slice(prefix.length))
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (props.pending) return
    setSubmitted(true)
    setFailure(null)
    const name = remote()
    if (remoteProblem() !== null || branchProblem() !== null || name === null) return
    const outcome = await props.onPush(
      { branch: branch(), remote: name, remoteBranch: remoteBranch().trim() },
      setUpstream(),
    )
    if (!outcome.ok) setFailure({ title: "Push failed", message: outcome.message })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !props.pending && props.onClose()}>
      <DialogBackdrop />
      <DialogContent class="w-[min(26rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <DialogTitle>Push {branch()}</DialogTitle>
          <DialogDescription>
            Push remembers where you send {branch()} and asks again if its upstream or the remote settings change.
          </DialogDescription>
        </div>
        <form novalidate class="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <SelectField
            label="Remote"
            placeholder="Choose a remote"
            value={remote()}
            error={remoteError()}
            options={props.context.remotes.map((candidate) => ({
              value: candidate.name,
              label: candidate.name,
              detail: pushUrls(candidate).join(", "),
            }))}
            onChange={(next) => setRemote(next)}
          />
          <FormField label="Remote branch" error={branchError()}>
            <Autocomplete value={remoteBranch()} onValueChange={(next) => setRemoteBranch(next)}>
              <AutocompleteInput
                autofocus={remote() !== null}
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                class={[
                  "h-7 w-full min-w-0 rounded-md border bg-background px-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring",
                  branchError() === null ? "border-input" : "border-destructive",
                ]}
              />
              <Show when={suggestions().length > 0}>
                <AutocompleteContent
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  class="z-50 max-h-[min(16rem,var(--available-height))] w-(--anchor-width) overflow-y-auto overscroll-none rounded-lg border bg-popover p-1 text-xs text-popover-foreground shadow-lg outline-none"
                >
                  <AutocompleteList>
                    <For each={suggestions()}>
                      {(name) => (
                        <AutocompleteItem
                          value={name}
                          class="flex h-6 items-center rounded px-2 font-mono data-highlighted:bg-selection data-highlighted:text-selection-foreground"
                        >
                          {name}
                        </AutocompleteItem>
                      )}
                    </For>
                  </AutocompleteList>
                </AutocompleteContent>
              </Show>
            </Autocomplete>
          </FormField>
          <label class="flex items-start gap-2">
            <Checkbox
              class="mt-px"
              checked={setUpstream()}
              onCheckedChange={(checked) => setSetUpstream(checked === true)}
            >
              <CheckboxIndicator />
            </Checkbox>
            <span class="flex flex-col gap-0.5">
              Set as upstream
              <span class="text-2xs text-muted-foreground">
                Makes Pull and the ahead and behind counts use{" "}
                {remote() === null ? "the branch you push to" : `${remote()}/${remoteBranch().trim() || branch()}`}.
              </span>
            </span>
          </label>
          <FailureAlert failure={failure()} onDismiss={() => setFailure(null)} />
          <Actions pending={props.pending} submitLabel="Push" onCancel={() => props.onClose()} />
        </form>
      </DialogContent>
    </Dialog>
  )
}
