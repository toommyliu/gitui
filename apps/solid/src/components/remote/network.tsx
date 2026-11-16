import type { PullStrategy, PushContext, PushDestination } from "@gitui/contracts"
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@ui-sdk/solid/menu"
import { createMemo, createSignal, For, Loading, Show } from "solid-js"
import { runCommand, shortcut, useCommand } from "@/lib/hotkeys"
import type { Network, Outcome, Repo } from "@/lib/repo"
import { pushPlan, savedPushDestination, syncPreferences, updateSyncPreferences } from "@/lib/sync-preferences"
import { ArrowDown, ArrowUp, Check, ChevronDown, Refresh } from "../icons"
import { Spinner } from "../state"
import { Button, Count, type Failure, Tip } from "../ui"
import { ForcePushConfirm } from "./force-push"
import { type ForcePush, forcePushTarget, loadPushContext, pushBranch, readPushContext, sendPush } from "./push"
import { PushTagsDialog } from "./push-tags"
import { PushToDialog } from "./push-to"

const strategies: ReadonlyArray<PullStrategy> = ["ff-only", "merge", "rebase", "configured"]

const strategyLabels: Record<PullStrategy, string> = {
  "ff-only": "Fast-forward only",
  merge: "Merge",
  rebase: "Rebase",
  configured: "Use Git configuration",
}

const splitTrigger =
  "-ms-px inline-flex h-6 shrink-0 items-center rounded-e-md border bg-background px-1 text-muted-foreground hover:bg-muted hover:text-foreground data-open:bg-muted data-open:text-foreground aria-disabled:opacity-50 aria-disabled:hover:bg-background disabled:opacity-50"

