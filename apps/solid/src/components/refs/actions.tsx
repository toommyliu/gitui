import type { Branch, ChangeScope, PushContext, RemoteBranch, Tag, Worktree } from "@gitui/contracts"
import { MenuItem, MenuSeparator, MenuShortcut } from "@ui-sdk/solid/menu"
import { createSignal, Match, Show, Switch } from "solid-js"
import * as Effect from "effect/Effect"
import { localChangesBlock } from "@/lib/checkout"
import { openCompare } from "@/lib/comparison"
import { basename } from "@/lib/format"
import { runCommand } from "@/lib/hotkeys"
import { useRepo } from "@/lib/repo"
import { describeError } from "@/lib/rpc"
import { pushPlan, savedPushDestination, syncPreferences } from "@/lib/sync-preferences"
import { active, openRepo, openRepos } from "@/lib/workspaces"
import { ForcePushConfirm } from "../remote/force-push"
import { type ForcePush, forcePushTarget, pushBranch, readPushContext, sendPush } from "../remote/push"
import { PushTagsDialog } from "../remote/push-tags"
import { PushToDialog } from "../remote/push-to"
import { AddWorktreeDialog } from "../worktrees/add-dialog"
import { CleanupWorktreesDialog } from "../worktrees/cleanup-dialog"
import { RemoveWorktreeDialog } from "../worktrees/remove-dialog"
import { RenameBranchDialog, UpstreamDialog } from "./branch-dialogs"
import { DeleteBranchesConfirm, DeleteRemotesConfirm, DeleteTagsConfirm, type Failed } from "./bulk"
import { CleanupBranchesDialog } from "./cleanup-branches"
import { Confirm } from "./confirm"
import type { RefNode } from "./model"
import { createRunner } from "./runner"

type Dialog =
  | { readonly kind: "delete-branch"; readonly branch: Branch }
  | { readonly kind: "rename"; readonly branch: Branch }
  | { readonly kind: "upstream"; readonly branch: Branch }
  | { readonly kind: "push-to"; readonly context: PushContext }
  | { readonly kind: "force-push"; readonly target: ForcePush }
  | { readonly kind: "push-tags"; readonly tags: ReadonlyArray<string> }
  | { readonly kind: "delete-tag"; readonly tag: Tag }
  | { readonly kind: "delete-remote"; readonly branch: RemoteBranch }
  | { readonly kind: "delete-tracking"; readonly branch: RemoteBranch }
  | { readonly kind: "add-worktree"; readonly branch: string }
  | { readonly kind: "remove-worktree"; readonly worktree: Worktree; readonly deleteBranch: boolean }
  | { readonly kind: "delete-branches"; readonly branches: ReadonlyArray<Branch> }
  | { readonly kind: "delete-remotes"; readonly branches: ReadonlyArray<RemoteBranch> }
  | { readonly kind: "delete-tags"; readonly tags: ReadonlyArray<Tag> }
  | { readonly kind: "cleanup-branches" }
  | { readonly kind: "cleanup-worktrees"; readonly preset: ReadonlySet<string> }

const moving: ReadonlyArray<ChangeScope> = ["refs", "worktree", "index"]

const unmerged = /doesn't contain|not fully merged/

export const localName = (branch: RemoteBranch) => branch.name.slice(branch.remote.length + 1)

const refName = (node: RefNode) => {
  switch (node.kind) {
    case "local":
      return `refs/heads/${node.name}`
    case "remote":
      return `refs/remotes/${node.name}`
    case "tag":
      return `refs/tags/${node.name}`
    case "worktree":
      return node.worktree.path
  }
}

