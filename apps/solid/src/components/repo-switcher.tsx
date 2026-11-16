import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@ui-sdk/solid/command"
import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/solid/popover"
import { createEffect, createSignal, Errored, For, Loading, Show, untrack } from "solid-js"
import { basename, dirname } from "@/lib/format"
import { altHeld, type Chord, formatChord, shortcut, useCommand } from "@/lib/hotkeys"
import { recent } from "@/lib/places"
import { active, closeRepo, openRepo, paths, setActive, workspaceFor } from "@/lib/workspaces"
import { ChevronDown, Search, Worktree, X } from "./icons"
import { Kbd, Tip } from "./ui"
import { shortReason } from "./open-failure"

const OPEN = "\0open"

const itemClass =
  "group/row flex h-6 cursor-default items-center gap-2 rounded px-2 text-xs data-highlighted:bg-selection data-highlighted:text-selection-foreground"

const slots = [
  "Alt+1",
  "Alt+2",
  "Alt+3",
  "Alt+4",
  "Alt+5",
  "Alt+6",
  "Alt+7",
  "Alt+8",
] as const satisfies ReadonlyArray<Chord>

const slotOf = (path: string): Chord | undefined => {
  const list = paths()
  const index = list.indexOf(path)
  if (index === list.length - 1 && list.length > slots.length) return "Alt+9"
  return slots[index]
}

const where = (path: string) => dirname(path).slice(0, -1)

function OpenRepoLabel(props: { path: string }) {
  const workspace = () => workspaceFor(props.path)
  const info = () => workspace().info()
  const linked = () => info().gitDir !== info().commonDir
  const status = () => workspace().repo().status()
  const branch = () => {
    const head = status().head
    return head._tag === "Detached" ? head.oid.slice(0, 7) : head.name
  }
  return (
    <>
      <Show when={linked()}>
        <span class="flex shrink-0 text-muted-foreground group-data-highlighted/row:text-selection-foreground/70">
          <Worktree />
        </span>
      </Show>
      <span class="min-w-0 flex-1 truncate">
        <Show when={linked()} fallback={<span class="font-medium">{info().name}</span>}>
          <span class="font-medium">{basename(info().commonDir.replace(/\/\.git\/?$/, ""))}</span>
          <span class="text-muted-foreground group-data-highlighted/row:text-selection-foreground/70">/{branch()}</span>
        </Show>
      </span>
      <Show when={status().entries.length > 0}>
        <span class="shrink-0 text-2xs text-muted-foreground tabular-nums group-data-highlighted/row:text-selection-foreground/70">
          {status().entries.length} changed
        </span>
      </Show>
    </>
  )
}

