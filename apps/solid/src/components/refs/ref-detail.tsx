import { Menu, MenuContent, MenuTrigger } from "@ui-sdk/solid/menu"
import { Match, Show, Switch } from "solid-js"
import { More } from "../icons"
import { Bar, Button, CopyHash, Failures } from "../ui"
import { type RefActions, RefMenuItems, localName } from "./actions"
import { AheadBehind } from "./ahead-behind"
import { type RefNode, worktreeHead } from "./model"

function Sha(props: { oid: string }) {
  return <CopyHash oid={props.oid} />
}

function Facts(props: { node: RefNode }) {
  return (
    <Switch>
      <Match when={props.node.kind === "local" ? props.node.branch : undefined}>
        {(branch) => (
          <>
            <Show
              when={branch().upstream}
              fallback={<span class="shrink-0 text-2xs text-muted-foreground">No upstream</span>}
            >
              {(upstream) => (
                <span class="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
                  <span class="truncate">{upstream().name}</span>
                  <AheadBehind upstream={upstream()} />
                </span>
              )}
            </Show>
            <Sha oid={branch().oid} />
          </>
        )}
      </Match>
      <Match when={props.node.kind === "remote" ? props.node.branch : undefined}>
        {(branch) => <Sha oid={branch().oid} />}
      </Match>
      <Match when={props.node.kind === "tag" ? props.node.tag : undefined}>{(tag) => <Sha oid={tag().oid} />}</Match>
      <Match when={props.node.kind === "worktree" ? props.node.worktree : undefined}>
        {(worktree) => (
          <>
            <span class="shrink-0 text-2xs text-muted-foreground">{worktreeHead(worktree())}</span>
            <span class="min-w-0 truncate text-2xs text-muted-foreground select-text">{worktree().path}</span>
          </>
        )}
      </Match>
    </Switch>
  )
}

function MoreMenu(props: { actions: RefActions; node: RefNode }) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="More actions"
        class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-open:bg-muted"
      >
        <More />
      </MenuTrigger>
      <MenuContent align="end" sideOffset={4} class="min-w-56">
        <RefMenuItems actions={props.actions} node={props.node} />
      </MenuContent>
    </Menu>
  )
}

export function RefDetail(props: { node: RefNode; actions: RefActions }) {
  const actions = props.actions
  const current = () => actions.isCurrent(props.node)
  const integrate = (ref: string) => (
    <>
      <Button disabled={actions.unborn() || actions.busy()} onClick={() => void actions.merge(ref)}>
        Merge into {actions.headLabel()}
      </Button>
      <Button disabled={actions.unborn() || actions.busy()} onClick={() => void actions.rebase(ref)}>
        Rebase {actions.headLabel()} onto this
      </Button>
    </>
  )

  return (
    <>
      <Bar class="gap-2">
        <Show when={current()}>
          <span class="shrink-0 rounded-sm bg-primary/15 px-1 text-2xs font-medium text-primary">
            {props.node.kind === "worktree" ? "Open" : "Current"}
          </span>
        </Show>
        <span class="min-w-0 shrink truncate font-mono font-medium select-text">{props.node.name}</span>
        <Facts node={props.node} />
        <div class="flex-1" />
        <div class="flex shrink-0 items-center gap-1.5">
          <Switch>
            <Match when={props.node.kind === "local" ? props.node : undefined}>
              {(node) => (
                <>
                  <Show when={!current()}>
                    <Show
                      when={actions.worktreeOf(node().name)}
                      fallback={
                        <Button
                          variant="primary"
                          disabled={actions.busy()}
                          onClick={() => void actions.checkout(node())}
                        >
                          Check out
                        </Button>
                      }
                    >
                      {(worktree) => (
                        <Button
                          variant="primary"
                          disabled={!actions.openable(worktree())}
                          onClick={() => actions.open(worktree())}
                        >
                          Open its worktree
                        </Button>
                      )}
                    </Show>
                    {integrate(node().name)}
                  </Show>
                  <Button disabled={actions.busy()} onClick={() => void actions.push(node().name)}>
                    Push
                  </Button>
                  <Show when={!current() && actions.worktreeOf(node().name)?.isMain !== true}>
                    <Button variant="danger" onClick={() => actions.remove(node().branch)}>
                      Delete…
                    </Button>
                  </Show>
                </>
              )}
            </Match>
            <Match when={props.node.kind === "remote" ? props.node : undefined}>
              {(node) => (
                <>
                  <Button variant="primary" disabled={actions.busy()} onClick={() => void actions.checkout(node())}>
                    Check out as {localName(node().branch)}
                  </Button>
                  {integrate(node().name)}
                </>
              )}
            </Match>
            <Match when={props.node.kind === "tag" ? props.node : undefined}>
              {(node) => (
                <>
                  <Button variant="primary" disabled={actions.busy()} onClick={() => void actions.checkout(node())}>
                    Check out detached
                  </Button>
                  {integrate(node().name)}
                  <Button disabled={actions.busy()} onClick={() => actions.pushTags([node().name])}>
                    Push…
                  </Button>
                </>
              )}
            </Match>
            <Match when={props.node.kind === "worktree" ? props.node.worktree : undefined}>
              {(worktree) => (
                <Show when={!current()}>
                  <Button
                    variant="primary"
                    disabled={!actions.openable(worktree())}
                    onClick={() => actions.open(worktree())}
                  >
                    Open
                  </Button>
                  <Show when={!worktree().isMain}>
                    <Button
                      variant="danger"
                      onClick={() =>
                        actions.setDialog({ kind: "remove-worktree", worktree: worktree(), deleteBranch: false })
                      }
                    >
                      Remove…
                    </Button>
                  </Show>
                </Show>
              )}
            </Match>
          </Switch>
          <MoreMenu actions={actions} node={props.node} />
        </div>
      </Bar>
      <Failures failure={actions.runner.failure()} onDismiss={actions.runner.dismiss} />
    </>
  )
}
