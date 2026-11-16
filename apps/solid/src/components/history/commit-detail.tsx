import type { CommitDetail as Detail, FileDiff, Oid } from "@gitui/contracts"
import type { JSX } from "@solidjs/web"
import { Menu, MenuContent, MenuTrigger } from "@ui-sdk/solid/menu"
import { For, Show, useContext } from "solid-js"
import { shortOid } from "@/lib/format"
import { FilesPane } from "../files-pane"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/solid/popover"
import { Check, Copy, More } from "../icons"
import { CopyHash, createCopy } from "../ui"
import { type Person, splitCoAuthors } from "@/lib/trailers"
import { WorkspaceContext } from "@/lib/workspaces"
import { Avatar } from "../avatar"
import { CommitMention, Prose } from "../commit-mention"
import { detailDate } from "@/lib/dates"

const pill = "inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-2xs hover:bg-muted"

const listNames = (people: ReadonlyArray<Person>) => {
  if (people.length <= 2) return people.map((person) => person.name).join(" and ")
  return `${people[0]?.name ?? ""} and ${people.length - 1} others`
}

interface Role {
  readonly person: Person
  readonly role: string
}

function People(props: { detail: Detail; coAuthors: ReadonlyArray<Person> }) {
  const { copied, copy } = createCopy()
  const author = () => props.detail.author
  const committer = () => props.detail.committer
  const roles = (): ReadonlyArray<Role> => [
    { person: author(), role: "Author" },
    ...props.coAuthors.map((person) => ({ person, role: "Co-author" })),
    ...(committer().email === author().email ? [] : [{ person: committer(), role: "Committer" }]),
  ]
  return (
    <Popover>
      <PopoverTrigger class="-mx-1 flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-start [--avatar-ring:var(--background)] hover:bg-muted hover:[--avatar-ring:var(--muted)] data-open:bg-muted data-open:[--avatar-ring:var(--muted)]">
        <span class="flex shrink-0 items-center">
          <Avatar person={author()} layer={4} />
          <For each={props.coAuthors.slice(0, 3)}>
            {(person, index) => <Avatar person={person} layer={3 - index()} class="-ms-1.5" />}
          </For>
        </span>
        <span class="min-w-0 truncate text-xs">
          <span class="font-medium text-foreground">{author().name}</span>
          <Show when={props.coAuthors.length > 0}>
            <span class="text-muted-foreground"> with {listNames(props.coAuthors)}</span>
          </Show>
        </span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={4} class="w-80 p-1">
        <PopoverTitle class="sr-only">People on this commit</PopoverTitle>
        <For each={roles()}>
          {(entry) => (
            <div class="flex items-center gap-2 rounded px-1.5 py-1">
              <Avatar person={entry.person} layer={0} large />
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="flex min-w-0 items-baseline gap-1.5 text-xs">
                  <span class="truncate font-medium">{entry.person.name}</span>
                  <span class="shrink-0 text-2xs text-muted-foreground">{entry.role}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Copy ${entry.person.email}`}
                  class={[
                    "flex max-w-full min-w-0 items-center gap-1 self-start text-2xs",
                    copied() === entry.person.email
                      ? "text-change-added"
                      : "text-muted-foreground hover:text-foreground",
                  ]}
                  onClick={() => void copy(entry.person.email)}
                >
                  <span class="truncate">{entry.person.email}</span>
                  {copied() === entry.person.email ? <Check class="size-3 shrink-0" /> : <Copy />}
                </button>
              </div>
            </div>
          )}
        </For>
      </PopoverContent>
    </Popover>
  )
}

export function CommitMenuButton(props: { menu: () => JSX.Element }) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Commit actions"
        class="-me-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground data-open:bg-muted data-open:text-foreground"
      >
        <More />
      </MenuTrigger>
      <MenuContent align="end" sideOffset={4} class="min-w-60">
        {props.menu()}
      </MenuContent>
    </Menu>
  )
}

export function CopySlot(props: { oid: Oid }) {
  return (
    <span data-copy={props.oid} class="contents">
      <CopyHash oid={props.oid} />
    </span>
  )
}

function Header(props: { detail: Detail; onSelectCommit: (oid: Oid) => void; menu: () => JSX.Element }) {
  const workspace = useContext(WorkspaceContext)
  const author = () => props.detail.author
  const split = () => splitCoAuthors(props.detail.message, author())
  const lines = () => split().message.split("\n")
  const body = () => lines().slice(1).join("\n").trim()
  return (
    <div class="flex max-h-[45%] shrink-0 flex-col gap-1.5 overflow-y-auto border-b px-3 py-2.5">
      <h2 class="text-sm leading-5 font-semibold text-pretty select-text">
        <Prose text={lines()[0] ?? ""} />
      </h2>
      <Show when={body() !== ""}>
        <p class="text-xs leading-normal whitespace-pre-wrap text-muted-foreground select-text">
          <Prose text={body()} />
        </p>
      </Show>
      <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
        <People detail={props.detail} coAuthors={split().coAuthors} />
        <time class="whitespace-nowrap tabular-nums" datetime={new Date(author().time * 1000).toISOString()}>
          {detailDate(author().time)}
        </time>
        <div class="flex-1" />
        <CopySlot oid={props.detail.oid} />
        <Show when={props.detail.parents.length > 0}>
          <span class="flex items-center gap-1">
            {props.detail.parents.length === 1 ? "Parent" : "Parents"}
            <For each={props.detail.parents}>
              {(parent) => (
                <Show
                  when={workspace}
                  fallback={
                    <button type="button" class={pill} onClick={() => props.onSelectCommit(parent)}>
                      {shortOid(parent)}
                    </button>
                  }
                >
                  {(current) => (
                    <CommitMention
                      workspace={current()}
                      hash={parent}
                      class={[pill, "data-open:bg-muted"].join(" ")}
                      onPress={props.onSelectCommit}
                    >
                      {shortOid(parent)}
                    </CommitMention>
                  )}
                </Show>
              )}
            </For>
          </span>
        </Show>
        <CommitMenuButton menu={props.menu} />
      </div>
    </div>
  )
}

export function CommitDetail(props: {
  detail: Detail
  diff: FileDiff
  onShowLarge: () => void
  onSelectCommit: (oid: Oid) => void
  menu: () => JSX.Element
}) {
  return (
    <div class="flex h-full min-h-0 flex-col">
      <Header detail={props.detail} onSelectCommit={props.onSelectCommit} menu={props.menu} />
      <FilesPane
        section="commit"
        files={props.detail.files}
        diff={props.diff}
        empty="This commit changes no files"
        onShowLarge={props.onShowLarge}
      />
    </div>
  )
}
