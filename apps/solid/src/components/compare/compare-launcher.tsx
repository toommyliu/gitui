import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/solid/segmented-control"
import { createMemo, createSignal, For, Show } from "solid-js"
import {
  closeCompare,
  type CompareDraft,
  compareDraft,
  type CompareMode,
  compareModes,
  openCompare,
  refLabel,
  refOptions,
  resolveRef,
  showComparison,
  shownComparison,
} from "@/lib/comparison"
import { useCommand } from "@/lib/hotkeys"
import { type Repo, useRepo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import { active, workspaceFor } from "@/lib/workspaces"
import { Alert, Button, Tip } from "../ui"
import { RefInput } from "./ref-input"

export function SwapIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="size-3.5 shrink-0"
    >
      <path d="m8 3-4 4 4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  )
}

const currentBranch = (repo: Repo) => {
  const head = repo.status().head
  return head._tag === "Detached" ? null : head.name
}

export const defaultDraft = (repo: Repo): CompareDraft => {
  const shown = shownComparison(repo.id)
  if (shown !== null)
    return {
      repo: repo.id,
      base: shown.base,
      head: shown.head,
      mode: shown.mode === "direct" ? "direct" : "merge-base",
    }
  const current = currentBranch(repo)
  const main = repo.refs().branches.find((branch) => branch.name === "main" || branch.name === "master")
  if (main === undefined) return { repo: repo.id, base: "HEAD", head: null, mode: "merge-base" }
  return {
    repo: repo.id,
    base: `refs/heads/${main.name}`,
    head: current === null ? "HEAD" : current === main.name ? null : `refs/heads/${current}`,
    mode: "merge-base",
  }
}

function CompareForm(props: { draft: CompareDraft }) {
  const repo = useRepo()
  const options = createMemo(() => refOptions(repo.refs(), currentBranch(repo)))
  const [base, setBase] = createSignal(props.draft.base === null ? "" : refLabel(props.draft.base))
  const [head, setHead] = createSignal(props.draft.head === null ? "" : refLabel(props.draft.head))
  const [mode, setMode] = createSignal<CompareMode>(props.draft.mode)
  const [error, setError] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal(false)
  const description = () => compareModes.find((option) => option.value === mode())?.description

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    const comparison = { base: resolveRef(base(), options()), head: resolveRef(head(), options()), mode: mode() }
    if (comparison.base === "" || comparison.head === "") {
      setError("Enter a branch, tag or commit SHA on both sides.")
      return
    }
    setPending(true)
    setError(null)
    try {
      await call((git) => git.GetComparison({ repo: repo.id, comparison }))
      showComparison(repo.id, comparison)
      const path = active()
      if (path !== null) workspaceFor(path).setView("branches")
      closeCompare()
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <form class="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <div class="flex items-end gap-1.5">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <RefInput
            label="Base"
            value={base()}
            options={options()}
            onValueChange={setBase}
            autofocus={base() !== "" && head() === ""}
          />
        </div>
        <Tip label="Swap base and compare">
          {(trigger) => (
            <Button
              {...trigger}
              variant="ghost"
              aria-label="Swap base and compare"
              class="mb-0.5 w-6 justify-center px-0"
              onClick={() => {
                const previous = base()
                setBase(head())
                setHead(previous)
              }}
            >
              <SwapIcon />
            </Button>
          )}
        </Tip>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <RefInput
            label="Compare"
            value={head()}
            options={options()}
            onValueChange={setHead}
            autofocus={head() !== "" || base() === ""}
          />
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <SegmentedControl
          aria-label="What to compare"
          value={mode()}
          onValueChange={(next: CompareMode | null) => {
            if (next !== null) setMode(next)
          }}
          class="self-start"
        >
          <For each={compareModes}>
            {(option) => <SegmentedControlItem value={option.value}>{option.label}</SegmentedControlItem>}
          </For>
        </SegmentedControl>
        <p class="text-muted-foreground">{description()}</p>
      </div>
      <Show when={error()}>
        {(message) => (
          <Alert tone="error" title="Couldn't compare these">
            {message()}
          </Alert>
        )}
      </Show>
      <div class="flex justify-end gap-1.5">
        <Button disabled={pending()} onClick={closeCompare}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending()}>
          Compare
        </Button>
      </div>
    </form>
  )
}

export function CompareLauncher() {
  const repo = useRepo()
  useCommand("history.compare", () => openCompare(defaultDraft(repo)))
  const draft = () => {
    const current = compareDraft()
    return current?.repo === repo.id ? current : null
  }
  return (
    <Dialog open={draft() !== null} onOpenChange={(open) => !open && closeCompare()}>
      <DialogBackdrop />
      <DialogContent class="w-[min(32rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <DialogTitle>Compare</DialogTitle>
          <DialogDescription>Pick two branches, tags or commits. The result opens in Branches.</DialogDescription>
        </div>
        <Show when={draft()} keyed>
          {(current) => <CompareForm draft={current} />}
        </Show>
      </DialogContent>
    </Dialog>
  )
}
