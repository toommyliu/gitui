import { Checkbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { Menu, MenuCheckboxItem, MenuContent, MenuItemIndicator, MenuTrigger } from "@ui-sdk/solid/menu"
import { createMemo, createSignal, For, Show, untrack } from "solid-js"
import {
  type BranchCandidate,
  branchCleanup,
  type BranchStaleness,
  type Held,
  suggestedBranch,
} from "@/lib/branch-cleanup"
import { basename } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { describeError } from "@/lib/rpc"
import { Check, ChevronDown } from "../icons"
import { Spinner } from "../state"
import { Alert, Button, ROW } from "../ui"
import { loadMerged, type Merged } from "./merged"
import { KeptList } from "./kept"

const branches = (count: number) => `${count} ${count === 1 ? "branch" : "branches"}`

const statusLabels: Record<BranchStaleness["_tag"], string> = { Merged: "Merged", Gone: "Gone on remote" }

const status = (staleness: BranchStaleness) => statusLabels[staleness._tag]

export const heldReason = (held: Held) =>
  held._tag === "Current" ? "Checked out here" : `Checked out in ${basename(held.path)}`

interface Failed {
  readonly name: string
  readonly message: string
}

function CleanupForm(props: { onClose: () => void }) {
  const repo = useRepo()
  const [loaded, setLoaded] = createSignal<Merged>()
  const [loadError, setLoadError] = createSignal<string | null>(null)
  void loadMerged(
    repo,
    untrack(() => repo.refs().branches.map((branch) => branch.name)),
  ).then(setLoaded, (error: unknown) => setLoadError(describeError(error)))
  const [overrides, setOverrides] = createSignal<ReadonlyMap<string, boolean>>(new Map())
  const [progress, setProgress] = createSignal<string | null>(null)
  const [failures, setFailures] = createSignal<ReadonlyArray<Failed>>([])

  const head = () => {
    const value = repo.status().head
    return value._tag === "Branch" ? value.name : null
  }
  const cleanup = createMemo(() => {
    const merged = loaded()
    return merged === undefined
      ? null
      : branchCleanup({
          branches: repo.refs().branches,
          merged: merged.merged,
          base: merged.base,
          head: head(),
          worktrees: repo.refs().worktrees,
        })
  })
  const baseName = () => loaded()?.base?.name ?? "the main branch"
  const candidates = () => cleanup()?.candidates ?? []
  const checked = (candidate: BranchCandidate) =>
    overrides().get(candidate.branch.name) ?? suggestedBranch(candidate.staleness)
  const picked = () => candidates().filter(checked)
  const allPicked = () => candidates().length > 0 && candidates().every(checked)
  const somePicked = () => candidates().some(checked)
  const ofKind = (kind: BranchStaleness["_tag"]) =>
    candidates().filter((candidate) => candidate.staleness._tag === kind)
  const kinds = () =>
    (["Merged", "Gone"] as const).filter((kind) => candidates().some((candidate) => candidate.staleness._tag === kind))
  const pick = (names: ReadonlyArray<string>, next: boolean) =>
    setOverrides((current) => {
      const updated = new Map(current)
      for (const name of names) updated.set(name, next)
      return updated
    })
  const unmerged = () => picked().filter((candidate) => candidate.staleness._tag !== "Merged").length

  const remove = async () => {
    const chosen = picked()
    const failed: Array<Failed> = []
    setFailures([])
    for (const [index, { branch }] of chosen.entries()) {
      setProgress(`Deleting ${index + 1} of ${chosen.length}…`)
      try {
        await repo.mutate(["refs"], (git) =>
          git.DeleteBranch({ repo: repo.id, name: branch.name, force: true, removeWorktree: false }),
        )
      } catch (error) {
        failed.push({ name: branch.name, message: describeError(error) })
      }
    }
    setProgress(null)
    setOverrides(new Map())
    if (failed.length === 0) props.onClose()
    else setFailures(failed)
  }

  return (
    <>
      <Show when={cleanup()}>
        {(found) => (
          <>
            <Show
              when={found().candidates.length > 0}
              fallback={
                <p class="text-muted-foreground">No branches are merged into {baseName()} or gone on their remote.</p>
              }
            >
              <div class="flex max-h-80 min-h-0 flex-col overflow-hidden rounded-md border">
                <div
                  class="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-2.5"
                  style={{ height: `${ROW}px` }}
                >
                  <Checkbox
                    aria-label="Select all"
                    disabled={progress() !== null}
                    checked={allPicked() ? true : somePicked() ? "indeterminate" : false}
                    onCheckedChange={() =>
                      pick(
                        candidates().map((candidate) => candidate.branch.name),
                        !allPicked(),
                      )
                    }
                  >
                    <CheckboxIndicator />
                  </Checkbox>
                  <span class="min-w-0 flex-1 truncate section-label">Branch</span>
                  <Menu>
                    <MenuTrigger
                      disabled={progress() !== null}
                      class="-me-1 flex shrink-0 items-center gap-0.5 rounded px-1 section-label hover:bg-muted hover:text-foreground data-open:bg-muted data-open:text-foreground"
                    >
                      Status
                      <ChevronDown />
                    </MenuTrigger>
                    <MenuContent align="end" sideOffset={4} class="min-w-48">
                      <For each={kinds()}>
                        {(kind) => (
                          <MenuCheckboxItem
                            value={kind}
                            checked={ofKind(kind).every(checked)}
                            onCheckedChange={(next) =>
                              pick(
                                ofKind(kind).map((candidate) => candidate.branch.name),
                                next,
                              )
                            }
                          >
                            <MenuItemIndicator keepMounted class="flex w-3 justify-center">
                              <Show when={ofKind(kind).every(checked)}>
                                <Check class="size-3" />
                              </Show>
                            </MenuItemIndicator>
                            {statusLabels[kind]}
                            <span class="ms-auto text-2xs text-muted-foreground tabular-nums">
                              {ofKind(kind).length}
                            </span>
                          </MenuCheckboxItem>
                        )}
                      </For>
                    </MenuContent>
                  </Menu>
                </div>
                <ul class="min-h-0 flex-1 overflow-y-auto overscroll-none py-0.5">
                  <For each={found().candidates} keyed={(candidate) => candidate.branch.name}>
                    {(candidate) => (
                      <li>
                        <label
                          class={[
                            "flex items-center gap-2 px-2.5",
                            progress() === null ? "hover:bg-muted/60" : "text-muted-foreground",
                          ]}
                          style={{ height: `${ROW}px` }}
                        >
                          <Checkbox
                            disabled={progress() !== null}
                            checked={checked(candidate())}
                            onCheckedChange={(next) => pick([candidate().branch.name], next === true)}
                          >
                            <CheckboxIndicator />
                          </Checkbox>
                          <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
                            <span class="truncate font-mono">{candidate().branch.name}</span>
                            <Show when={candidate().branch.upstream}>
                              {(upstream) => (
                                <span class="min-w-0 shrink truncate text-2xs text-muted-foreground">
                                  {upstream().name}
                                </span>
                              )}
                            </Show>
                          </span>
                          <span
                            class={[
                              "shrink-0 text-end text-2xs",
                              candidate().staleness._tag === "Merged"
                                ? "text-muted-foreground"
                                : "text-change-modified",
                            ]}
                          >
                            {status(candidate().staleness)}
                          </span>
                        </label>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
            <KeptList
              entries={found().held.map((entry) => ({ name: entry.branch.name, reason: heldReason(entry.held) }))}
              why="because they're checked out. Remove their worktrees first to delete them."
            />
          </>
        )}
      </Show>
      <Show when={loadError()}>
        {(message) => (
          <Alert tone="error" title="Couldn't check the branches">
            {message()}
          </Alert>
        )}
      </Show>
      <Show when={failures().length > 0}>
        <Alert tone="error" title="Some branches weren't deleted">
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
        <Show when={progress() === null && unmerged() > 0}>
          <span role="status" class="me-auto min-w-0 truncate text-xs text-change-modified">
            {unmerged()} not merged into {baseName()}
          </span>
        </Show>
        <Show when={loaded() === undefined && loadError() === null}>
          <span role="status" class="me-auto flex items-center gap-2 text-muted-foreground">
            <Spinner />
            Checking which branches are merged…
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
          Delete {branches(picked().length)}
        </Button>
      </div>
    </>
  )
}

export function CleanupBranchesDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <DialogBackdrop />
      <DialogContent class="w-[min(40rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <DialogTitle>Clean up branches</DialogTitle>
          <DialogDescription>
            Branches merged into the main branch are checked. Ones whose upstream is gone stay unchecked; deleting them
            loses commits that aren't on the main branch.
          </DialogDescription>
        </div>
        <Show when={props.open}>
          <CleanupForm onClose={() => props.onOpenChange(false)} />
        </Show>
      </DialogContent>
    </Dialog>
  )
}