export function NetworkButtons(props: { repo: Repo; onFailure: (failure: Failure | null) => void }) {
  const running = () => props.repo.network()
  const [pullMenu, setPullMenu] = createSignal(false)
  const [pushTo, setPushTo] = createSignal<PushContext | null>(null)
  const [pushTags, setPushTags] = createSignal(false)
  const [force, setForce] = createSignal<ForcePush | null>(null)
  const repo = () => props.repo.id
  const status = () => props.repo.status()
  const upstream = () => status().upstream
  const branch = () => {
    const head = status().head
    return head._tag === "Branch" ? head.name : null
  }
  const strategy = () => syncPreferences(repo()).pullStrategy

  const report = (title: string, outcome: Outcome) => {
    if (!outcome.ok) props.onFailure({ title, message: outcome.message })
  }

  const tracking = () => props.repo.refs().branches.find((candidate) => candidate.name === branch())?.upstream ?? null

  const pullBlocked = () => {
    const current = tracking()
    if (branch() === null) return "Check out a branch to pull"
    if (current === null) return "This branch has no upstream to pull from"
    if (current._tag === "Gone") return `${current.name} no longer exists on the remote`
    return null
  }
  const pushBlocked = () => (branch() === null ? "Check out a branch to push" : null)

  const forceTarget = (): ForcePush | null => {
    const name = branch()
    return name === null ? null : forcePushTarget(props.repo.refs(), name)
  }

  const pushContext = createMemo(() => {
    props.repo.track("refs")
    const name = branch()
    return name === null ? null : loadPushContext(props.repo, name).catch(() => null)
  })

  const pushTarget = () => {
    const context = pushContext()
    const plan = context === null ? null : pushPlan(syncPreferences(repo()), context)
    return plan === null ? null : `${plan.destination.remote}/${plan.destination.remoteBranch}`
  }

  const fetch = async () => {
    props.onFailure(null)
    report("Fetch failed", await props.repo.stream("fetch", (git) => git.Fetch({ repo: repo() })))
  }

  const pull = async (next: PullStrategy) => {
    const name = branch()
    const current = tracking()
    if (name === null || current === null || current._tag === "Gone") return
    updateSyncPreferences(repo(), (stored) => ({ ...stored, pullStrategy: next }))
    props.onFailure(null)
    report(
      "Pull failed",
      await props.repo.stream("pull", (git) =>
        git.Pull({ repo: repo(), strategy: next, target: { branch: name, upstream: current.ref } }),
      ),
    )
  }

  const choosePushDestination = (context: PushContext) => {
    if (context.remotes.length === 0) runCommand("repo.remotes")
    else setPushTo(context)
  }

  const push = async () => {
    const name = branch()
    if (name === null || running() !== null) return
    props.onFailure(null)
    const { failure, choose } = await pushBranch(props.repo, name)
    props.onFailure(failure)
    if (choose !== null) choosePushDestination(choose)
  }

  const openPushTo = async () => {
    const name = branch()
    if (name === null) return
    props.onFailure(null)
    const read = await readPushContext(props.repo, name)
    if ("failure" in read) props.onFailure(read.failure)
    else choosePushDestination(read.context)
  }

  const pushToDestination = async (context: PushContext, destination: PushDestination, setUpstream: boolean) => {
    const { outcome, changed } = await sendPush(props.repo, context, destination, setUpstream)
    if (outcome.ok) setPushTo(null)
    else if (changed !== null) setPushTo(changed)
    return outcome
  }

  const openPushTags = () => {
    if (props.repo.refs().remotes.length === 0) runCommand("repo.remotes")
    else setPushTags(true)
  }

  const pushTagsTo = async (remote: string, tags: ReadonlyArray<string>) => {
    const outcome = await props.repo.stream("push", (git) => git.PushTags({ repo: repo(), remote, tags }))
    if (outcome.ok) setPushTags(false)
    return outcome
  }

  const openForcePush = () => setForce(forceTarget())

  useCommand("repo.fetch", () => void fetch())
  useCommand("repo.pull", () => void pull(strategy()))
  useCommand(
    "repo.pullWith",
    () => setPullMenu(true),
    () => running() === null && pullBlocked() === null,
  )
  useCommand("repo.push", () => void push())
  useCommand(
    "repo.pushTo",
    () => void openPushTo(),
    () => running() === null && branch() !== null,
  )
  useCommand("repo.pushTags", openPushTags, () => running() === null)

  const busy = (kind: Network) => running() === kind
  return (
    <div class="flex items-center gap-1">
      <Button variant="ghost" aria-label="Fetch" disabled={running() !== null} onClick={() => void fetch()}>
        <Show
          when={busy("fetch")}
          fallback={
            <span class="flex @[50rem]/top:hidden">
              <Refresh />
            </span>
          }
        >
          <Spinner />
        </Show>
        <span class="hidden @[50rem]/top:inline">Fetch</span>
      </Button>
      <div class="flex items-center">
        <Tip
          label={pullBlocked() ?? `Pull from ${upstream()?.name ?? "the upstream"} · ${strategyLabels[strategy()]}`}
          keys={shortcut("repo.pull")}
        >
          {(trigger) => (
            <Button
              {...trigger}
              aria-label="Pull"
              class="rounded-e-none"
              disabled={running() !== null || pullBlocked() !== null}
              focusableWhenDisabled
              onClick={() => void pull(strategy())}
            >
              {busy("pull") ? <Spinner /> : <ArrowDown />}
              <span class="hidden @[50rem]/top:inline">Pull</span>
              <Count value={upstream()?.behind ?? 0} />
            </Button>
          )}
        </Tip>
        <Menu open={pullMenu()} onOpenChange={(open) => setPullMenu(open)}>
          <MenuTrigger
            aria-label="Pull options"
            disabled={running() !== null || pullBlocked() !== null}
            focusableWhenDisabled
            class={splitTrigger}
          >
            <ChevronDown />
          </MenuTrigger>
          <MenuContent align="end" sideOffset={4} class="min-w-48">
            <MenuGroup>
              <MenuGroupLabel>Pull with</MenuGroupLabel>
              <For each={strategies}>
                {(choice) => (
                  <MenuItem onSelect={() => void pull(choice)}>
                    <span class="flex w-3 shrink-0 justify-center">
                      <Show when={choice === strategy()}>
                        <Check class="size-3 shrink-0" />
                      </Show>
                    </span>
                    {strategyLabels[choice]}
                  </MenuItem>
                )}
              </For>
            </MenuGroup>
          </MenuContent>
        </Menu>
      </div>
      <div class="flex items-center">
        <Tip
          label={
            pushBlocked() ?? (
              <Loading fallback={`Push ${branch()}`}>
                {pushTarget() === null ? `Choose where to push ${branch()}` : `Push to ${pushTarget()}`}
              </Loading>
            )
          }
          keys={shortcut("repo.push")}
        >
          {(trigger) => (
            <Button
              {...trigger}
              aria-label="Push"
              class="rounded-e-none"
              disabled={running() !== null || pushBlocked() !== null}
              focusableWhenDisabled
              onClick={() => void push()}
            >
              {busy("push") ? <Spinner /> : <ArrowUp />}
              <span class="hidden @[50rem]/top:inline">Push</span>
              <Count value={upstream()?.ahead ?? 0} />
            </Button>
          )}
        </Tip>
        <Menu>
          <MenuTrigger
            aria-label="Push options"
            disabled={running() !== null}
            focusableWhenDisabled
            class={splitTrigger}
          >
            <ChevronDown />
          </MenuTrigger>
          <MenuContent align="end" sideOffset={4} class="min-w-56">
            <MenuItem disabled={branch() === null} onSelect={() => void openPushTo()}>
              Push to…
              <Show when={branch() === null}>
                <MenuShortcut>No branch</MenuShortcut>
              </Show>
            </MenuItem>
            <MenuItem onSelect={openPushTags}>
              Push tags…
              <MenuShortcut>
                {props.repo.refs().tags.length === 1 ? "1 tag" : `${props.repo.refs().tags.length} tags`}
              </MenuShortcut>
            </MenuItem>
            <MenuSeparator />
            <MenuItem destructive disabled={forceTarget() === null} onSelect={openForcePush}>
              Force push with lease…
              <MenuShortcut>{forceTarget()?.target ?? "No upstream"}</MenuShortcut>
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <Show when={pushTo()}>
        {(context) => (
          <PushToDialog
            context={context()}
            saved={savedPushDestination(syncPreferences(repo()), context())}
            refs={props.repo.refs()}
            pending={busy("push")}
            onPush={(destination, setUpstream) => pushToDestination(context(), destination, setUpstream)}
            onClose={() => setPushTo(null)}
          />
        )}
      </Show>
      <Show when={pushTags()}>
        <PushTagsDialog
          refs={props.repo.refs()}
          pending={busy("push")}
          onPush={pushTagsTo}
          onClose={() => setPushTags(false)}
        />
      </Show>
      <ForcePushConfirm repo={props.repo} target={force()} onClose={() => setForce(null)} />
    </div>
  )
}
