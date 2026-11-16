import type { Branch, RemoteBranch, Tag } from "@gitui/contracts"
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/solid/alert-dialog"
import { MenuItem, MenuSeparator } from "@ui-sdk/solid/menu"
import { createMemo, createSignal, For, Show, untrack } from "solid-js"
import { heldBy } from "@/lib/branch-cleanup"
import { useRepo } from "@/lib/repo"
import { describeError } from "@/lib/rpc"
import { active } from "@/lib/workspaces"
import { Prose } from "../commit-mention"
import { Spinner } from "../state"
import { Alert, Bar, Button, ROW } from "../ui"
import type { RefActions } from "./actions"
import { heldReason } from "./cleanup-branches"
import { type Kept, KeptList } from "./kept"
import { loadMerged, type Merged } from "./merged"
import { type Bulk, type RefNode, worktreeHead } from "./model"

export const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const nouns: Record<Bulk["kind"], readonly [string, string]> = {
  local: ["branch", "branches"],
  remote: ["remote branch", "remote branches"],
  tag: ["tag", "tags"],
  worktree: ["worktree", "worktrees"],
}

interface BulkAction {
  readonly label: string
  readonly danger: boolean
  readonly disabled: boolean
  readonly run: () => void
}

const bulkActions = (actions: RefActions, bulk: Bulk): ReadonlyArray<BulkAction> => {
  switch (bulk.kind) {
    case "local": {
      const count = counted(bulk.branches.length, "branch", "branches")
      return [
        {
          label: `Push ${count}`,
          danger: false,
          disabled: actions.busy(),
          run: () => void actions.pushAll(bulk.branches.map((branch) => branch.name)),
        },
        {
          label: `Delete ${count}…`,
          danger: true,
          disabled: actions.busy(),
          run: () => actions.setDialog({ kind: "delete-branches", branches: bulk.branches }),
        },
      ]
    }
    case "remote":
      return [
        {
          label: `Delete ${bulk.branches.length} on remote…`,
          danger: true,
          disabled: actions.busy(),
          run: () => actions.setDialog({ kind: "delete-remotes", branches: bulk.branches }),
        },
      ]
    case "tag": {
      const count = counted(bulk.tags.length, "tag", "tags")
      return [
        {
          label: `Push ${count}…`,
          danger: false,
          disabled: actions.busy(),
          run: () => actions.pushTags(bulk.tags.map((tag) => tag.name)),
        },
        {
          label: `Delete ${count}…`,
          danger: true,
          disabled: actions.busy(),
          run: () => actions.setDialog({ kind: "delete-tags", tags: bulk.tags }),
        },
      ]
    }
    case "worktree": {
      const openable = bulk.worktrees.filter(actions.openable)
      const removable = bulk.worktrees.filter((worktree) => !worktree.isMain && worktree.path !== active())
      return [
        {
          label: openable.length === 1 ? "Open in new tab" : `Open ${openable.length} in tabs`,
          danger: false,
          disabled: openable.length === 0,
          run: () => actions.openAll(openable),
        },
        {
          label: `Remove ${counted(removable.length, "worktree", "worktrees")}…`,
          danger: true,
          disabled: removable.length === 0,
          run: () =>
            actions.setDialog({
              kind: "cleanup-worktrees",
              preset: new Set(removable.map((worktree) => worktree.path)),
            }),
        },
      ]
    }
  }
}

export function BulkMenuItems(props: { actions: RefActions; bulk: Bulk }) {
  const list = createMemo(() => bulkActions(props.actions, props.bulk))
  return (
    <For each={list()}>
      {(action, index) => (
        <>
          <Show when={action.danger && list()[index() - 1]?.danger === false}>
            <MenuSeparator />
          </Show>
          <MenuItem
            class={action.danger ? "text-destructive data-disabled:opacity-50" : "data-disabled:opacity-50"}
            disabled={action.disabled}
            onSelect={action.run}
          >
            {action.label}
          </MenuItem>
        </>
      )}
    </For>
  )
}

const secondary = (node: RefNode) => {
  switch (node.kind) {
    case "local":
      return node.branch.upstream?.name ?? ""
    case "remote":
    case "tag":
      return ""
    case "worktree":
      return worktreeHead(node.worktree)
  }
}

