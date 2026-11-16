import { type CommitDetail, Oid, type RepoId } from "@gitui/contracts"
import type { JSX } from "@solidjs/web"
import { createHoverCardController, HoverCard, HoverCardContent, HoverCardTrigger } from "@ui-sdk/solid/hover-card"
import { createEffect, createMemo, createSignal, For, Loading, Show, useContext } from "solid-js"
import { splitMentions } from "@/lib/commit-mentions"
import { call } from "@/lib/rpc"
import { type Workspace, WorkspaceContext } from "@/lib/workspaces"
import { Avatar } from "./avatar"
import { Spinner } from "./state"
import { Button, CopyHash } from "./ui"
import { listDate } from "@/lib/dates"

const lookups = new Map<string, Promise<CommitDetail | null>>()

const lookup = (repo: RepoId, hash: string) => {
  const key = `${repo}:${hash}`
  const existing = lookups.get(key)
  if (existing !== undefined) return existing
  const request = call((git) => git.GetCommit({ repo, oid: Oid.make(hash) })).then(
    (detail) => detail,
    () => null,
  )
  lookups.set(key, request)
  return request
}

function Card(props: { detail: CommitDetail | null; hash: string; onShow: (oid: Oid) => void }) {
  return (
    <Show
      when={props.detail}
      fallback={<p class="px-1.5 py-1 text-muted-foreground">No commit matches {props.hash} in this repository.</p>}
    >
      {(detail) => (
        <div class="flex flex-col gap-2 p-1.5">
          <p class="line-clamp-2 leading-snug font-medium text-pretty">{detail().message.split("\n")[0]}</p>
          <div class="flex min-w-0 items-center gap-2">
            <Avatar person={detail().author} layer={0} large />
            <div class="flex min-w-0 flex-col text-2xs">
              <span class="truncate font-medium">{detail().author.name}</span>
              <span class="text-muted-foreground tabular-nums">
                {listDate(detail().author.time)} ·{" "}
                {detail().files.length === 1 ? "1 file" : `${detail().files.length} files`}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <CopyHash oid={detail().oid} />
            <div class="flex-1" />
            <Button variant="ghost" onClick={() => props.onShow(detail().oid)}>
              Show in history
            </Button>
          </div>
        </div>
      )}
    </Show>
  )
}

interface Target {
  readonly workspace: Workspace
  readonly hash: string
}

const card = createHoverCardController<Target>()

function Preview(props: { target: Target }) {
  const detail = createMemo(() => lookup(props.target.workspace.info().id, props.target.hash))
  const show = (oid: Oid) => {
    void card.close()
    props.target.workspace.reveal(oid)
  }
  return (
    <Loading
      fallback={
        <div class="flex h-16 items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <Card detail={detail()} hash={props.target.hash} onShow={show} />
    </Loading>
  )
}

export function CommitPreviewCard() {
  return (
    <HoverCard controller={card} delay={350} closeDelay={150}>
      <HoverCardContent<Target> side="bottom" align="start" sideOffset={4} class="w-80">
        {(state) => (
          <Show when={state.payload} keyed>
            {(target) => <Preview target={target} />}
          </Show>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

export function CommitMention(props: {
  workspace: Workspace
  hash: string
  class: string
  children: JSX.Element
  onPress?: ((oid: Oid) => void) | undefined
}) {
  const target = createMemo((): Target => ({ workspace: props.workspace, hash: props.hash }))
  const press = () =>
    void lookup(props.workspace.info().id, props.hash).then((found) => {
      if (found === null) return
      void card.close()
      if (props.onPress === undefined) props.workspace.reveal(found.oid)
      else props.onPress(found.oid)
    })
  return (
    <HoverCardTrigger
      controller={card}
      payload={target()}
      onClick={press}
      render={(trigger) => (
        <button {...trigger} type="button" class={props.class}>
          {props.children}
        </button>
      )}
    />
  )
}

function Mention(props: { workspace: Workspace; hash: string }) {
  const [found, setFound] = createSignal(false)
  createEffect(
    () => ({ repo: props.workspace.info().id, hash: props.hash }),
    ({ repo, hash }) => {
      let current = true
      void lookup(repo, hash).then((detail) => current && setFound(detail !== null))
      return () => {
        current = false
      }
    },
  )
  return (
    <Show when={found()} fallback={props.hash}>
      <CommitMention
        workspace={props.workspace}
        hash={props.hash}
        class="rounded-sm font-mono text-[0.95em] text-foreground underline decoration-current/40 decoration-dotted underline-offset-2 select-text hover:decoration-solid data-open:decoration-solid"
      >
        {props.hash}
      </CommitMention>
    </Show>
  )
}

export function Prose(props: { text: string }) {
  const workspace = useContext(WorkspaceContext)
  const parts = createMemo(() => splitMentions(props.text))
  return (
    <For each={parts()}>
      {(part) => (
        <Show when={workspace !== null && part.kind === "hash" ? workspace : null} fallback={part.text}>
          {(current) => <Mention workspace={current()} hash={part.text} />}
        </Show>
      )}
    </For>
  )
}
