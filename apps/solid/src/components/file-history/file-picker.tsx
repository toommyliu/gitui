import type { RepoPath } from "@gitui/contracts"
import { Command, CommandInput, CommandItem, CommandList } from "@ui-sdk/solid/command"
import { Dialog, DialogBackdrop, DialogContent, DialogTitle } from "@ui-sdk/solid/dialog"
import { createMemo, createSignal, For, Show } from "solid-js"
import { basename, dirname } from "@/lib/format"
import { searchPaths } from "@/lib/path-search"
import { useRepo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import { Search } from "../icons"
import { Spinner } from "../state"
import { Kbd } from "../ui"

const LIMIT = 200

function PickerBody(props: { onPick: (path: RepoPath) => void }) {
  const repo = useRepo()
  const [files, setFiles] = createSignal<ReadonlyArray<RepoPath>>()
  const [error, setError] = createSignal<string | null>(null)
  void call((git) => git.GetTrackedFiles({ repo: repo.id })).then(setFiles, (failure: unknown) =>
    setError(describeError(failure)),
  )
  const [query, setQuery] = createSignal("")
  const found = createMemo(() => searchPaths(files() ?? [], query(), LIMIT))

  return (
    <Command
      query={query()}
      onQueryChange={(next) => setQuery(next)}
      onAction={(value) => {
        const path = found().matches.find((candidate) => candidate === value)
        if (path !== undefined) props.onPick(path)
      }}
      filter={false}
      autoHighlight
      class="flex min-h-0 flex-col"
    >
      <div class="flex h-8 shrink-0 items-center gap-2 border-b ps-2.5 pe-1.5 text-xs text-muted-foreground focus-within:bg-muted/40">
        <Search />
        <CommandInput
          autofocus
          aria-label="Find a tracked file"
          placeholder="Find a tracked file"
          autocomplete="off"
          spellcheck={false}
          class="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div class="relative min-h-24">
        <CommandList aria-label="Tracked files" class="max-h-[min(24rem,50svh)] overflow-y-auto overscroll-none p-1">
          <For each={found().matches}>
            {(path) => (
              <CommandItem
                value={path}
                class="group/row flex h-6 cursor-default items-center gap-2 rounded px-2 text-xs whitespace-nowrap data-highlighted:bg-selection data-highlighted:text-selection-foreground"
              >
                <span class="min-w-0 truncate">
                  <span class="text-muted-foreground group-data-highlighted/row:text-selection-foreground/70">
                    {dirname(path)}
                  </span>
                  {basename(path)}
                </span>
                <span class="ms-auto hidden shrink-0 group-data-highlighted/row:inline-flex">
                  <Kbd>↵</Kbd>
                </span>
              </CommandItem>
            )}
          </For>
        </CommandList>
        <Show when={found().matches.length === 0}>
          <div class="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Show
              when={files() !== undefined || error() !== null}
              fallback={
                <>
                  <Spinner />
                  Listing tracked files…
                </>
              }
            >
              <Show when={error()} fallback={files()?.length === 0 ? "No tracked files yet." : "No files match."}>
                {(message) => <span class="text-destructive">Couldn't list tracked files. {message()}</span>}
              </Show>
            </Show>
          </div>
        </Show>
      </div>
      <p
        role="status"
        class="flex h-7 shrink-0 items-center border-t px-2.5 text-2xs text-muted-foreground tabular-nums"
      >
        {files() === undefined
          ? ""
          : found().total > found().matches.length
            ? `Showing ${found().matches.length.toLocaleString()} of ${found().total.toLocaleString()} files. Type more to narrow the list.`
            : `${found().total.toLocaleString()} ${found().total === 1 ? "file" : "files"}`}
      </p>
    </Command>
  )
}

export function FilePicker(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (path: RepoPath) => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <DialogBackdrop class="bg-transparent" />
      <DialogContent class="mt-[12svh] mb-auto w-[min(560px,calc(100%-2rem))] gap-0 overflow-hidden p-0">
        <DialogTitle class="sr-only">File history</DialogTitle>
        <Show when={props.open}>
          <PickerBody onPick={props.onPick} />
        </Show>
      </DialogContent>
    </Dialog>
  )
}