export const createRefActions = (options: { onRenamed: (name: string) => void }) => {
  const repo = useRepo()
  const runner = createRunner()
  const [dialog, setDialog] = createSignal<Dialog | null>(null)
  const [bulkProgress, setBulkProgress] = createSignal<string | null>(null)
  const [bulkFailure, setBulkFailure] = createSignal<{
    readonly title: string
    readonly items: ReadonlyArray<Failed>
  } | null>(null)

  const head = () => {
    const value = repo.status().head
    return value._tag === "Branch" ? value.name : null
  }
  const unborn = () => repo.status().head._tag === "Unborn"
  const headLabel = () => head() ?? "HEAD"
  const busy = () => runner.running() || repo.network() !== null || bulkProgress() !== null

  const worktreeOf = (branch: string) =>
    repo
      .refs()
      .worktrees.find(
        (worktree) => worktree.head._tag === "Branch" && worktree.head.name === branch && worktree.path !== active(),
      )

  const isCurrent = (node: RefNode) =>
    (node.kind === "local" && node.name === head()) || (node.kind === "worktree" && node.worktree.path === active())

  const openable = (worktree: Worktree) =>
    worktree.path !== active() && worktree.head._tag !== "Bare" && worktree.prunable === null

  const open = (worktree: Worktree) => openRepo(worktree.path, active() ?? undefined)

  const openAll = (worktrees: ReadonlyArray<Worktree>) =>
    openRepos(
      worktrees.map((worktree) => worktree.path),
      active() ?? undefined,
    )

  const switchTo = (branch: string): Promise<boolean> =>
    runner.run({
      scopes: moving,
      request: (git) => git.Checkout({ repo: repo.id, branch }),
      failure: `Couldn't check out ${branch}`,
      recover: (error) => {
        const block = localChangesBlock(error)
        return block === null
          ? undefined
          : {
              label: "Stash changes and switch",
              run: () =>
                void runner.run({
                  scopes: moving,
                  request: (git) =>
                    Effect.andThen(
                      git.StashPush({
                        repo: repo.id,
                        message: `Before switching to ${branch}`,
                        includeUntracked: block.includeUntracked,
                        paths: null,
                        keepIndex: false,
                      }),
                      git.Checkout({ repo: repo.id, branch }),
                    ),
                  failure: `Couldn't stash and switch to ${branch}`,
                }),
            }
      },
    })

  const checkout = (node: RefNode) => {
    switch (node.kind) {
      case "local": {
        const elsewhere = worktreeOf(node.name)
        if (elsewhere !== undefined) return open(elsewhere)
        return switchTo(node.name)
      }
      case "remote":
        return switchTo(localName(node.branch))
      case "tag":
        return runner.run({
          scopes: moving,
          request: (git) => git.CheckoutDetached({ repo: repo.id, oid: node.tag.oid }),
          failure: `Couldn't check out ${node.name}`,
        })
      case "worktree":
        return openable(node.worktree) ? open(node.worktree) : undefined
    }
  }

  const merge = (ref: string) =>
    runner.run({
      scopes: moving,
      request: (git) => git.Merge({ repo: repo.id, ref }),
      failure: `Couldn't merge ${ref} into ${headLabel()}`,
    })

  const rebase = (onto: string) =>
    runner.run({
      scopes: moving,
      request: (git) => git.Rebase({ repo: repo.id, onto }),
      failure: `Couldn't rebase ${headLabel()} onto ${onto}`,
    })

  const choose = (context: PushContext) => {
    if (context.remotes.length === 0) runCommand("repo.remotes")
    else setDialog({ kind: "push-to", context })
  }

  const push = async (branch: string) => {
    runner.dismiss()
    const { failure, choose: next } = await pushBranch(repo, branch)
    runner.report(failure)
    if (next !== null) choose(next)
  }

  const pushTo = async (branch: string) => {
    runner.dismiss()
    const read = await readPushContext(repo, branch)
    if ("failure" in read) runner.report(read.failure)
    else choose(read.context)
  }

  const pushOne = async (branch: string) => {
    const read = await readPushContext(repo, branch)
    if ("failure" in read) return read.failure.message
    const plan = pushPlan(syncPreferences(repo.id), read.context)
    if (plan === null) return "It has no push destination yet. Push it on its own to pick one."
    const { outcome } = await sendPush(repo, read.context, plan.destination, plan.setUpstream)
    return outcome.ok ? null : outcome.message
  }

  const pushAll = async (branches: ReadonlyArray<string>) => {
    runner.dismiss()
    setBulkFailure(null)
    const failed: Array<Failed> = []
    for (const [index, name] of branches.entries()) {
      setBulkProgress(`Pushing ${index + 1} of ${branches.length}…`)
      const message = await pushOne(name)
      if (message !== null) failed.push({ name, message })
    }
    setBulkProgress(null)
    if (failed.length > 0)
      setBulkFailure({ title: `Couldn't push ${failed.length} of ${branches.length}`, items: failed })
  }

  const pushTags = (tags: ReadonlyArray<string>) => {
    if (repo.refs().remotes.length === 0) runCommand("repo.remotes")
    else setDialog({ kind: "push-tags", tags })
  }

  const remove = (branch: Branch) => {
    const worktree = worktreeOf(branch.name)
    if (worktree === undefined) setDialog({ kind: "delete-branch", branch })
    else setDialog({ kind: "remove-worktree", worktree, deleteBranch: true })
  }

  const compare = (node: RefNode) =>
    openCompare({ repo: repo.id, base: "HEAD", head: refName(node), mode: "merge-base" })

  return {
    repo,
    runner,
    dialog,
    setDialog,
    head,
    unborn,
    headLabel,
    busy,
    worktreeOf,
    isCurrent,
    openable,
    open,
    openAll,
    checkout,
    merge,
    rebase,
    push,
    pushTo,
    pushAll,
    bulkProgress,
    bulkFailure,
    dismissBulk: () => setBulkFailure(null),
    pushTags,
    remove,
    compare,
    onRenamed: options.onRenamed,
  }
}

