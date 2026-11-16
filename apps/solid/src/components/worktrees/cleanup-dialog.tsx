import type { WorktreeSummary } from "@gitui/contracts"
import { Checkbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { createMemo, createSignal, For, Show } from "solid-js"
import { basename } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import { active, forgetRepo } from "@/lib/workspaces"
import {
  bulkSelectable,
  type Candidate,
  cleanupCandidates,
  selectable,
  type Staleness,
  suggested,
  uncommittedChanges,
  unmergedCommits,
} from "@/lib/worktree-cleanup"
import { Spinner } from "../state"
import { Alert, Button, ROW } from "../ui"

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`

const status = (staleness: Staleness) => {
  switch (staleness._tag) {
    case "Missing":
      return "Folder missing"
    case "Landed":
      return "Merged"
    case "Gone":
      return "Gone on remote"
    case "Unmerged":
      return "Unmerged"
    case "Dirty":
      return "Uncommitted changes"
    case "Locked":
      return "Locked"
    case "Checking":
      return "Checking…"
  }
}

const warns = (staleness: Staleness) => staleness._tag === "Dirty" || staleness._tag === "Unmerged"

const nameOf = (candidate: Candidate) =>
  candidate.worktree.head._tag === "Branch" ? candidate.worktree.head.name : basename(candidate.worktree.path)

interface Failed {
  readonly name: string
  readonly message: string
}

function CleanupForm(props: { preset: ReadonlySet<string> | null; onClose: () => void }) {
  const repo = useRepo()
  const [summaries, setSummaries] = createSignal<ReadonlyArray<WorktreeSummary>>()
  const [loadError, setLoadError] = createSignal<string | null>(null)
  void call((git) => git.GetWorktreeSummaries({ repo: repo.id })).then(setSummaries, (error: unknown) =>
    setLoadError(describeError(error)),
  )
  const [overrides, setOverrides] = createSignal<ReadonlyMap<string, boolean>>(new Map())
  const [deleteBranches, setDeleteBranches] = createSignal(true)
  const [progress, setProgress] = createSignal<string | null>(null)
  const [failures, setFailures] = createSignal<ReadonlyArray<Failed>>([])

  const candidates = createMemo(() =>
    cleanupCandidates(repo.refs().worktrees, summaries(), repo.refs().branches, active()),
  )
  const preselected = (candidate: Candidate) =>
    props.preset === null
      ? suggested(candidate.staleness)
      : bulkSelectable(candidate.staleness) && props.preset.has(candidate.worktree.path)
  const checked = (candidate: Candidate) =>
    selectable(candidate.staleness) && (overrides().get(candidate.worktree.path) ?? preselected(candidate))
  const picked = () => candidates().filter(checked)
  const bulk = () => candidates().filter((candidate) => bulkSelectable(candidate.staleness))
  const allPicked = () => bulk().length > 0 && bulk().every(checked)
  const somePicked = () => bulk().some(checked)
  const pick = (paths: ReadonlyArray<string>, next: boolean) =>
    setOverrides((current) => {
      const updated = new Map(current)
      for (const path of paths) updated.set(path, next)
      return updated
    })
  const lostCommits = () =>
    deleteBranches()
      ? picked().reduce(
          (total, candidate) =>
            total + (candidate.worktree.head._tag === "Branch" ? unmergedCommits(candidate.staleness) : 0),
          0,
        )
      : 0
  const dirty = () => picked().filter((candidate) => uncommittedChanges(candidate.staleness) > 0)
  const discarded = () => dirty().reduce((total, candidate) => total + uncommittedChanges(candidate.staleness), 0)

  const remove = async () => {
    const chosen = picked()
    const alsoBranches = deleteBranches()
    const failed: Array<Failed> = []
    const attempt = async (name: string, step: Parameters<typeof repo.mutate>[1]) => {
      try {
        await repo.mutate(["refs"], step)
        return true
      } catch (error) {
        failed.push({ name, message: describeError(error) })
        return false
      }
    }
    setFailures([])
    const present = chosen.filter((candidate) => candidate.staleness._tag !== "Missing")
    const missing = chosen.filter((candidate) => candidate.staleness._tag === "Missing")
    for (const [index, candidate] of present.entries()) {
      const { worktree, staleness } = candidate
      setProgress(`Removing ${index + 1} of ${chosen.length}…`)
      const removed = await attempt(nameOf(candidate), (git) =>
        git.RemoveWorktree({
          repo: repo.id,
          path: worktree.path,
          force: uncommittedChanges(staleness) > 0,
          deleteBranch: false,
        }),
      )
      if (removed) forgetRepo(worktree.path)
      if (removed && alsoBranches && worktree.head._tag === "Branch") {
        const name = worktree.head.name
        await attempt(name, (git) => git.DeleteBranch({ repo: repo.id, name, force: true, removeWorktree: false }))
      }
    }
    if (missing.length > 0) {
      setProgress("Pruning missing worktrees…")
      const pruned = await attempt("Missing worktrees", (git) => git.PruneWorktrees({ repo: repo.id }))
      if (pruned) for (const { worktree } of missing) forgetRepo(worktree.path)
      if (pruned && alsoBranches)
        for (const { worktree } of missing) {
          if (worktree.head._tag !== "Branch") continue
          const name = worktree.head.name
          await attempt(name, (git) => git.DeleteBranch({ repo: repo.id, name, force: false, removeWorktree: false }))
        }
    }
    setProgress(null)
    setOverrides(new Map())
    if (failed.length === 0) props.onClose()
    else {
      setFailures(failed)
      void call((git) => git.GetWorktreeSummaries({ repo: repo.id })).then(setSummaries, () => undefined)
    }
  }

  return (
    <>
      <Show
        when={candidates().length > 0}
        fallback={<p class="text-muted-foreground">There are no other worktrees.</p>}
      >
        <div class="flex max-h-80 min-h-0 flex-col overflow-hidden rounded-md border">
          <div class="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-2.5" style={{ height: `${ROW}px` }}>
            <Checkbox
              aria-label="Select all without uncommitted changes"
              disabled={bulk().length === 0 || progress() !== null}
              checked={allPicked() ? true : somePicked() ? "indeterminate" : false}
              onCheckedChange={() =>
                pick(
                  bulk().map((candidate) => candidate.worktree.path),
                  !allPicked(),
                )
              }
            >
              <CheckboxIndicator />
            </Checkbox>
            <span class="min-w-0 flex-1 truncate section-label">Worktree</span>
            <span class="w-16 shrink-0 text-end section-label">Changes</span>
            <span class="w-16 shrink-0 text-end section-label">Commits</span>
            <span class="w-32 shrink-0 section-label">Status</span>
          </div>
          <ul class="min-h-0 flex-1 overflow-y-auto overscroll-none py-0.5">
            <For each={candidates()} keyed={(candidate) => candidate.worktree.path}>
              {(candidate) => {
                const enabled = () => selectable(candidate().staleness) && progress() === null
                const summary = () => summaries()?.find((entry) => entry.path === candidate().worktree.path)
                return (
                  <li>
                    <label
                      class={[
                        "flex items-center gap-2 px-2.5",
                        enabled() ? "hover:bg-muted/60" : "text-muted-foreground",
                      ]}
                      style={{ height: `${ROW}px` }}
                    >
                      <Checkbox
                        disabled={!enabled()}
                        checked={checked(candidate())}
                        onCheckedChange={(next) => pick([candidate().worktree.path], next === true)}
                      >
                        <CheckboxIndicator />
                      </Checkbox>
                      <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
                        <span class="truncate font-mono">{nameOf(candidate())}</span>
                        <span class="min-w-0 shrink truncate text-2xs text-muted-foreground">
                          {basename(candidate().worktree.path)}
                        </span>
                      </span>
                      <span class="w-16 shrink-0 text-end text-muted-foreground tabular-nums">
                        {summary()?.changes || "–"}
                      </span>
                      <span class="w-16 shrink-0 text-end text-muted-foreground tabular-nums">
                        {summary()?.commits || "–"}
                      </span>
                      <span
                        class={[
                          "w-32 shrink-0 truncate text-2xs",
                          warns(candidate().staleness) ? "text-change-modified" : "text-muted-foreground",
                        ]}
                      >
                        {status(candidate().staleness)}
                      </span>
                    </label>
                  </li>
                )
              }}
            </For>
          </ul>
        </div>
      </Show>
      <label class="flex items-center gap-2">
        <Checkbox
          checked={deleteBranches()}
          disabled={progress() !== null}
          onCheckedChange={(next) => setDeleteBranches(next === true)}
        >
          <CheckboxIndicator />
        </Checkbox>
        Also delete their branches
      </label>
      <Show when={loadError()}>
        {(message) => (
          <Alert tone="error" title="Couldn't check the worktrees">
            {message()}
          </Alert>
        )}
      </Show>
      <Show when={discarded() > 0}>
        <Alert tone="warning" title={`Discards ${plural(discarded(), "uncommitted change")}`}>
          In {plural(dirty().length, "worktree")}. They can't be recovered.
        </Alert>
      </Show>
      <Show when={lostCommits() > 0}>
        <Alert tone="warning" title={`Deletes ${plural(lostCommits(), "commit")} not on the base branch`}>
          Squash-merged branches usually show up this way.
        </Alert>
      </Show>
      <Show when={failures().length > 0}>
        <Alert tone="error" title="Some worktrees weren't removed">
          <ul class="flex flex-col gap-0.5">
            <For each={failures()}>
              {(failure) => (
                <li>
                  <span class="font-mono">{failure.name}</span>: {failure.message}
                </li>
              )}
            </For>
          </ul>
        </Alert>
      </Show>
      <div class="flex items-center justify-end gap-1.5">
        <Show when={progress()}>
          {(text) => (
            <span role="status" class="me-auto flex items-center gap-2 text-muted-foreground">
              <Spinner />
              {text()}
            </span>
          )}
        </Show>
        <Show when={summaries() === undefined && loadError() === null && progress() === null}>
          <span role="status" class="me-auto flex items-center gap-2 text-muted-foreground">
            <Spinner />
            Checking worktrees…
          </span>
        </Show>
        <Button disabled={progress() !== null} onClick={() => props.onClose()}>
          {failures().length > 0 ? "Close" : "Cancel"}
        </Button>
        <Button
          variant="destructive"
          disabled={picked().length === 0 || progress() !== null}
          onClick={() => void remove()}
        >
          Remove {plural(picked().length, "worktree")}
        </Button>
      </div>
    </>
  )
}

export function CleanupWorktreesDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  preset?: ReadonlySet<string>
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <DialogBackdrop />
      <DialogContent class="w-[min(40rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <DialogTitle>Clean up worktrees</DialogTitle>
          <DialogDescription>
            {props.preset === undefined
              ? "Worktrees that look finished are checked."
              : "The worktrees you selected are checked."}{" "}
            Ones with uncommitted changes stay unchecked; removing them discards those changes.
          </DialogDescription>
        </div>
        <Show when={props.open}>
          <CleanupForm preset={props.preset ?? null} onClose={() => props.onOpenChange(false)} />
        </Show>
      </DialogContent>
    </Dialog>
  )
}
