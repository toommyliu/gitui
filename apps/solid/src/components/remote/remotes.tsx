import type { Remote } from "@gitui/contracts"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { Input } from "@ui-sdk/solid/input"
import { Textarea } from "@ui-sdk/solid/textarea"
import { createSignal, For, Match, Show, Switch, untrack } from "solid-js"
import { useCommand } from "@/lib/hotkeys"
import { useRepo } from "@/lib/repo"
import { createRunner } from "../refs/runner"
import { Button } from "../ui"
import { Actions, FailureAlert, FormField } from "./form"
import { pushUrls } from "./push-to"

type View =
  | { readonly kind: "list" }
  | { readonly kind: "edit"; readonly remote: Remote | null }
  | { readonly kind: "remove"; readonly remote: Remote }

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")

const inputClass = "aria-invalid:border-destructive"

export function RemotesDialog() {
  const repo = useRepo()
  const [open, setOpen] = createSignal(false)
  const [view, setView] = createSignal<View>({ kind: "list" })
  const runner = createRunner()
  const show = (next: View) => {
    runner.dismiss()
    setView(next)
  }

  const editing = () => {
    const current = view()
    return current.kind === "edit" ? current : null
  }
  const removing = () => {
    const current = view()
    return current.kind === "remove" ? current : null
  }

  useCommand("repo.remotes", () => {
    show({ kind: "list" })
    setOpen(true)
  })

  const remove = async (remote: Remote) => {
    const done = await runner.run({
      scopes: ["refs"],
      request: (git) => git.RemoveRemote({ repo: repo.id, name: remote.name }),
      failure: `Couldn't remove ${remote.name}`,
    })
    if (done) show({ kind: "list" })
  }

  return (
    <Dialog open={open()} onOpenChange={(next) => !runner.running() && setOpen(next)}>
      <DialogBackdrop />
      <DialogContent class="w-[min(32rem,calc(100%-2rem))]">
        <Switch>
          <Match when={view().kind === "list"}>
            <div class="flex flex-col gap-1">
              <DialogTitle>Remotes</DialogTitle>
              <DialogDescription>Where this repository fetches from and pushes to.</DialogDescription>
            </div>
            <Show
              when={repo.refs().remotes.length > 0}
              fallback={<p class="text-muted-foreground">No remotes yet. Add one to fetch and push.</p>}
            >
              <ul class="-mx-1 flex max-h-[min(24rem,55dvh)] flex-col overflow-y-auto overscroll-none">
                <For each={repo.refs().remotes}>
                  {(remote) => (
                    <li class="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-muted/60">
                      <div class="flex min-w-0 flex-1 flex-col">
                        <span class="flex h-6 items-center font-medium">{remote.name}</span>
                        <dl class="grid grid-cols-[auto_1fr] gap-x-2 text-2xs">
                          <dt class="text-muted-foreground">Fetch</dt>
                          <dd class="min-w-0 font-mono break-all whitespace-pre-line">{remote.urls.join("\n")}</dd>
                          <dt class="text-muted-foreground">Push</dt>
                          <dd class="min-w-0 font-mono break-all whitespace-pre-line">{pushUrls(remote).join("\n")}</dd>
                        </dl>
                      </div>
                      <div class="flex shrink-0 items-center gap-0.5">
                        <Button
                          variant="ghost"
                          aria-label={`Edit ${remote.name}`}
                          onClick={() => show({ kind: "edit", remote })}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          aria-label={`Remove ${remote.name}`}
                          onClick={() => show({ kind: "remove", remote })}
                        >
                          Remove…
                        </Button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <div class="flex justify-end gap-1.5 border-t pt-3">
              <Button onClick={() => setOpen(false)}>Close</Button>
              <Button variant="primary" onClick={() => show({ kind: "edit", remote: null })}>
                Add remote
              </Button>
            </div>
          </Match>
          <Match when={editing()} keyed>
            {(current) => (
              <RemoteForm
                remote={current.remote}
                taken={repo.refs().remotes.map((remote) => remote.name)}
                runner={runner}
                onDone={() => show({ kind: "list" })}
              />
            )}
          </Match>
          <Match when={removing()} keyed>
            {(current) => (
              <form
                class="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void remove(current.remote)
                }}
              >
                <div class="flex flex-col gap-1">
                  <DialogTitle>Remove {current.remote.name}?</DialogTitle>
                  <DialogDescription>
                    Removes its settings and remote-tracking branches from this repository. Branches on the server stay
                    where they are.
                  </DialogDescription>
                </div>
                <FailureAlert failure={runner.failure()} onDismiss={runner.dismiss} />
                <Actions
                  pending={runner.running()}
                  submitLabel="Remove remote"
                  variant="destructive"
                  onCancel={() => show({ kind: "list" })}
                />
              </form>
            )}
          </Match>
        </Switch>
      </DialogContent>
    </Dialog>
  )
}

