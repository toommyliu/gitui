import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/solid/tabs"
import type { JSX } from "@solidjs/web"
import { createEffect, createMemo, createSignal, For, Loading, Show } from "solid-js"
import { CommandScope, modHeld, shortcut, useCommand } from "@/lib/hotkeys"
import { RepoContext, type Repo } from "@/lib/repo"
import { active, OpenRepoFailed, type View, views, type Workspace, WorkspaceContext } from "@/lib/workspaces"
import { BranchPicker, headName } from "./branch-picker"
import { BranchesView } from "./branches"
import { CommitRecovery } from "./commits/recovery"
import { ChangesView } from "./changes"
import { CompareLauncher } from "./compare/compare-launcher"
import { FileHistoryLauncher } from "./file-history/file-history-launcher"
import { WorktreeLauncher } from "./worktrees/worktree-launcher"
import { HistoryView } from "./history"
import { IdentityDialog } from "./remote/identity"
import { NetworkButtons } from "./remote/network"
import { RemotesDialog } from "./remote/remotes"
import { OpenFailure } from "./open-failure"
import { OpenInButton } from "./open-in"
import { Boundary } from "./state"
import { StashesView } from "./stashes"
import { TopBar } from "./top-bar"
import { Count, type Failure, Failures, Kbd } from "./ui"

const viewLabels: Record<View, string> = {
  changes: "Changes",
  history: "History",
  branches: "Branches",
  stashes: "Stashes",
}

function Header(props: { workspace: Workspace; repo: Repo; onFailure: (failure: Failure | null) => void }) {
  const status = () => props.repo.status()
  const count = (view: View) => {
    if (view === "changes") return status().entries.length
    if (view === "stashes") return props.repo.refs().stashes.length
    return 0
  }
  createEffect(
    () => `${props.workspace.info().name} · ${headName(status())} · ${viewLabels[props.workspace.view()]}`,
    (title) => {
      document.title = title
    },
  )
  return (
    <TopBar>
      <div class="ms-0.5 flex min-w-0 shrink items-center gap-0.5">
        <span class="text-xs text-muted-foreground">/</span>
        <BranchPicker repo={props.repo} />
        <Show when={status().operation}>
          {(operation) => (
            <span class="ms-1 rounded bg-change-modified/15 px-1.5 text-2xs font-medium text-change-modified">
              {operation()} in progress
            </span>
          )}
        </Show>
      </div>
      <TabsList aria-label="Views" class="flex items-center gap-0.5 border-s ps-2">
        {views.map((view) => (
          <TabsTab
            value={view}
            class="flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground data-selected:bg-muted data-selected:font-medium data-selected:text-foreground"
          >
            {viewLabels[view]}
            <Show
              when={modHeld()}
              fallback={
                <Loading>
                  <Count value={count(view)} />
                </Loading>
              }
            >
              <Kbd>{shortcut(`view.${view}`)}</Kbd>
            </Show>
          </TabsTab>
        ))}
      </TabsList>
      <div class="flex-1" />
      <OpenInButton repo={props.repo.id} onFailure={props.onFailure} />
      <NetworkButtons repo={props.repo} onFailure={props.onFailure} />
    </TopBar>
  )
}

const viewComponents: Record<View, (workspace: Workspace) => JSX.Element> = {
  changes: (workspace) => <ChangesView focused={workspace.focused()} />,
  history: (workspace) => <HistoryView focused={workspace.focused()} revealed={workspace.revealed()} />,
  branches: (workspace) => <BranchesView focused={workspace.focused()} />,
  stashes: (workspace) => <StashesView focused={workspace.focused()} />,
}

const isView = (value: string | null): value is View => views.some((view) => view === value)

function Ready(props: { workspace: Workspace; repo: Repo }) {
  const [failure, setFailure] = createSignal<Failure | null>(null)
  const scope = () => active() === props.workspace.path
  const visited = createMemo((previous: ReadonlySet<View> = new Set()) =>
    previous.has(props.workspace.view()) ? previous : new Set([...previous, props.workspace.view()]),
  )
  for (const view of views) useCommand(`view.${view}`, () => props.workspace.setView(view))
  useCommand(
    "view.back",
    () => props.workspace.setFocused(false),
    () => props.workspace.focused(),
  )
  return (
    <WorkspaceContext value={props.workspace}>
      <RepoContext value={props.repo}>
        <CommandScope value={scope}>
          <Tabs
            value={props.workspace.view()}
            onValueChange={(value) => isView(value) && props.workspace.setView(value)}
            class="relative flex h-full min-h-0 flex-col"
          >
            <Show when={scope()}>
              <Header workspace={props.workspace} repo={props.repo} onFailure={setFailure} />
            </Show>
            <Failures failure={failure()} onDismiss={() => setFailure(null)} />
            <CommitRecovery />
            <For each={views}>
              {(view) => (
                <TabsPanel value={view} keepMounted class="min-h-0 flex-1 outline-none">
                  <Show when={visited().has(view)}>
                    <CommandScope value={() => scope() && props.workspace.view() === view}>
                      <Boundary label={`Reading ${viewLabels[view].toLowerCase()}`}>
                        {viewComponents[view](props.workspace)}
                      </Boundary>
                    </CommandScope>
                  </Show>
                </TabsPanel>
              )}
            </For>
            <CompareLauncher />
            <FileHistoryLauncher />
            <WorktreeLauncher />
          </Tabs>
          <RemotesDialog />
          <IdentityDialog />
        </CommandScope>
      </RepoContext>
    </WorkspaceContext>
  )
}

export function WorkspaceView(props: { workspace: Workspace }) {
  return (
    <Boundary
      label="Opening repository"
      failure={(error, reset) =>
        error instanceof OpenRepoFailed ? (
          <OpenFailure workspace={props.workspace} error={error.reason} reset={reset} />
        ) : undefined
      }
    >
      <Show when={props.workspace.repo()} keyed>
        {(repo) => <Ready workspace={props.workspace} repo={repo} />}
      </Show>
    </Boundary>
  )
}
