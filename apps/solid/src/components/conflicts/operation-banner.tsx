import type { Operation, RepoPath } from "@gitui/contracts"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { operationTitle, type SideRefs } from "@/lib/conflicts"
import { useRepo } from "@/lib/repo"
import { call } from "@/lib/rpc"
import { Confirm } from "../refs/confirm"
import { createRunner } from "../refs/runner"
import { Alert, Button, Failures, Tip } from "../ui"

interface Context {
  readonly operation: Operation | null
  readonly refs: SideRefs
  readonly editing: boolean
}

const unknown: SideRefs = { ours: null, theirs: null }

const abortEffects: Record<Operation, string> = {
  merge: "The branch and working tree go back to how they were before the merge. Resolutions you've made are lost.",
  rebase: "The branch goes back to where it was before the rebase started. Commits already rebased are dropped.",
  "cherry-pick": "The branch goes back to where it was before the cherry-pick. Resolutions you've made are lost.",
  revert: "The branch goes back to where it was before the revert. Resolutions you've made are lost.",
  bisect: "The bisect ends and the commit you started from is checked out again.",
}

const canSkip = (operation: Operation | null) =>
  operation === "rebase" || operation === "cherry-pick" || operation === "revert"

type Step = "skip" | "abort"

export function OperationBanner() {
  const repo = useRepo()
  const operation = () => repo.status().operation
  const conflicted = createMemo(() =>
    repo.status().entries.flatMap((entry): Array<RepoPath> => (entry._tag === "Conflicted" ? [entry.path] : [])),
  )
  const count = () => conflicted().length

  const [context, setContext] = createSignal<Context>({ operation: null, refs: unknown, editing: false })
  createEffect(
    () => ({ operation: operation(), path: conflicted()[0] ?? null }),
    ({ operation, path }) => {
      if (operation === null) {
        setContext({ operation, refs: unknown, editing: false })
        return
      }
      let live = true
      void Promise.all([
        path === null
          ? null
          : call((git) => git.GetConflict({ repo: repo.id, path })).then(
              (detail) => detail.labels,
              () => null,
            ),
        operation === "rebase"
          ? call((git) => git.GetRebaseState({ repo: repo.id })).then(
              (state) => state._tag === "Rebase" && state.phase === "edit",
              () => false,
            )
          : false,
      ]).then(([refs, editing]) => {
        if (!live) return
        setContext((previous) => {
          const known = previous.operation === operation ? previous.refs : unknown
          return {
            operation,
            editing,
            refs:
              refs === null
                ? known
                : {
                    ours: refs.ours === null || refs.ours.name === null ? (known.ours ?? refs.ours) : refs.ours,
                    theirs: refs.theirs,
                  },
          }
        })
      })
      return () => {
        live = false
      }
    },
  )

  const editing = () => context().operation === operation() && context().editing
  const title = () => {
    const current = operation()
    if (editing()) return "Rebase paused to edit a commit"
    return operationTitle(current, context().operation === current ? context().refs : unknown)
  }
  const detail = () =>
    count() > 0
      ? `${count()} ${count() === 1 ? "conflict" : "conflicts"}`
      : operation() === null || editing()
        ? null
        : "no conflicts left"

  const runner = createRunner()
  const [confirming, setConfirming] = createSignal<Step | null>(null)

  const step = (kind: "continue" | Step, current: Operation) =>
    runner.run({
      scopes: ["worktree", "index", "refs"],
      request: (git) =>
        kind === "continue"
          ? git.ContinueOperation({ repo: repo.id })
          : kind === "skip"
            ? git.SkipOperation({ repo: repo.id })
            : git.AbortOperation({ repo: repo.id }),
      failure: `Couldn't ${kind} the ${current}`,
    })

  const confirm = async () => {
    const kind = confirming()
    const current = operation()
    if (kind !== null && current !== null && (await step(kind, current))) setConfirming(null)
  }

  const dialog = () => {
    const current = operation()
    const kind = confirming()
    if (current === null || kind === null) return null
    if (kind === "abort")
      return {
        title: `Abort the ${current}?`,
        description: abortEffects[current],
        label: `Abort ${current}`,
      }
    const subject = context().refs.theirs?.subject
    return {
      title: "Skip this commit?",
      description: `The ${current} drops ${subject === undefined ? "this commit" : `“${subject}”`} and goes on to the next one.`,
      label: "Skip commit",
    }
  }

  return (
    <Show when={operation() !== null || count() > 0}>
      <div class="shrink-0 border-b p-2">
        <Alert tone="warning">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="min-w-56 flex-1">
              <span data-alert-title class="font-medium">
                {title()}
              </span>
              <Show when={detail()}>{(text) => <span class="text-muted-foreground"> · {text()}</span>}</Show>
            </span>
            <Show when={operation()}>
              {(current) => (
                <div class="ms-auto flex shrink-0 items-center gap-1">
                  <Show when={current() !== "bisect"}>
                    <Button
                      variant="primary"
                      disabled={runner.running() || count() > 0}
                      onClick={() => void step("continue", current())}
                    >
                      Continue
                    </Button>
                  </Show>
                  <Show when={canSkip(current()) && !editing()}>
                    <Tip label="Drop this commit and go on to the next one">
                      {(trigger) => (
                        <Button
                          {...trigger}
                          variant="ghost"
                          disabled={runner.running()}
                          onClick={() => setConfirming("skip")}
                        >
                          Skip
                        </Button>
                      )}
                    </Tip>
                  </Show>
                  <Button variant="danger" disabled={runner.running()} onClick={() => setConfirming("abort")}>
                    Abort
                  </Button>
                </div>
              )}
            </Show>
          </div>
        </Alert>
      </div>
      <Show when={confirming() === null}>
        <Failures failure={runner.failure()} onDismiss={runner.dismiss} />
      </Show>
      <Confirm
        open={dialog() !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null)
            runner.dismiss()
          }
        }}
        title={dialog()?.title ?? ""}
        description={dialog()?.description ?? ""}
        error={confirming() === null ? null : (runner.failure()?.message ?? null)}
        confirmLabel={dialog()?.label ?? ""}
        pending={runner.running()}
        onConfirm={() => void confirm()}
      />
    </Show>
  )
}