export function RepoSwitcher() {
  const [query, setQuery] = createSignal("")
  const [open, setOpen] = createSignal(false)
  useCommand("repo.switch", () => {
    setQuery("")
    setOpen(true)
  })
  const others = () => recent().filter((path) => !paths().includes(path))
  const current = () => active()
  const [peek, setPeek] = createSignal(false)
  createEffect(
    () => altHeld() && paths().length > 1,
    (held) => {
      if (held && !untrack(open)) {
        setPeek(true)
        setOpen(true)
      } else if (!held && untrack(peek)) {
        setPeek(false)
        setOpen(false)
      }
    },
  )

  const choose = (value: string) => {
    setOpen(false)
    if (value === OPEN) setActive(null)
    else openRepo(value)
  }

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setQuery("")
        else setPeek(false)
      }}
    >
      <span class="relative flex min-w-0">
        <PopoverTrigger
          aria-label="Switch repository"
          class="relative z-[51] flex h-6 min-w-0 items-center gap-1 rounded-md border border-transparent px-1.5 text-xs font-semibold hover:bg-muted data-open:rounded-b-none data-open:border-border data-open:border-b-transparent data-open:bg-popover"
        >
          <Show when={current()} fallback={<span>Repositories</span>}>
            {(path) => (
              <Errored fallback={<span class="truncate">{basename(path())}</span>}>
                <Loading fallback={<span class="truncate">{basename(path())}</span>}>
                  <Show when={workspaceFor(path()).info().gitDir !== workspaceFor(path()).info().commonDir}>
                    <span aria-label="Worktree" class="flex shrink-0 text-muted-foreground">
                      <Worktree />
                    </span>
                  </Show>
                  <span class="truncate">{workspaceFor(path()).info().name}</span>
                </Loading>
              </Errored>
            )}
          </Show>
          <ChevronDown />
        </PopoverTrigger>
      </span>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={-1}
        initialFocus={peek() ? "none" : "auto"}
        finalFocus={peek() ? "none" : "trigger"}
        class="w-80 rounded-tl-none p-0"
      >
        <Command
          query={query()}
          onQueryChange={setQuery}
          onAction={choose}
          defaultValue={current()}
          filter="fuzzy"
          autoHighlight
          loop
        >
          <div class="flex h-8 items-center gap-2 border-b px-2.5 text-muted-foreground">
            <Search />
            <CommandInput
              autofocus={!peek()}
              aria-label="Switch repository"
              placeholder="Switch repository"
              class="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandList class="max-h-80 overflow-y-auto overscroll-none p-1">
            <Show when={paths().length > 0}>
              <CommandGroup>
                <CommandGroupLabel class="px-2 pt-1 pb-0.5 section-label">Open</CommandGroupLabel>
                <For each={paths()}>
                  {(path) => (
                    <CommandItem value={path} label={basename(path)} keywords={[path]} class={itemClass}>
                      <span
                        class={["size-1.5 shrink-0 rounded-full", path === current() ? "bg-primary" : "bg-transparent"]}
                      />
                      <Errored
                        fallback={(error) => (
                          <>
                            <span class="min-w-0 flex-1 truncate font-medium">{basename(path)}</span>
                            <span class="shrink-0 text-2xs text-destructive">{shortReason(error())}</span>
                          </>
                        )}
                      >
                        <Loading fallback={<span class="min-w-0 flex-1 truncate font-medium">{basename(path)}</span>}>
                          <OpenRepoLabel path={path} />
                        </Loading>
                      </Errored>
                      <Show when={slotOf(path)}>
                        {(chord) => (
                          <span class="group-hover/row:hidden">
                            <Kbd>{formatChord(chord())}</Kbd>
                          </span>
                        )}
                      </Show>
                      <Tip label="Close repository" keys={path === current() ? shortcut("repo.close") : undefined}>
                        {(trigger) => (
                          <button
                            {...trigger}
                            type="button"
                            tabindex={-1}
                            aria-label={`Close ${basename(path)}`}
                            class="-me-1 hidden size-5 shrink-0 items-center justify-center rounded group-hover/row:flex hover:bg-foreground/10"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              closeRepo(path)
                            }}
                          >
                            <X />
                          </button>
                        )}
                      </Tip>
                    </CommandItem>
                  )}
                </For>
              </CommandGroup>
            </Show>
            <Show when={others().length > 0}>
              <CommandGroup>
                <CommandGroupLabel class="px-2 pt-2 pb-0.5 section-label">Recent</CommandGroupLabel>
                <For each={others()}>
                  {(path) => (
                    <CommandItem value={path} label={basename(path)} keywords={[path]} class={itemClass}>
                      <span class="size-1.5 shrink-0" />
                      <span class="shrink-0 font-medium">{basename(path)}</span>
                      <span class="min-w-0 truncate text-2xs text-muted-foreground group-data-highlighted/row:text-selection-foreground/70">
                        {where(path)}
                      </span>
                    </CommandItem>
                  )}
                </For>
              </CommandGroup>
            </Show>
            <CommandSeparator class="my-1 h-px bg-border" />
            <CommandItem value={OPEN} label="Open a repository" class={itemClass}>
              <span class="size-1.5 shrink-0" />
              Open a repository…
              <span class="ms-auto">
                <Kbd>{shortcut("repo.open")}</Kbd>
              </span>
            </CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