export function BulkDetail(props: { actions: RefActions; bulk: Bulk; nodes: ReadonlyArray<RefNode> }) {
  const actions = props.actions
  const noun = () => nouns[props.bulk.kind]
  return (
    <>
      <Bar class="gap-2">
        <span class="font-medium">{counted(props.nodes.length, noun()[0], noun()[1])} selected</span>
        <Show when={actions.bulkProgress()}>
          {(text) => (
            <span role="status" class="flex items-center gap-1.5 text-muted-foreground">
              <Spinner />
              {text()}
            </span>
          )}
        </Show>
        <div class="flex-1" />
        <div class="flex shrink-0 items-center gap-1.5">
          <For each={bulkActions(actions, props.bulk)}>
            {(action) => (
              <Button variant={action.danger ? "danger" : "outline"} disabled={action.disabled} onClick={action.run}>
                {action.label}
              </Button>
            )}
          </For>
        </div>
      </Bar>
      <Show when={actions.bulkFailure()}>
        {(failure) => (
          <div class="shrink-0 border-b p-2">
            <Alert tone="error" title={failure().title} onDismiss={() => actions.dismissBulk()} class="pe-7">
              <ul class="flex flex-col gap-0.5">
                <For each={failure().items}>
                  {(item) => (
                    <li>
                      <span class="font-mono">{item.name}</span>: {item.message}
                    </li>
                  )}
                </For>
              </ul>
            </Alert>
          </div>
        )}
      </Show>
      <ul class="min-h-0 flex-1 overflow-y-auto overscroll-none p-1 text-xs">
        <For each={props.nodes} keyed={(node) => node.key}>
          {(node) => (
            <li class="flex items-center gap-2 px-1.5" style={{ height: `${ROW}px` }}>
              <span class="min-w-0 truncate font-mono">{node().name}</span>
              <span class="min-w-0 truncate text-2xs text-muted-foreground">{secondary(node())}</span>
            </li>
          )}
        </For>
      </ul>
    </>
  )
}

export interface Failed {
  readonly name: string
  readonly message: string
}

