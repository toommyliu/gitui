import { useAtom, useAtomValue } from "@effect/atom-react"
import type { DirectoryEntry, DirectoryListing } from "@gitui/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { type HotkeyChord, matchesKeyboardEvent, useAppHotkeys } from "@tanstack/react-hotkeys"
import { cn } from "cn"
import { defaultFilter } from "cmdk"
import {
  ChevronRightIcon,
  ClockIcon,
  CornerLeftUpIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderOpenIcon,
  HouseIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useState } from "react"
import { Shortcut } from "@/components/shortcut"
import { desktop } from "@/lib/desktop"
import { basename, dirname } from "@/lib/format"
import { directoryAtom, existingReposAtom, latest } from "@/lib/git"
import { useNarrow } from "@/lib/narrow"
import { pinnedAtom, recentAtom } from "@/lib/places"
import { useTallList } from "@/lib/tall-list"

const HOME = "~/"
const ROW = 26

const keys = {
  open: "Mod+ArrowDown",
  up: "Mod+ArrowUp",
  previousPlace: "Alt+ArrowUp",
  nextPlace: "Alt+ArrowDown",
  remove: "Mod+Backspace",
  pin: "Mod+P",
} as const satisfies Record<string, HotkeyChord>

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

const isFolder = (item: Item) => item.kind === "entry" && !item.entry.isRepo