export type RefActions = ReturnType<typeof createRefActions>

const item = "data-disabled:opacity-50"
const danger = "text-destructive data-disabled:opacity-50"

function Integrate(props: { actions: RefActions; ref: string }) {
  const actions = props.actions
  return (
    <>
      <MenuItem
        class={item}
        disabled={actions.unborn() || actions.busy()}
        onSelect={() => void actions.merge(props.ref)}
      >
        Merge into {actions.headLabel()}
      </MenuItem>
      <MenuItem
        class={item}
        disabled={actions.unborn() || actions.busy()}
        onSelect={() => void actions.rebase(props.ref)}
      >
        Rebase {actions.headLabel()} onto this
      </MenuItem>
    </>
  )
}

function CopyItem(props: { label: string; text: string }) {
  return <MenuItem onSelect={() => void navigator.clipboard.writeText(props.text)}>{props.label}</MenuItem>
}

function LocalItems(props: { actions: RefActions; node: Extract<RefNode, { kind: "local" }> }) {
  const actions = props.actions
  const name = () => props.node.name
  const current = () => name() === actions.head()
  const elsewhere = () => actions.worktreeOf(name())
  const force = () => forcePushTarget(actions.repo.refs(), name())
  return (
    <>
      <Show
        when={elsewhere()}
        fallback={
          <MenuItem
            class={item}
            disabled={current() || actions.busy()}
            onSelect={() => void actions.checkout(props.node)}
          >
            Check out
          </MenuItem>
        }
      >
        {(worktree) => (
          <MenuItem class={item} disabled={!actions.openable(worktree())} onSelect={() => actions.open(worktree())}>
            Open its worktree
            <MenuShortcut>{basename(worktree().path)}</MenuShortcut>
          </MenuItem>
        )}
      </Show>
      <MenuItem
        class={item}
        disabled={current() || elsewhere() !== undefined}
        onSelect={() => actions.setDialog({ kind: "add-worktree", branch: name() })}
      >
        Check out in new worktree…
      </MenuItem>
      <Show when={!current()}>
        <MenuSeparator />
        <Integrate actions={actions} ref={name()} />
      </Show>
      <MenuSeparator />
      <MenuItem class={item} disabled={actions.busy()} onSelect={() => void actions.push(name())}>
        Push
      </MenuItem>
      <MenuItem class={item} disabled={actions.busy()} onSelect={() => void actions.pushTo(name())}>
        Push to…
      </MenuItem>
      <MenuItem onSelect={() => actions.setDialog({ kind: "upstream", branch: props.node.branch })}>
        Change upstream…
      </MenuItem>
      <Show when={force()}>
        {(target) => (
          <MenuItem
            class={danger}
            disabled={actions.busy()}
            onSelect={() => actions.setDialog({ kind: "force-push", target: target() })}
          >
            Force push with lease…
            <MenuShortcut>{target().target}</MenuShortcut>
          </MenuItem>
        )}
      </Show>
      <MenuSeparator />
      <MenuItem onSelect={() => actions.setDialog({ kind: "rename", branch: props.node.branch })}>Rename…</MenuItem>
      <MenuItem onSelect={() => actions.compare(props.node)}>Compare with…</MenuItem>
      <CopyItem label="Copy name" text={name()} />
      <MenuSeparator />
      <MenuItem
        class={danger}
        disabled={current() || elsewhere()?.isMain === true}
        onSelect={() => actions.remove(props.node.branch)}
      >
        {elsewhere() === undefined ? "Delete…" : "Delete with its worktree…"}
      </MenuItem>
    </>
  )
}

