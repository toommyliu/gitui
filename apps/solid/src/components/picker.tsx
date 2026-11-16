import type { DirectoryEntry, DirectoryListing } from "@gitui/contracts"
import { Command, CommandInput, CommandItem, CommandList } from "@ui-sdk/solid/command"
import { fuzzyScore } from "@ui-sdk/solid/text-match"
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js"
import type { JSX } from "@solidjs/web"
import { desktop } from "@/lib/desktop"
import { basename, dirname } from "@/lib/format"
import { chordOf, formatChord, shortcut } from "@/lib/hotkeys"
import { forget, pinned, recent, togglePin } from "@/lib/places"
import { call } from "@/lib/rpc"
import { openFolders, openRepo, paths } from "@/lib/workspaces"
import { ChevronRight, Folder, FolderGit, FolderOpen, Search, X } from "./icons"
import { Button, Count, Kbd } from "./ui"

const HOME = "~/"

type Item =
  | { readonly kind: "recent"; readonly path: string }
  | { readonly kind: "here"; readonly path: string }
  | { readonly kind: "entry"; readonly path: string; readonly entry: DirectoryEntry }

interface Place {
  readonly query: string
  readonly label: string
  readonly section: "top" | "pinned" | "folders"
  readonly count?: number
}

interface Listing {
  readonly target: string
  readonly value: DirectoryListing | null
}

const ranked = <A,>(items: ReadonlyArray<A>, filter: string, text: (item: A) => ReadonlyArray<string>) =>
  filter === ""
    ? [...items]
    : items
        .map((item) => ({
          item,
          score: Math.max(0, ...text(item).map((value, index) => fuzzyScore(value, filter) * (index === 0 ? 1 : 0.9))),
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ item }) => item)

const isFolder = (item: Item) => item.kind === "entry" && !item.entry.isRepo

const rowIcon = "flex shrink-0 text-muted-foreground group-data-highlighted/row:text-selection-foreground"

function KeyHint(props: { keys: JSX.Element; children: JSX.Element }) {
  return (
    <span class="flex items-center gap-1.5">
      <span class="flex items-center gap-0.5 rounded border bg-muted/60 px-1 font-sans text-2xs">{props.keys}</span>
      {props.children}
    </span>
  )
}

