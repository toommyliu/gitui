import { Checkbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { Input } from "@ui-sdk/solid/input"
import { createSignal, Show } from "solid-js"
import { useRepo } from "@/lib/repo"
import { Button, type ButtonVariant, Alert } from "../ui"
import { createRunner } from "./runner"

export function StashButton(props: { changes: number; variant: ButtonVariant }) {
  const repo = useRepo()
  const { running, run, failure, dismiss } = createRunner()
  const [open, setOpen] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [includeUntracked, setIncludeUntracked] = createSignal(true)

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const text = message().trim()
    const untracked = includeUntracked()
    const done = await run({
      scopes: ["refs", "worktree", "index"],
      request: (git) =>
        git.StashPush({ repo: repo.id, message: text, includeUntracked: untracked, paths: null, keepIndex: false }),
      failure: "Couldn't stash",
    })
    if (done) setOpen(false)
  }

  return (
    <>
      <Button
        variant={props.variant}
        disabled={props.changes === 0}
        onClick={() => {
          setMessage("")
          setOpen(true)
        }}
      >
        Stash changes…
      </Button>
      <Dialog open={open()} onOpenChange={(next) => !running() && setOpen(next)}>
        <DialogBackdrop />
        <DialogContent>
          <div class="flex flex-col gap-1">
            <DialogTitle>Stash changes</DialogTitle>
            <DialogDescription>
              Sets {props.changes === 1 ? "1 changed file" : `${props.changes} changed files`} aside and resets the
              working tree to HEAD.
            </DialogDescription>
          </div>
          <form class="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
            <Input
              autofocus
              aria-label="Stash message"
              placeholder="Message (optional)"
              value={message()}
              onValueChange={(value) => setMessage(value)}
            />
            <label class="flex items-center gap-2">
              <Checkbox
                checked={includeUntracked()}
                onCheckedChange={(checked) => setIncludeUntracked(checked === true)}
              >
                <CheckboxIndicator />
              </Checkbox>
              Include untracked files
            </label>
            <Show when={failure()}>
              {(current) => (
                <Alert tone="error" title={current().title} onDismiss={dismiss} class="pe-7">
                  {current().message}
                </Alert>
              )}
            </Show>
            <div class="flex justify-end gap-1.5">
              <Button disabled={running()} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={running()}>
                Stash
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
