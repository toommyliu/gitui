import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Exit from "effect/Exit"
import * as Redacted from "effect/Redacted"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { answerPromptAtom, type PendingPrompt, pendingKey, pendingPromptsAtom, promptPathsKey } from "@/lib/credentials"
import { basename } from "@/lib/format"
import { describeFailure } from "@/lib/git"

export function CredentialPrompts({ paths }: { paths: ReadonlyArray<string> }) {
  const pending = useAtomValue(pendingPromptsAtom(promptPathsKey(paths)))
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set())
  const live = new Set(pending.map(pendingKey))
  if ([...answered].some((key) => !live.has(key))) setAnswered(new Set([...answered].filter((key) => live.has(key))))
  const waiting = pending.filter((prompt) => !answered.has(pendingKey(prompt)))
  const current = waiting[0]
  if (current === undefined) return null
  const key = pendingKey(current)
  return (
    <PromptDialog
      key={key}
      pending={current}
      queued={waiting.length - 1}
      onAnswered={() => setAnswered((all) => new Set(all).add(key))}
    />
  )
}

type Sending =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Sending" }
  | { readonly _tag: "Failed"; readonly error: string }

function PromptDialog({
  pending,
  queued,
  onAnswered,
}: {
  pending: PendingPrompt
  queued: number
  onAnswered: () => void
}) {
  const id = useId()
  const { prompt } = pending
  const [value, setValue] = useState("")
  const [sending, setSending] = useState<Sending>({ _tag: "Idle" })
  const answer = useAtomSet(answerPromptAtom, { mode: "promiseExit" })
  const busy = sending._tag === "Sending"
  const cancel = () => {
    if (busy) return
    setValue("")
    setSending({ _tag: "Sending" })
    void answer({ repo: pending.repo, id: prompt.id, answer: null }).then((exit) => {
      if (Exit.isSuccess(exit)) onAnswered()
      else setSending({ _tag: "Failed", error: describeFailure(exit.cause) })
    })
  }
  const submit = () => {
    if (busy) return
    if (prompt.secret) setValue("")
    setSending({ _tag: "Sending" })
    void answer({ repo: pending.repo, id: prompt.id, answer: Redacted.make(value) }).then((exit) => {
      if (Exit.isSuccess(exit)) onAnswered()
      else setSending({ _tag: "Failed", error: describeFailure(exit.cause) })
    })
  }
  const errorId = `${id}-error`

  return (
    <Dialog open disablePointerDismissal onOpenChange={(open) => open || busy || cancel()}>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Git needs a response</DialogTitle>
            <DialogDescription render={<div />}>
              <p>
                A command in <span className="font-medium text-foreground">{basename(pending.path)}</span> is waiting.
                Your response goes only to that command and isn't saved.
              </p>
              <p className="font-mono break-all">{pending.path}</p>
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={sending._tag === "Failed"}>
            <FieldLabel htmlFor={`${id}-answer`} className="break-words whitespace-pre-line">
              {prompt.message.trim()}
            </FieldLabel>
            <Input
              id={`${id}-answer`}
              type={prompt.secret ? "password" : "text"}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              readOnly={busy}
              value={value}
              aria-invalid={sending._tag === "Failed"}
              aria-describedby={sending._tag === "Failed" ? errorId : undefined}
              onChange={(event) => setValue(event.target.value)}
              className="font-mono"
            />
            {sending._tag === "Failed" && (
              <FieldError id={errorId} role="alert" className="whitespace-pre-line">
                Unable to send your response. {sending.error}
                {prompt.secret ? " Enter it again to retry." : " Try again."}
              </FieldError>
            )}
          </Field>
          {queued > 0 && (
            <p className="text-muted-foreground">
              {queued === 1 ? "1 more request is waiting." : `${queued} more requests are waiting.`}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