export function Picker() {
  let searchInput: HTMLInputElement | undefined
  onSettled(() => {
    searchInput?.focus()
  })
  const [existing, setExisting] = createSignal<ReadonlyArray<string> | null>(null)
  const [home, setHome] = createSignal<string>()
  void call((git) => git.FilterRepos({ paths: [...untrack(recent)] })).then(setExisting, () => setExisting(null))
  void call((git) => git.ListDirectory({ path: HOME })).then(
    (listing) => setHome(listing.path),
    () => undefined,
  )

  const repos = () => {
    const found = existing()
    return found === null ? recent() : recent().filter((path) => found.includes(path))
  }
  const tildify = (path: string) => {
    const root = home()
    return root !== undefined && (path === root || path.startsWith(`${root}/`)) ? `~${path.slice(root.length)}` : path
  }
  const parent = (path: string) => tildify(dirname(path).slice(0, -1))

  const [query, setQuery] = createSignal("")
  const [highlighted, setHighlighted] = createSignal<string | null>(null)
  const go = (next: string, highlight: string | null = null) => {
    setQuery(next)
    setHighlighted(highlight)
  }

  const browsing = () => repos().length === 0 || query().startsWith("~") || query().includes("/")
  const input = () => (!browsing() ? "" : query() === "~" ? HOME : query())
  const dir = () => input().slice(0, input().lastIndexOf("/") + 1)
  const filter = () => (browsing() ? input().slice(dir().length) : query())
  const target = () => (dir().startsWith("/") || dir().startsWith("~") ? dir() : `${HOME}${dir()}`)
  const label = () => (target().length > 1 ? target().replace(/\/+$/, "") : target())

  const [listing, setListing] = createSignal<Listing | null>(null)
  createEffect(
    () => (browsing() ? target() : null),
    (next) => {
      if (next === null) return
      let live = true
      call((git) => git.ListDirectory({ path: next })).then(
        (value) => live && setListing({ target: next, value }),
        () => live && setListing({ target: next, value: null }),
      )
      return () => {
        live = false
      }
    },
  )
  const failed = () => listing()?.target === target() && listing()?.value === null
  const shown = () => (browsing() ? (listing()?.value ?? null) : null)

  const items = createMemo((): Array<Item> => {
    if (!browsing())
      return ranked(repos(), filter(), (path) => [basename(path), parent(path)]).map((path) => ({
        kind: "recent" as const,
        path,
      }))
    const value = shown()
    if (value === null || failed()) return []
    const entries = value.entries.filter((entry) => filter().startsWith(".") || !entry.name.startsWith("."))
    return [
      ...(value.isRepo ? [{ kind: "here" as const, path: value.path }] : []),
      ...ranked(entries, filter(), (entry) => [entry.name]).map((entry) => ({
        kind: "entry" as const,
        path: entry.path,
        entry,
      })),
    ]
  })
  const active = () => items().find((item) => item.path === highlighted()) ?? items()[0]
  const activeIsFolder = () => {
    const current = active()
    return current !== undefined && isFolder(current)
  }

  const places = createMemo((): Array<Place> => {
    const derived = new Map<string, number>()
    for (const path of repos()) derived.set(parent(path), (derived.get(parent(path)) ?? 0) + 1)
    return [
      ...(repos().length > 0 ? [{ query: "", label: "Recent", section: "top" as const, count: repos().length }] : []),
      { query: HOME, label: "Home", section: "top" as const },
      ...pinned().map((folder) => ({ query: `${folder}/`, label: folder, section: "pinned" as const })),
      ...[...derived]
        .filter(([folder]) => folder !== "~" && !pinned().includes(folder))
        .sort((a, b) => b[1] - a[1])
        .map(([folder, count]) => ({ query: `${folder}/`, label: folder, section: "folders" as const, count })),
    ]
  })
  const currentPlace = () =>
    places().findIndex((place) => (place.query === "" ? !browsing() : browsing() && target() === place.query))

  const here = () => {
    const value = shown()
    return value === null ? undefined : tildify(value.path)
  }
  const pinnable = () => browsing() && here() !== undefined && here() !== "~"
  const isPinned = () => {
    const folder = here()
    return folder !== undefined && pinned().includes(folder)
  }

  const upTo = () => {
    if (!browsing()) return undefined
    if (target() === HOME) {
      const root = home()
      return root === undefined ? undefined : dirname(root)
    }
    return target() === "/" ? undefined : target().replace(/[^/]+\/$/, "")
  }
  const goUp = () => {
    const up = upTo()
    if (up !== undefined) go(up, shown()?.path ?? null)
  }

  const activate = (item: Item) => (isFolder(item) ? go(`${target()}${basename(item.path)}/`) : openRepo(item.path))
  const complete = (item: Item) => {
    if (item.kind === "entry") go(`${target()}${item.entry.name}${item.entry.isRepo ? "" : "/"}`, item.path)
    else if (item.kind === "recent") go(basename(item.path), item.path)
  }
  const remove = (path: string) => {
    const list = items()
    const index = list.findIndex((item) => item.path === path)
    forget(path)
    setHighlighted(list[index + 1]?.path ?? list[index - 1]?.path ?? null)
  }
  const step = (delta: 1 | -1) => {
    const list = places()
    const from = currentPlace() === -1 ? (delta === 1 ? -1 : list.length) : currentPlace()
    const place = list[(from + delta + list.length) % list.length]
    if (place !== undefined) go(place.query)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return
    const chord = chordOf(event)
    const current = active()
    if (chord === "Alt+ArrowUp") step(-1)
    else if (chord === "Alt+ArrowDown") step(1)
    else if (chord === "Mod+ArrowUp") goUp()
    else if (chord === "Mod+Backspace" && query() === "" && current?.kind === "recent") remove(current.path)
    else if (chord === "Mod+P") {
      const folder = here()
      if (pinnable() && folder !== undefined) togglePin(folder)
    } else if (chord === "Tab") {
      if (current !== undefined) complete(current)
    } else if (chord === "Escape" && query() !== "") go("")
    else return
    event.preventDefault()
  }

  const openHint = (path: string) => (
    <span class="ms-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">
      <Show when={paths().includes(path)}>
        <span class="group-data-highlighted/row:hidden">open</span>
      </Show>
      <span class="hidden items-center gap-1.5 group-data-highlighted/row:flex">
        Open <Kbd>↵</Kbd>
      </span>
    </span>
  )

  return (
    <div class="flex min-h-0 flex-1 justify-center px-6 pt-[10svh] pb-6">
      <div class="flex max-h-full w-full max-w-4xl items-start gap-6">
        <aside class="flex max-h-full w-52 shrink-0 flex-col">
          <h1 class="mb-2 px-2 text-sm font-semibold">Open a repository</h1>
          <nav aria-label="Places" class="flex min-h-0 flex-col gap-px overflow-y-auto">
            <For each={places()}>
              {(place, index) => (
                <>
                  <Show when={place.section !== "top" && place.section !== places()[index() - 1]?.section}>
                    <div class="mt-3 mb-1 px-2 section-label">{place.section === "pinned" ? "Pinned" : "Folders"}</div>
                  </Show>
                  <button
                    type="button"
                    aria-current={index() === currentPlace() ? "true" : undefined}
                    class={[
                      "flex h-6 items-center gap-2 rounded px-2 text-start text-xs",
                      index() === currentPlace()
                        ? "bg-selection font-medium text-selection-foreground"
                        : "hover:bg-muted",
                    ]}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => go(place.query)}
                  >
                    <span class="min-w-0 flex-1 truncate">{place.label}</span>
                    <Count value={place.count ?? 0} />
                  </button>
                </>
              )}
            </For>
          </nav>
          <Show when={desktop}>
            {(bridge) => (
              <Button
                class="mt-4 self-start"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  void bridge()
                    .pickFolder()
                    .then((folder) => openFolders(folder === null ? [] : [folder]))
                }
              >
                Choose a folder…
              </Button>
            )}
          </Show>
        </aside>
        <Command
          query={query()}
          onQueryChange={(next) => go(next)}
          value={active()?.path ?? null}
          onValueChange={(value) => setHighlighted(value)}
          onAction={(value) => {
            const item = items().find((candidate) => candidate.path === value)
            if (item !== undefined) activate(item)
          }}
          filter={false}
          class="flex max-h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background"
        >
          <div class="flex h-9 shrink-0 items-center gap-2 border-b px-2.5 text-muted-foreground">
            <Search />
            <CommandInput
              ref={(element: HTMLInputElement) => (searchInput = element)}
              autofocus
              aria-label="Search repositories or type a path"
              autocomplete="off"
              spellcheck={false}
              placeholder={
                repos().length > 0
                  ? "Search recent repositories, or type a path"
                  : "Search your home folder, or type a path"
              }
              onKeyDown={onKeyDown}
              class="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div class="flex h-7 shrink-0 items-center gap-2 bg-muted/40 px-2.5 text-xs">
            <Show
              when={browsing()}
              fallback={
                <span class="flex items-center gap-2 section-label">
                  Recent
                  <Count value={repos().length} />
                </span>
              }
            >
              <span class="min-w-0 flex-1 truncate font-medium">{label()}</span>
              <Show when={pinnable()}>
                <Button
                  variant="ghost"
                  class="h-5"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => togglePin(here() ?? "")}
                >
                  {isPinned() ? "Unpin" : "Pin"}
                </Button>
              </Show>
              <Show when={upTo() !== undefined}>
                <Button variant="ghost" class="h-5" onMouseDown={(event) => event.preventDefault()} onClick={goUp}>
                  Up
                </Button>
              </Show>
            </Show>
          </div>
          <CommandList
            aria-label={browsing() ? label() : "Recent repositories"}
            class="min-h-0 flex-auto scroll-py-1 overflow-y-auto py-1"
          >
            <For each={items()} keyed={(item) => item.path}>
              {(item) => (
                <CommandItem
                  value={item().path}
                  onMouseDown={(event: MouseEvent) => event.preventDefault()}
                  class="group/row mx-1 flex h-6 cursor-default items-center gap-2 rounded px-2 text-xs whitespace-nowrap data-highlighted:bg-selection data-highlighted:text-selection-foreground"
                >
                  <Show when={item().kind === "here"}>
                    <span class={rowIcon}>
                      <FolderOpen />
                    </span>
                    <span class="truncate">Open {label()}</span>
                    <span class="ms-auto hidden group-data-highlighted/row:inline-flex">
                      <Kbd>↵</Kbd>
                    </span>
                  </Show>
                  <Show when={item().kind === "recent"}>
                    <span class={rowIcon}>
                      <FolderGit />
                    </span>
                    <span class="shrink-0 font-medium">{basename(item().path)}</span>
                    <span class="min-w-0 truncate text-muted-foreground">{parent(item().path)}</span>
                    {openHint(item().path)}
                    <button
                      type="button"
                      aria-label={`Remove ${basename(item().path)} from recent repositories`}
                      class="-me-1 hidden size-4 items-center justify-center rounded text-muted-foreground group-data-highlighted/row:flex hover:bg-muted hover:text-foreground"
                      onClick={(event) => {
                        event.stopPropagation()
                        remove(item().path)
                      }}
                    >
                      <X />
                    </button>
                  </Show>
                  <Show when={item().kind === "entry"}>
                    <span class={rowIcon}>{isFolder(item()) ? <Folder /> : <FolderGit />}</span>
                    <span
                      class={[
                        "truncate",
                        isFolder(item()) &&
                          "text-muted-foreground group-data-highlighted/row:text-selection-foreground",
                      ]}
                    >
                      {basename(item().path)}
                    </span>
                    <Show when={isFolder(item())} fallback={openHint(item().path)}>
                      <span class="ms-auto text-muted-foreground">
                        <ChevronRight />
                      </span>
                    </Show>
                  </Show>
                </CommandItem>
              )}
            </For>
            <Show when={items().length === 0}>
              <p class="px-2 py-6 text-center text-xs text-muted-foreground">
                {!browsing()
                  ? "No recent repositories match."
                  : failed()
                    ? `Couldn't read ${label()}.`
                    : shown() === null
                      ? "Loading…"
                      : filter() === ""
                        ? "No folders here."
                        : "No folders match."}
              </p>
            </Show>
          </CommandList>
          <div class="flex h-8 shrink-0 items-center gap-4 overflow-hidden border-t px-3 text-2xs whitespace-nowrap text-muted-foreground">
            <Show when={activeIsFolder()}>
              <KeyHint keys="↵">go into folder</KeyHint>
            </Show>
            <Show when={browsing() && active()?.kind === "entry"}>
              <KeyHint keys="Tab">complete</KeyHint>
            </Show>
            <Show when={upTo() !== undefined}>
              <KeyHint keys={formatChord("Mod+ArrowUp")}>up</KeyHint>
            </Show>
            <Show when={pinnable()}>
              <KeyHint keys={formatChord("Mod+P")}>{isPinned() ? "unpin" : "pin"}</KeyHint>
            </Show>
            <Show when={!browsing() && query() === "" && active() !== undefined}>
              <KeyHint keys={formatChord("Mod+Backspace").replace("Backspace", "⌫")}>remove</KeyHint>
            </Show>
            <Show when={!browsing()}>
              <KeyHint keys="~/">browse folders</KeyHint>
            </Show>
            <KeyHint keys={`${formatChord("Alt+ArrowUp")} ${formatChord("Alt+ArrowDown")}`}>places</KeyHint>
            <Show when={query() !== ""}>
              <KeyHint keys="Esc">clear</KeyHint>
            </Show>
            <Show when={desktop !== undefined}>
              <KeyHint keys={shortcut("repo.open")}>choose a folder</KeyHint>
            </Show>
          </div>
        </Command>
      </div>
    </div>
  )
}