function RemoteForm(props: {
  remote: Remote | null
  taken: ReadonlyArray<string>
  runner: ReturnType<typeof createRunner>
  onDone: () => void
}) {
  const repo = useRepo()
  const initial = untrack(() => props.remote)
  const [name, setName] = createSignal(initial?.name ?? (untrack(() => props.taken.length) === 0 ? "origin" : ""))
  const [urls, setUrls] = createSignal(initial?.urls.join("\n") ?? "")
  const [pushes, setPushes] = createSignal(initial?.pushUrls.join("\n") ?? "")
  const [submitted, setSubmitted] = createSignal(false)

  const nameProblem = () => {
    const trimmed = name().trim()
    if (trimmed === "") return "Enter a name."
    if (/\s/.test(trimmed)) return "Use a name without spaces."
    if (trimmed.startsWith("-")) return "Use a name that doesn't start with a hyphen."
    if (trimmed !== initial?.name && props.taken.includes(trimmed)) return `A remote named ${trimmed} already exists.`
    return null
  }
  const urlsProblem = () => (lines(urls()).length === 0 ? "Enter at least one fetch URL." : null)
  const nameError = () => (submitted() ? nameProblem() : null)
  const urlsError = () => (submitted() ? urlsProblem() : null)

  const submit = async (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    event.preventDefault()
    if (props.runner.running()) return
    setSubmitted(true)
    props.runner.dismiss()
    if (nameProblem() !== null || urlsProblem() !== null) {
      const control = event.currentTarget.elements.namedItem(nameProblem() === null ? "urls" : "name")
      if (control instanceof HTMLElement) control.focus()
      return
    }
    const next: Remote = { name: name().trim(), urls: lines(urls()), pushUrls: lines(pushes()) }
    const done = await props.runner.run({
      scopes: ["refs"],
      request: (git) =>
        initial === null
          ? git.AddRemote({ repo: repo.id, remote: next })
          : git.EditRemote({ repo: repo.id, name: initial.name, remote: next }),
      failure: initial === null ? "Couldn't add the remote" : `Couldn't save ${initial.name}`,
    })
    if (done) props.onDone()
  }

  return (
    <form novalidate class="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <div class="flex flex-col gap-1">
        <DialogTitle>{initial === null ? "Add remote" : `Edit ${initial.name}`}</DialogTitle>
        <DialogDescription>
          Put each URL on its own line. Leave push URLs empty to push to the fetch URLs.
        </DialogDescription>
      </div>
      <FormField label="Name" error={nameError()}>
        <Input
          name="name"
          autofocus
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          value={name()}
          onValueChange={(value) => setName(value)}
          class={inputClass}
        />
      </FormField>
      <FormField label="Fetch URLs" error={urlsError()}>
        <Textarea
          name="urls"
          rows={2}
          spellcheck={false}
          placeholder="git@github.com:owner/repository.git"
          value={urls()}
          onValueChange={(value) => setUrls(value)}
          class={["resize-none font-mono", inputClass]}
        />
      </FormField>
      <FormField label="Push URLs" source="Optional">
        <Textarea
          rows={2}
          spellcheck={false}
          value={pushes()}
          onValueChange={(value) => setPushes(value)}
          class="resize-none font-mono"
        />
      </FormField>
      <FailureAlert failure={props.runner.failure()} onDismiss={props.runner.dismiss} />
      <Actions
        pending={props.runner.running()}
        submitLabel={initial === null ? "Add remote" : "Save remote"}
        onCancel={props.onDone}
        cancelLabel="Back"
      />
    </form>
  )
}
