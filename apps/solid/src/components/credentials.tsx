import type { CredentialPrompt, RepoId } from "@gitui/contracts"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { Field, FieldLabel } from "@ui-sdk/solid/field"
import { Input } from "@ui-sdk/solid/input"
import * as Redacted from "effect/Redacted"
import { createEffect, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js"
import { basename } from "@/lib/format"
import { call, describeError, subscribe } from "@/lib/rpc"
import { paths, workspaceFor } from "@/lib/workspaces"
import { Alert, Button } from "./ui"

interface Pending {
  readonly repo: RepoId
  readonly path: string
  readonly prompt: CredentialPrompt
}

interface RepoPrompts {
  readonly repo: RepoId
  readonly prompts: ReadonlyArray<CredentialPrompt>
}

function Watch(props: { path: string; onPrompts: (path: string, prompts: RepoPrompts) => void }) {
  const workspace = workspaceFor(props.path)
  createEffect(
    () => workspace.info().id,
    (repo) =>
      subscribe(
        (git) => git.CredentialPrompts({ repo }),
        (prompts) => props.onPrompts(props.path, { repo, prompts }),
      ),
  )
  return null
}

function PromptDialog(props: { pending: Pending; queued: number; onAnswered: () => void }) {
  const [value, setValue] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [failure, setFailure] = createSignal<string | null>(null)
  const prompt = () => props.pending.prompt

  const answer = async (text: string | null) => {
    if (sending()) return
    if (text === null || prompt().secret) setValue("")
    setSending(true)
    setFailure(null)
    try {
      await call((git) =>
        git.AnswerCredentialPrompt({
          repo: props.pending.repo,
          id: prompt().id,
          answer: text === null ? null : Redacted.make(text),
        }),
      )
      props.onAnswered()
    } catch (error) {
      setFailure(describeError(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void answer(null)} closeOnOutsidePress={false}>
      <DialogBackdrop />
      <DialogContent>
        <div class="flex flex-col gap-1">
          <DialogTitle>Git needs a response</DialogTitle>
          <DialogDescription>
            A command in <span class="font-medium text-foreground">{basename(props.pending.path)}</span> is waiting.
            Your answer goes only to that command and isn't saved.
          </DialogDescription>
        </div>
        <form
          class="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void answer(value())
          }}
        >
          <Field>
            <FieldLabel class="break-words whitespace-pre-line">{prompt().message.trim()}</FieldLabel>
            <Input
              autofocus
              type={prompt().secret ? "password" : "text"}
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              readonly={sending()}
              value={value()}
              onValueChange={(next) => setValue(next)}
              class="font-mono"
            />
          </Field>
          <Show when={failure()}>
            {(message) => (
              <Alert tone="error" title="Couldn't send your answer">
                {message()}
                {prompt().secret ? " Enter it again to retry." : " Try again."}
              </Alert>
            )}
          </Show>
          <div class="flex items-center gap-1.5">
            <span class="min-w-0 flex-1 text-muted-foreground">
              <Show when={props.queued > 0}>
                {props.queued === 1 ? "1 more request waiting" : `${props.queued} more requests waiting`}
              </Show>
            </span>
            <Button disabled={sending()} onClick={() => void answer(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={sending()}>
              Submit
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CredentialPrompts() {
  const [byPath, setByPath] = createSignal<ReadonlyMap<string, RepoPrompts>>(new Map())
  const [answered, setAnswered] = createSignal<ReadonlySet<string>>(new Set())

  const waiting = createMemo(() =>
    paths().flatMap((path) => {
      const entry = byPath().get(path)
      return entry === undefined
        ? []
        : entry.prompts
            .filter((prompt) => !answered().has(prompt.id))
            .map((prompt): Pending => ({ repo: entry.repo, path, prompt }))
    }),
  )

  const current = createMemo((): Pending | undefined => waiting()[0], {
    equals: (previous, next) => previous?.prompt.id === next?.prompt.id,
  })

  return (
    <>
      <For each={paths()}>
        {(path) => (
          <Errored fallback={null}>
            <Loading>
              <Watch path={path} onPrompts={(key, next) => setByPath((current) => new Map(current).set(key, next))} />
            </Loading>
          </Errored>
        )}
      </For>
      <Show when={current()} keyed>
        {(pending) => (
          <PromptDialog
            pending={pending}
            queued={waiting().length - 1}
            onAnswered={() => setAnswered((current) => new Set(current).add(pending.prompt.id))}
          />
        )}
      </Show>
    </>
  )
}
