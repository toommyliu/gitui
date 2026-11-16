import type { Refs } from "@gitui/contracts"
import { Checkbox, CheckboxGroup, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { createSignal, For, Show, untrack } from "solid-js"
import { shortOid } from "@/lib/format"
import { Button, type Failure } from "../ui"
import { Actions, FailureAlert, SelectField } from "./form"
import type { Outcome } from "@/lib/repo"
import { pushUrls } from "./push-to"

const tagCount = (count: number) => (count === 1 ? "1 tag" : `${count} tags`)

export function PushTagsDialog(props: {
  refs: Refs
  initial?: ReadonlyArray<string> | undefined
  pending: boolean
  onPush: (remote: string, tags: ReadonlyArray<string>) => Promise<Outcome>
  onClose: () => void
}) {
  const names = () => props.refs.tags.map((tag) => tag.name)
  const [chosen, setChosen] = createSignal<ReadonlyArray<string>>(untrack(() => props.initial ?? names()))
  const [remote, setRemote] = createSignal<string | null>(
    untrack(() => (props.refs.remotes.length === 1 ? (props.refs.remotes[0]?.name ?? null) : null)),
  )
  const [submitted, setSubmitted] = createSignal(false)
  const [failure, setFailure] = createSignal<Failure | null>(null)

  const selected = () => chosen().filter((name) => names().includes(name))
  const remoteError = () => (submitted() && remote() === null ? "Choose a remote." : null)
  const tagsError = () => (submitted() && selected().length === 0 ? "Choose at least one tag." : null)

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (props.pending) return
    setSubmitted(true)
    setFailure(null)
    const name = remote()
    if (name === null || selected().length === 0) return
    const outcome = await props.onPush(name, selected())
    if (!outcome.ok) setFailure({ title: "Couldn't push tags", message: outcome.message })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !props.pending && props.onClose()}>
      <DialogBackdrop />
      <DialogContent class="w-[min(26rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <DialogTitle>Push tags</DialogTitle>
          <DialogDescription>Tags that already exist on the remote aren't replaced.</DialogDescription>
        </div>
        <Show
          when={names().length > 0}
          fallback={
            <>
              <p class="text-muted-foreground">This repository has no tags yet.</p>
              <div class="flex justify-end">
                <Button onClick={() => props.onClose()}>Close</Button>
              </div>
            </>
          }
        >
          <form novalidate class="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
            <CheckboxGroup
              aria-label="Tags"
              value={[...selected()]}
              allValues={names()}
              onValueChange={(next) => setChosen(next)}
              class="flex flex-col"
            >
              <label class="flex h-6 items-center gap-2 border-b pb-1 font-medium">
                <Checkbox parent>
                  <CheckboxIndicator />
                </Checkbox>
                All tags
                <span class="ms-auto text-2xs font-normal text-muted-foreground tabular-nums">
                  {selected().length} of {names().length}
                </span>
              </label>
              <div class="max-h-[min(15rem,40dvh)] overflow-y-auto overscroll-none pt-1">
                <For each={props.refs.tags}>
                  {(tag) => (
                    <label class="flex h-6 items-center gap-2 rounded px-0 hover:bg-muted">
                      <Checkbox value={tag.name}>
                        <CheckboxIndicator />
                      </Checkbox>
                      <span class="min-w-0 flex-1 truncate font-mono">{tag.name}</span>
                      <span class="shrink-0 font-mono text-2xs text-muted-foreground">{shortOid(tag.oid)}</span>
                    </label>
                  )}
                </For>
              </div>
            </CheckboxGroup>
            <Show when={tagsError()}>{(error) => <p class="text-2xs text-destructive">{error()}</p>}</Show>
            <SelectField
              label="Remote"
              placeholder="Choose a remote"
              value={remote()}
              error={remoteError()}
              options={props.refs.remotes.map((candidate) => ({
                value: candidate.name,
                label: candidate.name,
                detail: pushUrls(candidate).join(", "),
              }))}
              onChange={(next) => setRemote(next)}
            />
            <FailureAlert failure={failure()} onDismiss={() => setFailure(null)} />
            <Actions
              pending={props.pending}
              submitLabel={selected().length === 0 ? "Push tags" : `Push ${tagCount(selected().length)}`}
              onCancel={() => props.onClose()}
            />
          </form>
        </Show>
      </DialogContent>
    </Dialog>
  )
}