const ranked = <A,>(items: ReadonlyArray<A>, filter: string, text: (item: A) => [string, ...Array<string>]) =>
  items
    .map((item) => {
      const [value, ...keywords] = text(item)
      return { item, score: filter === "" ? 1 : defaultFilter(value, filter, keywords) }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)

const chooseFolder = (then: (folder: string) => void) =>
  void desktop?.pickFolder().then((folder) => {
    if (folder !== null) then(folder)
  })

export function RepoPicker({
  onOpen,
  openPaths,
}: {
  onOpen: (path: string) => void
  openPaths: ReadonlyArray<string>
}) {
  const id = useId()
  const chooseHotkey = useAppHotkeys()["repo.open"].hotkey
  const narrow = useNarrow()
  const [recent, setRecent] = useAtom(recentAtom)
  const [pinned, setPinned] = useAtom(pinnedAtom)
  const [checked] = useState(() => JSON.stringify(recent))
  const existing = latest(useAtomValue(existingReposAtom(checked)))
  const repos = existing === undefined ? recent : recent.filter((path) => existing.includes(path))

  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState("")
  const go = (next: string, highlight = "") => {
    setQuery(next)
    setHighlighted(highlight)
  }

  const browsing = repos.length === 0 || query.startsWith("~") || query.includes("/")
  const input = !browsing ? "" : query === "~" ? HOME : query
  const dir = input.slice(0, input.lastIndexOf("/") + 1)
  const filter = browsing ? input.slice(dir.length) : query
  const target = dir.startsWith("/") || dir.startsWith("~") ? dir : `${HOME}${dir}`
  const label = target.length > 1 ? target.replace(/\/+$/, "") : target

  const home = latest(useAtomValue(directoryAtom(HOME)))?.path
  const tildify = (path: string) =>
    home !== undefined && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
  const parent = (path: string) => tildify(dirname(path).slice(0, -1))

  const result = useAtomValue(directoryAtom(target))
  const [shown, setShown] = useState<DirectoryListing | undefined>(undefined)
  if (result._tag === "Success" && result.value !== shown) setShown(result.value)
  const listing = browsing && result._tag !== "Failure" ? shown : undefined

  const items: ReadonlyArray<Item> = browsing
    ? [
        ...(listing?.isRepo === true ? [{ kind: "here" as const, path: listing.path }] : []),
        ...ranked(
          (listing?.entries ?? []).filter((entry) => filter.startsWith(".") || !entry.name.startsWith(".")),
          filter,
          (entry) => [entry.name],
        ).map((entry) => ({ kind: "entry" as const, path: entry.path, entry })),
      ]
    : ranked(repos, filter, (path) => [basename(path), parent(path)]).map((path) => ({
        kind: "recent" as const,
        path,
      }))
  const found = items.findIndex((item) => item.path === highlighted)
  const index = found === -1 ? 0 : found
  const active = items[index]

  const {
    ref: listRef,
    element: listElement,
    height: listHeight,
    rows: visibleRows,
    scrollToIndex,
  } = useTallList({
    count: items.length,
    rowHeight: ROW,
    overscan: 8,
    resetKey: `${browsing}\n${target}\n${filter}`,
  })
  useLayoutEffect(() => {
    if (found !== -1) scrollToIndex(found, true)
  }, [found, scrollToIndex])

  const derived = new Map<string, number>()
  for (const path of repos) derived.set(parent(path), (derived.get(parent(path)) ?? 0) + 1)
  const places: ReadonlyArray<Place> = [
    ...(repos.length > 0 ? [{ query: "", label: "Recent", section: "top" as const, count: repos.length }] : []),
    { query: HOME, label: "Home", section: "top" },
    ...pinned.map((folder) => ({ query: `${folder}/`, label: folder, section: "pinned" as const })),
    ...[...derived]
      .filter(([folder]) => folder !== "~" && !pinned.includes(folder))
      .sort((a, b) => b[1] - a[1])
      .map(([folder, count]) => ({ query: `${folder}/`, label: folder, section: "folders" as const, count })),
  ]
  const currentPlace = places.findIndex((place) =>
    place.query === "" ? !browsing : browsing && target === place.query,
  )

  const here = listing === undefined ? undefined : tildify(listing.path)
  const pinnable = browsing && here !== undefined && here !== "~"
  const isPinned = here !== undefined && pinned.includes(here)
  const togglePin = (folder: string) =>
    setPinned((current) =>
      current.includes(folder) ? current.filter((other) => other !== folder) : [...current, folder],
    )

  const upTo = !browsing
    ? undefined
    : target === HOME
      ? home === undefined
        ? undefined
        : dirname(home)
      : target === "/"
        ? undefined
        : target.replace(/[^/]+\/$/, "")

  const enter = (name: string) => go(`${target}${name}/`)
  const activate = (item: Item) =>
    item.kind === "entry" && isFolder(item) ? enter(item.entry.name) : onOpen(item.path)
  const complete = (item: Item) => {
    if (item.kind === "entry") go(`${target}${item.entry.name}${item.entry.isRepo ? "" : "/"}`, item.path)
    else if (item.kind === "recent") go(basename(item.path), item.path)
  }
  const remove = (path: string) => {
    setRecent((current) => current.filter((other) => other !== path))
    if (path === active?.path) setHighlighted(items[index + 1]?.path ?? items[index - 1]?.path ?? "")
  }
  const move = (to: number) => {
    const next = Math.min(Math.max(to, 0), items.length - 1)
    const item = items[next]
    if (item === undefined) return
    setHighlighted(item.path)
    scrollToIndex(next)
  }
  const step = (delta: 1 | -1) => {
    const from = currentPlace === -1 ? (delta === 1 ? -1 : places.length) : currentPlace
    const place = places[(from + delta + places.length) % places.length]
    if (place !== undefined) go(place.query)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    const is = (chord: HotkeyChord) => matchesKeyboardEvent(event.nativeEvent, chord)
    const page = Math.max(1, Math.floor((listElement?.clientHeight ?? 0) / ROW) - 1)
    if (is(keys.previousPlace)) step(-1)
    else if (is(keys.nextPlace)) step(1)
    else if (is(keys.up)) {
      if (upTo !== undefined) go(upTo, listing?.path)
    } else if (is(keys.open) || is("Enter")) {
      if (active !== undefined) activate(active)
    } else if (is(keys.remove) && query === "" && active?.kind === "recent") remove(active.path)
    else if (is(keys.pin)) {
      if (pinnable) togglePin(here)
    } else if (is("ArrowDown")) move(index + 1)
    else if (is("ArrowUp")) move(index - 1)
    else if (is("PageDown")) move(index + page)
    else if (is("PageUp")) move(index - page)
    else if (is("Home")) move(0)
    else if (is("End")) move(items.length - 1)
    else if (is("Tab")) {
      if (active !== undefined) complete(active)
    } else if (is("Escape") && query !== "") go("")
    else return
    event.preventDefault()
  }

  const heading = browsing ? (
    <Heading className="font-medium text-foreground">
      <span className="truncate">{label}</span>
      <span className="ml-auto flex items-center">
        {pinnable && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={isPinned ? `Unpin ${here}` : `Pin ${here}`}
            title={isPinned ? "Unpin from the sidebar" : "Pin to the sidebar"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => togglePin(here)}
          >
            {isPinned ? <PinOffIcon /> : <PinIcon />}
          </Button>
        )}
        {upTo !== undefined && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Up one folder"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => go(upTo, listing?.path)}
          >
            <CornerLeftUpIcon />
          </Button>
        )}
      </span>
    </Heading>
  ) : (
    <Heading className="text-[11px] font-semibold tracking-wide uppercase">
      Recent
      <Count>{repos.length}</Count>
    </Heading>
  )

  const rows =
    items.length === 0 ? (
      <Empty>
        {!browsing
          ? "No recent repositories match."
          : result._tag === "Failure"
            ? `Couldn't read ${label}.`
            : listing === undefined
              ? "Loading…"
              : filter === ""
                ? "No folders here."
                : "No folders match."}
      </Empty>
    ) : (
      <div className="relative w-full" style={{ height: listHeight }}>
        {visibleRows.map(({ index: at, top }) => {
          const item = items[at]!
          const selected = at === index
          return (
            <div
              key={item.path}
              id={`${id}-${at}`}
              role="option"
              aria-selected={selected}
              data-selected={selected || undefined}
              onMouseMove={() => {
                if (!selected) setHighlighted(item.path)
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => activate(item)}
              className="group/row absolute top-0 left-0 flex w-full cursor-default items-center gap-2 px-2 whitespace-nowrap select-none data-selected:bg-selection [&_svg]:size-3.5 [&_svg]:shrink-0"
              style={{ height: ROW, transform: `translateY(${top}px)` }}
            >
              {item.kind === "here" ? (
                <>
                  <FolderOpenIcon />
                  <span className="truncate">Open {label}</span>
                  <Hint>
                    <Kbd className="hidden group-data-selected/row:inline-flex">↵</Kbd>
                  </Hint>
                </>
              ) : item.kind === "recent" ? (
                <>
                  <FolderGit2Icon />
                  <span className="shrink-0 font-medium">{basename(item.path)}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{parent(item.path)}</span>
                  <OpenHint open={openPaths.includes(item.path)} />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${basename(item.path)} from recent repositories`}
                    className="-mr-1 hidden group-data-selected/row:inline-flex"
                    onClick={(event) => {
                      event.stopPropagation()
                      remove(item.path)
                    }}
                  >
                    <XIcon />
                  </Button>
                </>
              ) : (
                <>
                  {item.entry.isRepo ? <FolderGit2Icon /> : <FolderIcon className="text-muted-foreground" />}
                  <span className="truncate">{item.entry.name}</span>
                  {item.entry.isRepo ? (
                    <OpenHint open={openPaths.includes(item.path)} />
                  ) : (
                    <Hint>
                      <ChevronRightIcon />
                    </Hint>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 justify-center bg-muted/30 px-6 pt-[10svh] pb-6">
      <div className="flex max-h-full w-full max-w-4xl items-start gap-6">
        {!narrow && (
          <aside className="flex max-h-full w-56 shrink-0 flex-col">
            <h1 className="mb-3 px-2 text-sm font-semibold">Open a repository</h1>
            <nav aria-label="Places" className="min-h-0 overflow-y-auto">
              {places.map((place, at) => (
                <div key={place.query}>
                  {place.section !== places[at - 1]?.section && place.section !== "top" && (
                    <div className="mt-3 mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {place.section === "pinned" ? "Pinned" : "Folders"}
                    </div>
                  )}
                  <PlaceRow
                    place={place}
                    selected={at === currentPlace}
                    onSelect={() => go(place.query)}
                    onUnpin={place.section === "pinned" ? () => togglePin(place.label) : undefined}
                  />
                </div>
              ))}
            </nav>
            {desktop !== undefined && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 self-start"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseFolder(onOpen)}
              >
                <FolderOpenIcon />
                Choose a folder…
              </Button>
            )}
          </aside>
        )}
        <div className="flex max-h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border bg-background">
          <InputGroup className="h-9 shrink-0 rounded-none border-0 border-b border-border bg-transparent dark:bg-transparent">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <input
              autoFocus
              role="combobox"
              aria-label="Search repositories or type a path"
              aria-expanded
              aria-controls={`${id}-list`}
              aria-activedescendant={active === undefined ? undefined : `${id}-${index}`}
              aria-autocomplete="list"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(event) => go(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                repos.length > 0
                  ? "Search recent repositories, or type a path"
                  : "Search your home folder, or type a path"
              }
              className="h-full min-w-0 flex-1 bg-transparent pr-2 outline-none placeholder:text-muted-foreground"
            />
          </InputGroup>
          {heading}
          <div
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-label={browsing ? label : "Recent repositories"}
            className="min-h-0 flex-auto overflow-y-auto"
          >
            {rows}
          </div>
          <div className="flex h-8 shrink-0 items-center gap-4 overflow-hidden border-t px-3 whitespace-nowrap text-muted-foreground">
            {active !== undefined && (
              <KeyHint keys={<Shortcut hotkey="Enter" />}>{isFolder(active) ? "go into folder" : "open"}</KeyHint>
            )}
            {browsing && active !== undefined && active.kind === "entry" && (
              <KeyHint keys={<Shortcut hotkey="Tab" />}>complete</KeyHint>
            )}
            {upTo !== undefined && <KeyHint keys={<Shortcut hotkey={keys.up} />}>up</KeyHint>}
            {pinnable && <KeyHint keys={<Shortcut hotkey={keys.pin} />}>{isPinned ? "unpin" : "pin"}</KeyHint>}
            {!browsing && query === "" && active !== undefined && (
              <KeyHint keys={<Shortcut hotkey={keys.remove} />}>remove</KeyHint>
            )}
            {!browsing && <KeyHint keys={<Kbd>~/</Kbd>}>browse folders</KeyHint>}
            <KeyHint
              keys={
                <>
                  <Shortcut hotkey={keys.previousPlace} />
                  <Shortcut hotkey={keys.nextPlace} />
                </>
              }
            >
              places
            </KeyHint>
            {query !== "" && <KeyHint keys={<Shortcut hotkey="Escape" />}>clear</KeyHint>}
            {desktop !== undefined && chooseHotkey !== null && (
              <KeyHint keys={<Shortcut hotkey={chooseHotkey} />}>choose a folder</KeyHint>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Heading({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex h-7 shrink-0 items-center gap-2 bg-muted/40 px-2 text-muted-foreground", className)}>
      {children}
    </div>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="ml-auto flex shrink-0 items-center gap-1.5 text-muted-foreground">{children}</span>
}

function OpenHint({ open }: { open: boolean }) {
  return (
    <Hint>
      {open && <span className="group-data-selected/row:hidden">in a tab</span>}
      <span className="hidden items-center gap-1.5 group-data-selected/row:flex">
        Open <Kbd>↵</Kbd>
      </span>
    </Hint>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-6 text-center text-muted-foreground">{children}</p>
}

function Count({ children }: { children: ReactNode }) {
  return (
    <Badge variant="secondary" className="h-4 rounded-sm px-1 text-[10px] tabular-nums">
      {children}
    </Badge>
  )
}

function KeyHint({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys}
      {children}
    </span>
  )
}

function PlaceRow({
  place,
  selected,
  onSelect,
  onUnpin,
}: {
  place: Place
  selected: boolean
  onSelect: () => void
  onUnpin: (() => void) | undefined
}) {
  return (
    <div
      className={cn(
        "group/place flex h-7 items-center rounded-md pr-1 [&_svg]:size-3.5 [&_svg]:shrink-0",
        selected ? "bg-selection font-medium" : "hover:bg-muted",
      )}
    >
      <button
        type="button"
        title={place.label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSelect}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left whitespace-nowrap [&_svg]:text-muted-foreground"
      >
        {place.query === "" ? (
          <ClockIcon />
        ) : place.query === HOME ? (
          <HouseIcon />
        ) : place.section === "pinned" ? (
          <PinIcon />
        ) : (
          <FolderIcon />
        )}
        <span className="truncate">{place.label}</span>
        {place.count !== undefined && <Count>{place.count}</Count>}
      </button>
      {onUnpin !== undefined && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Unpin ${place.label}`}
          className="opacity-0 group-hover/place:opacity-100 focus-visible:opacity-100"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onUnpin}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}