function RemoteItems(props: { actions: RefActions; node: Extract<RefNode, { kind: "remote" }> }) {
  const actions = props.actions
  const local = () => localName(props.node.branch)
  const configured = () => actions.repo.refs().remotes.some((remote) => remote.name === props.node.branch.remote)
  return (
    <>
      <MenuItem class={item} disabled={actions.busy()} onSelect={() => void actions.checkout(props.node)}>
        Check out as {local()}
      </MenuItem>
      <MenuSeparator />
      <Integrate actions={actions} ref={props.node.name} />
      <MenuSeparator />
      <MenuItem onSelect={() => actions.compare(props.node)}>Compare with…</MenuItem>
      <CopyItem label="Copy name" text={props.node.name} />
      <MenuSeparator />
      <MenuItem
        class={danger}
        disabled={!configured() || actions.busy()}
        onSelect={() => actions.setDialog({ kind: "delete-remote", branch: props.node.branch })}
      >
        Delete on {props.node.branch.remote}…
      </MenuItem>
      <MenuItem
        class={danger}
        onSelect={() => actions.setDialog({ kind: "delete-tracking", branch: props.node.branch })}
      >
        Delete tracking reference…
      </MenuItem>
    </>
  )
}

function TagItems(props: { actions: RefActions; node: Extract<RefNode, { kind: "tag" }> }) {
  const actions = props.actions
  return (
    <>
      <MenuItem class={item} disabled={actions.busy()} onSelect={() => void actions.checkout(props.node)}>
        Check out detached
      </MenuItem>
      <MenuSeparator />
      <Integrate actions={actions} ref={props.node.name} />
      <MenuSeparator />
      <MenuItem class={item} disabled={actions.busy()} onSelect={() => actions.pushTags([props.node.name])}>
        Push tag…
      </MenuItem>
      <MenuItem onSelect={() => actions.compare(props.node)}>Compare with…</MenuItem>
      <CopyItem label="Copy name" text={props.node.name} />
      <MenuSeparator />
      <MenuItem class={danger} onSelect={() => actions.setDialog({ kind: "delete-tag", tag: props.node.tag })}>
        Delete…
      </MenuItem>
    </>
  )
}

function WorktreeItems(props: { actions: RefActions; worktree: Worktree }) {
  const actions = props.actions
  const current = () => props.worktree.path === active()
  return (
    <>
      <MenuItem class={item} disabled={!actions.openable(props.worktree)} onSelect={() => actions.open(props.worktree)}>
        Open in new tab
      </MenuItem>
      <CopyItem label="Copy path" text={props.worktree.path} />
      <MenuSeparator />
      <MenuItem onSelect={() => runCommand("repo.addWorktree")}>Add worktree…</MenuItem>
      <MenuItem onSelect={() => runCommand("repo.cleanupWorktrees")}>Clean up worktrees…</MenuItem>
      <MenuSeparator />
      <MenuItem
        class={danger}
        disabled={props.worktree.isMain || current()}
        onSelect={() => actions.setDialog({ kind: "remove-worktree", worktree: props.worktree, deleteBranch: false })}
      >
        Remove…
      </MenuItem>
    </>
  )
}

export function RefMenuItems(props: { actions: RefActions; node: RefNode }) {
  return (
    <Switch>
      <Match when={props.node.kind === "local" ? props.node : undefined}>
        {(node) => <LocalItems actions={props.actions} node={node()} />}
      </Match>
      <Match when={props.node.kind === "remote" ? props.node : undefined}>
        {(node) => <RemoteItems actions={props.actions} node={node()} />}
      </Match>
      <Match when={props.node.kind === "tag" ? props.node : undefined}>
        {(node) => <TagItems actions={props.actions} node={node()} />}
      </Match>
      <Match when={props.node.kind === "worktree" ? props.node.worktree : undefined}>
        {(worktree) => <WorktreeItems actions={props.actions} worktree={worktree()} />}
      </Match>
    </Switch>
  )
}