function BulkDelete<T>(props: {
  title: string
  description: string
  items: ReadonlyArray<T> | undefined
  checking?: string
  nameOf: (item: T) => string
  noteOf?: (item: T) => string | null
  kept: ReadonlyArray<Kept>
  keptWhy?: string
  warning: string | null
  confirmLabel: string
  remove: (item: T) => Promise<string | null>
  onClose: () => void
}) {
  const [progress, setProgress] = createSignal<string | null>(null)
  const [failures, setFailures] = createSignal<ReadonlyArray<Failed> | null>(null)
  const run = async () => {
    const items = props.items ?? []
    const failed: Array<Failed> = []
    for (const [index, item] of items.entries()) {
      setProgress(`Deleting ${index + 1} of ${items.length}…`)
      const message = await props.remove(item)
      if (message !== null) failed.push({ name: props.nameOf(item), message })
    }
    setProgress(null)
    if (failed.length === 0) props.onClose()
    else setFailures(failed)
  }
  return (
    <AlertDialog open onOpenChange={(open) => !open && progress() === null && props.onClose()}>
      <AlertDialogBackdrop />
      <AlertDialogContent class="w-[min(28rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>
            <Prose text={props.description} />
          </AlertDialogDescription>
        </div>
        <Show when={(props.items?.length ?? 0) > 0 && failures() === null}>
          <ul class="max-h-48 overflow-y-auto overscroll-none rounded-md border py-0.5 text-xs">
            <For each={props.items}>
              {(item) => (
                <li class="flex items-center gap-2 px-2.5" style={{ height: `${ROW}px` }}>
                  <span class="min-w-0 flex-1 truncate font-mono">{props.nameOf(item)}</span>
                  <Show when={props.noteOf?.(item)}>
                    {(note) => <span class="shrink-0 text-2xs text-change-modified">{note()}</span>}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <KeptList entries={props.kept} why={props.keptWhy ?? ""} />
        <Show when={failures()}>
          {(failed) => (
            <Alert tone="error" title={`${counted(failed().length, "wasn't", "weren't")} deleted`}>
              <ul class="flex flex-col gap-0.5">
                <For each={failed()}>
                  {(failure) => (
                    <li>
                      <span class="font-mono">{failure.name}</span>: {failure.message}
                    </li>
                  )}
                </For>
              </ul>
            </Alert>
          )}
        </Show>
        <div class="flex items-center justify-end gap-1.5">
          <Show when={progress() ?? (props.items === undefined ? (props.checking ?? null) : null)}>
            {(text) => (
              <span role="status" class="me-auto flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner />
                {text()}
              </span>
            )}
          </Show>
          <Show when={progress() === null && failures() === null ? props.warning : null}>
            {(note) => <span class="me-auto min-w-0 truncate text-xs text-change-modified">{note()}</span>}
          </Show>
          <Button disabled={progress() !== null} onClick={() => props.onClose()}>
            {failures() === null ? "Cancel" : "Close"}
          </Button>
          <Show when={failures() === null}>
            <Button
              variant="destructive"
              disabled={progress() !== null || (props.items?.length ?? 0) === 0}
              onClick={() => void run()}
            >
              {props.confirmLabel}
            </Button>
          </Show>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const attempt = async (work: () => Promise<unknown>) => {
  try {
    await work()
    return null
  } catch (error) {
    return describeError(error)
  }
}

export function DeleteBranchesConfirm(props: { branches: ReadonlyArray<Branch>; onClose: () => void }) {
  const repo = useRepo()
  const head = () => {
    const value = repo.status().head
    return value._tag === "Branch" ? value.name : null
  }
  const split = createMemo(() => {
    const free: Array<Branch> = []
    const kept: Array<Kept> = []
    for (const branch of props.branches) {
      const held = heldBy(branch, head(), repo.refs().worktrees)
      if (held === null) free.push(branch)
      else kept.push({ name: branch.name, reason: heldReason(held) })
    }
    return { free, kept }
  })
  const [merged, setMerged] = createSignal<Merged>()
  const [checkError, setCheckError] = createSignal<string | null>(null)
  void loadMerged(
    repo,
    untrack(() => props.branches.map((branch) => branch.name)),
  ).then(setMerged, (error: unknown) => setCheckError(describeError(error)))
  const base = () => merged()?.base ?? null
  const unmerged = (branch: Branch) => {
    const known = merged()
    return known !== undefined && known.base !== null && !known.merged.has(branch.name)
  }
  const unmergedCount = () => split().free.filter(unmerged).length
  const warning = () => {
    if (checkError() !== null) return "Couldn't check which are merged"
    const name = base()?.name
    if (merged() === undefined) return null
    if (name === undefined) return "No main branch to check them against"
    if (unmergedCount() === 0) return null
    return `${unmergedCount()} not merged into ${name}`
  }

  return (
    <BulkDelete
      title={`Delete ${counted(split().free.length, "branch", "branches")}?`}
      description="This deletes the local branches. Copies on remotes stay."
      items={merged() === undefined && checkError() === null ? undefined : split().free}
      checking="Checking which are merged…"
      nameOf={(branch) => branch.name}
      noteOf={(branch) => (unmerged(branch) ? "Not merged" : null)}
      kept={split().kept}
      keptWhy="because they're checked out. Remove their worktrees first to delete them."
      warning={warning()}
      confirmLabel="Delete"
      remove={(branch) =>
        attempt(() =>
          repo.mutate(["refs"], (git) =>
            git.DeleteBranch({ repo: repo.id, name: branch.name, force: true, removeWorktree: false }),
          ),
        )
      }
      onClose={props.onClose}
    />
  )
}

export function DeleteRemotesConfirm(props: { branches: ReadonlyArray<RemoteBranch>; onClose: () => void }) {
  const repo = useRepo()
  const configured = (branch: RemoteBranch) => repo.refs().remotes.some((remote) => remote.name === branch.remote)
  const free = () => props.branches.filter(configured)
  const remotes = () => [...new Set(free().map((branch) => branch.remote))]
  const kept = () =>
    props.branches
      .filter((branch) => !configured(branch))
      .map((branch) => ({ name: branch.name, reason: `No remote named ${branch.remote}` }))
  return (
    <BulkDelete
      title={`Delete ${counted(free().length, "branch", "branches")} on ${remotes().length === 1 ? remotes()[0] : "their remotes"}?`}
      description="This deletes them for everyone who uses the remote. Your local branches stay. A branch that changed on the remote since your last fetch isn't deleted."
      items={free()}
      nameOf={(branch) => branch.name}
      kept={kept()}
      keptWhy="because their remote isn't set up in this repository."
      warning={null}
      confirmLabel="Delete on remote"
      remove={async (branch) => {
        const outcome = await repo.stream("push", (git) =>
          git.DeleteRemoteBranch({
            repo: repo.id,
            remote: branch.remote,
            branch: branch.name.slice(branch.remote.length + 1),
            expected: branch.oid,
          }),
        )
        return outcome.ok ? null : outcome.message
      }}
      onClose={props.onClose}
    />
  )
}

export function DeleteTagsConfirm(props: { tags: ReadonlyArray<Tag>; onClose: () => void }) {
  const repo = useRepo()
  return (
    <BulkDelete
      title={`Delete ${counted(props.tags.length, "tag", "tags")}?`}
      description="This deletes the local tags only. Copies you pushed to a remote stay there."
      items={props.tags}
      nameOf={(tag) => tag.name}
      kept={[]}
      warning={null}
      confirmLabel="Delete"
      remove={(tag) => attempt(() => repo.mutate(["refs"], (git) => git.DeleteTag({ repo: repo.id, name: tag.name })))}
      onClose={props.onClose}
    />
  )
}
