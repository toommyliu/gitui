import type { ChangeScope, CommitRow, Oid, RewriteResult } from "@gitui/contracts"
import { Checkbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { Field, FieldLabel } from "@ui-sdk/solid/field"
import { Input } from "@ui-sdk/solid/input"
import { MenuItem, MenuSeparator, MenuShortcut, MenuSub, MenuSubContent, MenuSubTrigger } from "@ui-sdk/solid/menu"
import { Textarea } from "@ui-sdk/solid/textarea"
import type * as Effect from "effect/Effect"
import { createSignal, onSettled, Show } from "solid-js"
import { shortOid } from "@/lib/format"
import { matchesCommand, runCommand, shortcut } from "@/lib/hotkeys"
import { useRepo } from "@/lib/repo"
import { type Client, describeError } from "@/lib/rpc"
import { ChevronRight } from "../icons"
import { Confirm } from "../refs/confirm"
import { Alert, Button, type Tone } from "../ui"
import { RewriteDialog } from "./rewrite-dialog"
import { Prose } from "../commit-mention"

export type CommitRef = Pick<CommitRow, "oid" | "parents">

type ResetMode = "soft" | "mixed" | "hard"

type Dialogs =
  | { readonly kind: "branch"; readonly oid: Oid }
  | { readonly kind: "tag"; readonly oid: Oid }
  | { readonly kind: "hard-reset"; readonly oid: Oid }
  | { readonly kind: "rewrite"; readonly first: Oid }

export interface Outcome {
  readonly tone: Extract<Tone, "success" | "error">
  readonly title: string
  readonly message?: string | undefined
}

const moving: ReadonlyArray<ChangeScope> = ["refs", "worktree", "index"]

export const createCommitActions = () => {
  const repo = useRepo()
  const [dialog, setDialog] = createSignal<Dialogs | null>(null)
  const [outcome, setOutcome] = createSignal<Outcome | null>(null)
  const [running, setRunning] = createSignal(false)

  const head = () => repo.status().head
  const branch = () => {
    const current = head()
    return current._tag === "Branch" ? current.name : null
  }
  const headOid = () => {
    const current = head()
    return current._tag === "Unborn" ? null : current.oid
  }
  const canRewrite = () => branch() !== null && repo.status().operation === null

  const attempt = async <E,>(
    scopes: ReadonlyArray<ChangeScope>,
    request: (git: Client) => Effect.Effect<void, E>,
  ): Promise<string | null> => {
    setRunning(true)
    try {
      await repo.mutate(scopes, request)
      return null
    } catch (error) {
      return describeError(error)
    } finally {
      setRunning(false)
    }
  }

  const run = async <E,>(failure: string, request: (git: Client) => Effect.Effect<void, E>) => {
    setOutcome(null)
    const error = await attempt(moving, request)
    if (error !== null) setOutcome({ tone: "error", title: failure, message: error })
  }

  const reset = (oid: Oid, mode: ResetMode) => {
    if (mode === "hard") return setDialog({ kind: "hard-reset", oid })
    return run(`Couldn't reset ${branch() ?? "HEAD"}`, (git) => git.Reset({ repo: repo.id, oid, mode }))
  }

  return {
    repo,
    dialog,
    setDialog,
    outcome,
    setOutcome,
    running,
    branch,
    headOid,
    canRewrite,
    attempt,
    run,
    reset,
    rewrite: (first: Oid) => setDialog({ kind: "rewrite", first }),
  }
}

export type CommitActions = ReturnType<typeof createCommitActions>

const resetModes: ReadonlyArray<readonly [ResetMode, string, string]> = [
  ["soft", "Soft", "keep changes staged"],
  ["mixed", "Mixed", "keep changes unstaged"],
  ["hard", "Hard", "discard changes…"],
]

const subTrigger =
  "flex h-6 items-center gap-2 rounded px-2 outline-none data-disabled:opacity-50 data-highlighted:bg-selection data-highlighted:text-selection-foreground data-open:bg-selection data-open:text-selection-foreground"

const item = "data-disabled:opacity-50"

export function CommitMenuItems(props: { actions: CommitActions; commit: CommitRef; selected: boolean }) {
  const actions = props.actions
  const oid = () => props.commit.oid
  let copyItem: HTMLElement | undefined
  onSettled(() => {
    const copyOnShortcut = (event: KeyboardEvent) => {
      if (!matchesCommand(event, "history.copySha")) return
      event.preventDefault()
      event.stopPropagation()
      copyItem?.click()
    }
    document.addEventListener("keydown", copyOnShortcut, true)
    return () => document.removeEventListener("keydown", copyOnShortcut, true)
  })
  const short = () => shortOid(oid())
  const merge = () => props.commit.parents.length > 1
  const isHead = () => actions.headOid() === oid()
  const current = () => actions.branch() ?? "HEAD"
  const id = () => actions.repo.id

  return (
    <>
      <MenuItem
        class={item}
        disabled={isHead() || actions.running()}
        onSelect={() =>
          void actions.run("Couldn't check out", (git) => git.CheckoutDetached({ repo: id(), oid: oid() }))
        }
      >
        Check out {short()} (detached)
      </MenuItem>
      <MenuItem class={item} onSelect={() => actions.setDialog({ kind: "branch", oid: oid() })}>
        Create branch here…
      </MenuItem>
      <MenuItem class={item} onSelect={() => actions.setDialog({ kind: "tag", oid: oid() })}>
        Create tag here…
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        class={item}
        disabled={isHead() || merge() || actions.running()}
        onSelect={() => void actions.run("Couldn't cherry-pick", (git) => git.CherryPick({ repo: id(), oid: oid() }))}
      >
        Cherry-pick onto {current()}
      </MenuItem>
      <MenuItem
        class={item}
        disabled={merge() || actions.running()}
        onSelect={() => void actions.run("Couldn't revert", (git) => git.Revert({ repo: id(), oid: oid() }))}
      >
        Revert commit
      </MenuItem>
      <MenuSub>
        <MenuSubTrigger class={subTrigger} disabled={actions.headOid() === null || actions.running()}>
          Reset {current()} to here
          <span class="ms-auto text-muted-foreground">
            <ChevronRight />
          </span>
        </MenuSubTrigger>
        <MenuSubContent class="min-w-56">
          {resetModes.map(([mode, label, hint]) => (
            <MenuItem
              class={mode === "hard" ? "text-destructive" : undefined}
              onSelect={() => void actions.reset(oid(), mode)}
            >
              {label}
              <span class="text-muted-foreground">{hint}</span>
            </MenuItem>
          ))}
        </MenuSubContent>
      </MenuSub>
      <MenuItem class={item} disabled={merge() || !actions.canRewrite()} onSelect={() => actions.rewrite(oid())}>
        Rewrite from here…
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        ref={(element: HTMLElement) => (copyItem = element)}
        onSelect={() => void navigator.clipboard.writeText(oid())}
      >
        Copy hash
        <MenuShortcut>{shortcut("history.copySha")}</MenuShortcut>
      </MenuItem>
    </>
  )
}

function CreateRefDialog(props: { actions: CommitActions; kind: "branch" | "tag"; oid: Oid }) {
  const actions = props.actions
  const [name, setName] = createSignal("")
  const [checkout, setCheckout] = createSignal(true)
  const [message, setMessage] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const noun = () => (props.kind === "branch" ? "branch" : "tag")

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const trimmed = name().trim()
    if (trimmed === "") return
    const oid = props.oid
    const repo = actions.repo.id
    const switching = props.kind === "branch" && checkout()
    const text = message().trim()
    setError(null)
    const failure =
      props.kind === "branch"
        ? await actions.attempt(switching ? moving : ["refs"], (git) =>
            git.CreateBranch({ repo, name: trimmed, startPoint: oid, checkout: switching }),
          )
        : await actions.attempt(["refs"], (git) => git.CreateTag({ repo, name: trimmed, oid, message: text }))
    if (failure !== null) return setError(failure)
    actions.setDialog(null)
    actions.setOutcome(
      switching ? null : { tone: "success", title: `Created ${noun()} ${trimmed} at ${shortOid(oid)}` },
    )
  }

  return (
    <>
      <div class="flex flex-col gap-1">
        <DialogTitle>
          Create {noun()} at <Prose text={shortOid(props.oid)} />
        </DialogTitle>
        <DialogDescription>
          {props.kind === "branch"
            ? "The new branch starts at this commit."
            : "Leave the message empty for a lightweight tag."}
        </DialogDescription>
      </div>
      <form class="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <Field>
          <FieldLabel>{props.kind === "branch" ? "Branch name" : "Tag name"}</FieldLabel>
          <Input
            autofocus
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            value={name()}
            onValueChange={(next) => {
              setName(next)
              setError(null)
            }}
            class="font-mono"
          />
        </Field>
        <Show
          when={props.kind === "branch"}
          fallback={
            <Field>
              <FieldLabel>Message</FieldLabel>
              <Textarea
                value={message()}
                onInput={(event) => setMessage(event.currentTarget.value)}
                placeholder="Optional. Makes an annotated tag."
                class="min-h-16 resize-none leading-relaxed"
              />
            </Field>
          }
        >
          <label class="flex items-center gap-2">
            <Checkbox checked={checkout()} onCheckedChange={(checked) => setCheckout(checked === true)}>
              <CheckboxIndicator />
            </Checkbox>
            Check it out
          </label>
        </Show>
        <Show when={error()}>
          {(message) => (
            <Alert tone="error" title={`Couldn't create the ${noun()}`}>
              {message()}
            </Alert>
          )}
        </Show>
        <div class="flex justify-end gap-1.5">
          <Button disabled={actions.running()} onClick={() => actions.setDialog(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={actions.running() || name().trim() === ""}>
            Create {noun()}
          </Button>
        </div>
      </form>
    </>
  )
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function HardReset(props: { actions: CommitActions; oid: Oid | null }) {
  const actions = props.actions
  const [error, setError] = createSignal<string | null>(null)
  const changed = () =>
    actions.repo.status().entries.filter((entry) => entry._tag === "Tracked" || entry._tag === "Conflicted").length
  const description = () => {
    const target = shortOid(props.oid ?? "")
    const from = actions.headOid()
    const moves = from === null ? "" : `Moves ${actions.branch() ?? "HEAD"} from ${shortOid(from)} to ${target}. `
    const lost =
      changed() === 0
        ? "There are no uncommitted changes to tracked files to lose."
        : `Uncommitted changes to ${plural(changed(), "tracked file", "tracked files")} are lost for good. Untracked files stay.`
    return `${moves}${lost} Commits only ${actions.branch() ?? "HEAD"} had stay findable in Recover commits.`
  }
  const confirm = async () => {
    const oid = props.oid
    if (oid === null) return
    const failure = await actions.attempt(moving, (git) => git.Reset({ repo: actions.repo.id, oid, mode: "hard" }))
    if (failure !== null) return setError(failure)
    actions.setDialog(null)
  }
  return (
    <Confirm
      open={props.oid !== null}
      onOpenChange={(open) => {
        if (open || actions.running()) return
        setError(null)
        actions.setDialog(null)
      }}
      title={`Hard reset ${actions.branch() ?? "HEAD"} to ${shortOid(props.oid ?? "")}?`}
      description={description()}
      error={error()}
      confirmLabel="Hard reset"
      pending={actions.running()}
      onConfirm={() => void confirm()}
    />
  )
}

export function CommitDialogs(props: { actions: CommitActions }) {
  const actions = props.actions
  const refDialog = () => {
    const current = actions.dialog()
    return current?.kind === "branch" || current?.kind === "tag" ? current : null
  }
  const resetTarget = () => {
    const current = actions.dialog()
    return current?.kind === "hard-reset" ? current.oid : null
  }
  const rewriteFrom = () => {
    const current = actions.dialog()
    return current?.kind === "rewrite" ? current : null
  }
  const done = (result: RewriteResult) => {
    actions.setDialog(null)
    if (result.paused) {
      actions.setOutcome(null)
      runCommand("view.changes")
      return
    }
    actions.setOutcome({
      tone: "success",
      title: `Rewrote ${actions.branch() ?? "the branch"}`,
      message: `The original history is saved at ${result.backupRef}. Recover commits can restore it.`,
    })
  }
  return (
    <>
      <Dialog
        open={refDialog() !== null}
        onOpenChange={(open) => !open && !actions.running() && actions.setDialog(null)}
      >
        <DialogBackdrop />
        <DialogContent>
          <Show when={refDialog()} keyed>
            {(current) => <CreateRefDialog actions={actions} kind={current.kind} oid={current.oid} />}
          </Show>
        </DialogContent>
      </Dialog>
      <HardReset actions={actions} oid={resetTarget()} />
      <RewriteDialog entry={rewriteFrom()} onClose={() => actions.setDialog(null)} onDone={done} />
    </>
  )
}

export function OutcomeStrip(props: { outcome: Outcome | null; onDismiss: () => void }) {
  return (
    <Show when={props.outcome}>
      {(outcome) => (
        <div class="shrink-0 border-b p-2">
          <Alert tone={outcome().tone} title={outcome().title} onDismiss={props.onDismiss} class="pe-7">
            {outcome().message}
          </Alert>
        </div>
      )}
    </Show>
  )
}