export function SectionMenuItems(props: { actions: RefActions; section: string }) {
  return (
    <Switch>
      <Match when={props.section === "section:local"}>
        <MenuItem onSelect={() => props.actions.setDialog({ kind: "cleanup-branches" })}>Clean up branches…</MenuItem>
      </Match>
      <Match when={props.section === "section:remotes" || props.section.startsWith("remote-group:")}>
        <MenuItem onSelect={() => runCommand("repo.fetch")}>Fetch</MenuItem>
        <MenuItem onSelect={() => runCommand("repo.remotes")}>Manage remotes…</MenuItem>
      </Match>
      <Match when={props.section === "section:tags"}>
        <MenuItem
          class={item}
          disabled={props.actions.busy()}
          onSelect={() => props.actions.pushTags(props.actions.repo.refs().tags.map((tag) => tag.name))}
        >
          Push tags…
        </MenuItem>
      </Match>
      <Match when={props.section === "section:worktrees"}>
        <MenuItem onSelect={() => runCommand("repo.addWorktree")}>Add worktree…</MenuItem>
        <MenuItem onSelect={() => runCommand("repo.cleanupWorktrees")}>Clean up worktrees…</MenuItem>
      </Match>
    </Switch>
  )
}

export const hasSectionMenu = (section: string) =>
  section === "section:local" ||
  section === "section:remotes" ||
  section.startsWith("remote-group:") ||
  section === "section:tags" ||
  section === "section:worktrees"

function ConfirmAction(props: {
  title: string
  description: string
  confirmLabel: string
  action: () => Promise<string | null>
  onClose: () => void
}) {
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const confirm = async () => {
    setPending(true)
    setError(null)
    const failure = await props.action()
    setPending(false)
    if (failure === null) props.onClose()
    else setError(failure)
  }
  return (
    <Confirm
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      title={props.title}
      description={props.description}
      error={error()}
      confirmLabel={props.confirmLabel}
      pending={pending()}
      onConfirm={() => void confirm()}
    />
  )
}

function DeleteBranchConfirm(props: { branch: Branch; onClose: () => void }) {
  const repo = useRepo()
  const [force, setForce] = createSignal(false)
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const remove = async () => {
    const name = props.branch.name
    const forced = force()
    setPending(true)
    try {
      await repo.mutate(["refs"], (git) =>
        git.DeleteBranch({ repo: repo.id, name, force: forced, removeWorktree: false }),
      )
      props.onClose()
    } catch (failure) {
      const message = describeError(failure)
      setError(message)
      if (!forced && unmerged.test(message)) setForce(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <Confirm
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      title={`Delete ${props.branch.name}?`}
      description={
        force()
          ? "Its commits aren't merged into HEAD or its upstream. Deleting it anyway leaves them reachable only from the reflog."
          : "This deletes the local branch. Commits that other branches or tags contain stay."
      }
      error={error()}
      confirmLabel={force() ? "Delete anyway" : "Delete"}
      pending={pending()}
      onConfirm={() => void remove()}
    />
  )
}

export function RefDialogs(props: { actions: RefActions }) {
  const actions = props.actions
  const repo = actions.repo
  const close = () => actions.setDialog(null)
  const attempt = async (work: () => Promise<unknown>) => {
    try {
      await work()
      return null
    } catch (error) {
      return describeError(error)
    }
  }

  return (
    <Show when={actions.dialog()} keyed>
      {(dialog) => (
        <Switch>
          <Match when={dialog.kind === "delete-branch" ? dialog : undefined}>
            {(current) => <DeleteBranchConfirm branch={current().branch} onClose={close} />}
          </Match>
          <Match when={dialog.kind === "rename" ? dialog : undefined}>
            {(current) => (
              <RenameBranchDialog
                branch={current().branch}
                onClose={close}
                onRenamed={(name) => {
                  close()
                  actions.onRenamed(name)
                }}
              />
            )}
          </Match>
          <Match when={dialog.kind === "upstream" ? dialog : undefined}>
            {(current) => <UpstreamDialog branch={current().branch} onClose={close} />}
          </Match>
          <Match when={dialog.kind === "push-to" ? dialog : undefined}>
            {(current) => (
              <PushToDialog
                context={current().context}
                saved={savedPushDestination(syncPreferences(repo.id), current().context)}
                refs={repo.refs()}
                pending={repo.network() === "push"}
                onPush={async (destination, setUpstream) => {
                  const { outcome, changed } = await sendPush(repo, current().context, destination, setUpstream)
                  if (outcome.ok) close()
                  else if (changed !== null) actions.setDialog({ kind: "push-to", context: changed })
                  return outcome
                }}
                onClose={close}
              />
            )}
          </Match>
          <Match when={dialog.kind === "force-push" ? dialog : undefined}>
            {(current) => <ForcePushConfirm repo={repo} target={current().target} onClose={close} />}
          </Match>
          <Match when={dialog.kind === "push-tags" ? dialog : undefined}>
            {(current) => (
              <PushTagsDialog
                refs={repo.refs()}
                initial={current().tags}
                pending={repo.network() === "push"}
                onPush={async (remote, tags) => {
                  const outcome = await repo.stream("push", (git) => git.PushTags({ repo: repo.id, remote, tags }))
                  if (outcome.ok) close()
                  return outcome
                }}
                onClose={close}
              />
            )}
          </Match>
          <Match when={dialog.kind === "delete-tag" ? dialog : undefined}>
            {(current) => (
              <ConfirmAction
                title={`Delete tag ${current().tag.name}?`}
                description="This deletes the local tag only. A copy you pushed to a remote stays there."
                confirmLabel="Delete tag"
                action={() =>
                  attempt(() =>
                    repo.mutate(["refs"], (git) => git.DeleteTag({ repo: repo.id, name: current().tag.name })),
                  )
                }
                onClose={close}
              />
            )}
          </Match>
          <Match when={dialog.kind === "delete-remote" ? dialog : undefined}>
            {(current) => (
              <ConfirmAction
                title={`Delete ${localName(current().branch)} on ${current().branch.remote}?`}
                description={`This deletes the branch on ${current().branch.remote} for everyone who uses it. Your local branches stay. Nothing is deleted if the branch changed on the remote since your last fetch.`}
                confirmLabel="Delete on remote"
                action={async () => {
                  const branch = current().branch
                  const outcome = await repo.stream("push", (git) =>
                    git.DeleteRemoteBranch({
                      repo: repo.id,
                      remote: branch.remote,
                      branch: localName(branch),
                      expected: branch.oid,
                    }),
                  )
                  return outcome.ok ? null : outcome.message
                }}
                onClose={close}
              />
            )}
          </Match>
          <Match when={dialog.kind === "delete-tracking" ? dialog : undefined}>
            {(current) => (
              <ConfirmAction
                title={`Delete the tracking reference ${current().branch.name}?`}
                description={
                  repo.refs().remotes.some((remote) => remote.name === current().branch.remote)
                    ? `This deletes your local copy of the reference only. The branch on ${current().branch.remote} stays, and the next fetch brings it back.`
                    : `No remote named ${current().branch.remote} is configured, so fetching won't bring this reference back.`
                }
                confirmLabel="Delete"
                action={() =>
                  attempt(() =>
                    repo.mutate(["refs"], (git) =>
                      git.DeleteRemoteTrackingBranch({ repo: repo.id, name: current().branch.name }),
                    ),
                  )
                }
                onClose={close}
              />
            )}
          </Match>
          <Match when={dialog.kind === "add-worktree" ? dialog : undefined}>
            {(current) => <AddWorktreeDialog open branch={current().branch} onOpenChange={(open) => open || close()} />}
          </Match>
          <Match when={dialog.kind === "delete-branches" ? dialog : undefined}>
            {(current) => <DeleteBranchesConfirm branches={current().branches} onClose={close} />}
          </Match>
          <Match when={dialog.kind === "delete-remotes" ? dialog : undefined}>
            {(current) => <DeleteRemotesConfirm branches={current().branches} onClose={close} />}
          </Match>
          <Match when={dialog.kind === "delete-tags" ? dialog : undefined}>
            {(current) => <DeleteTagsConfirm tags={current().tags} onClose={close} />}
          </Match>
          <Match when={dialog.kind === "cleanup-branches"}>
            <CleanupBranchesDialog open onOpenChange={(open) => open || close()} />
          </Match>
          <Match when={dialog.kind === "cleanup-worktrees" ? dialog : undefined}>
            {(current) => (
              <CleanupWorktreesDialog open preset={current().preset} onOpenChange={(open) => open || close()} />
            )}
          </Match>
          <Match when={dialog.kind === "remove-worktree" ? dialog : undefined}>
            {(current) => (
              <RemoveWorktreeDialog
                open
                worktree={current().worktree}
                deleteBranch={current().deleteBranch}
                onOpenChange={(open) => open || close()}
              />
            )}
          </Match>
        </Switch>
      )}
    </Show>
  )
}
