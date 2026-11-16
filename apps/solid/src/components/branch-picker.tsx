import type { Status } from "@gitui/contracts"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/solid/command"
import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/solid/popover"
import { createSignal, For, Show } from "solid-js"
import { useCommand } from "@/lib/hotkeys"
import type { Repo } from "@/lib/repo"
import { localChangesBlock } from "@/lib/checkout"
import { describeError } from "@/lib/rpc"
import { active, openRepo } from "@/lib/workspaces"
import { Branch, ChevronDown, Search } from "./icons"
import { Alert, Button, type Failure } from "./ui"

const itemClass =
  "flex h-6 cursor-default items-center gap-2 rounded px-2 text-xs data-highlighted:bg-selection data-highlighted:text-selection-foreground"

const REMOTE = "remote:"

export const headName = (status: Status) =>
  status.head._tag === "Detached" ? status.head.oid.slice(0, 7) : status.head.name

export function BranchPicker(props: { repo: Repo }) {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [failure, setFailure] = createSignal<Failure | null>(null)
  const [blocked, setBlocked] = createSignal<{ readonly branch: string; readonly includeUntracked: boolean } | null>(
    null,
  )
  const [stashing, setStashing] = createSignal(false)
  const status = () => props.repo.status()
  const current = () => {
    const head = status().head
    return head._tag === "Branch" ? head.name : null
  }
  const worktreeOf = (name: string) =>
    props.repo
      .refs()
      .worktrees.find(
        (worktree) => worktree.head._tag === "Branch" && worktree.head.name === name && worktree.path !== active(),
      )
  const remotes = () => props.repo.refs().remoteBranches

  useCommand("branch.switch", () => {
    setQuery("")
    setFailure(null)
    setOpen(true)
  })

  const checkout = async (branch: string) => {
    setFailure(null)
    setBlocked(null)
    try {
      await props.repo.mutate(["refs", "worktree", "index"], (git) => git.Checkout({ repo: props.repo.id, branch }))
      setOpen(false)
    } catch (error) {
      setFailure({ title: `Couldn't switch to ${branch}`, message: describeError(error) })
      const block = localChangesBlock(error)
      setBlocked(block === null ? null : { branch, ...block })
    }
  }

  const stashAndSwitch = async (block: { readonly branch: string; readonly includeUntracked: boolean }) => {
    setStashing(true)
    try {
      await props.repo.mutate(["worktree", "index", "refs"], (git) =>
        git.StashPush({
          repo: props.repo.id,
          message: `Before switching to ${block.branch}`,
          includeUntracked: block.includeUntracked,
          paths: null,
          keepIndex: false,
        }),
      )
      await checkout(block.branch)
    } catch (error) {
      setFailure({ title: "Couldn't stash your changes", message: describeError(error) })
      setBlocked(null)
    } finally {
      setStashing(false)
    }
  }

  const choose = (value: string) => {
    if (value.startsWith(REMOTE)) {
      const remote = remotes().find((branch) => branch.name === value.slice(REMOTE.length))
      if (remote !== undefined) void checkout(remote.name.slice(remote.remote.length + 1))
      return
    }
    if (value === current()) return setOpen(false)
    const elsewhere = worktreeOf(value)
    if (elsewhere !== undefined) {
      setOpen(false)
      return openRepo(elsewhere.path, active() ?? undefined)
    }
    void checkout(value)
  }

  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setQuery("")
          setFailure(null)
        }
      }}
    >
      <PopoverTrigger
        aria-label="Switch branch"
        class="relative z-[51] flex h-6 min-w-16 items-center gap-1 rounded-md border border-transparent px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground data-open:rounded-b-none data-open:border-border data-open:border-b-transparent data-open:bg-popover data-open:text-foreground"
      >
        <Branch />
        <span class="truncate">{headName(status())}</span>
        <ChevronDown />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={-1} class="w-80 rounded-tl-none p-0">
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
              aria-label="Switch branch"
              placeholder="Switch branch"
              class="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandList class="max-h-80 scroll-py-1 overflow-y-auto overscroll-none p-1">
            <CommandEmpty class="hidden px-2 py-1.5 text-xs text-muted-foreground data-empty:block">
              No branches match.
            </CommandEmpty>
            <CommandGroup>
              <CommandGroupLabel class="px-2 pt-1 pb-0.5 section-label">Local</CommandGroupLabel>
              <For each={props.repo.refs().branches}>
                {(branch) => (
                  <CommandItem value={branch.name} label={branch.name} class={itemClass}>
                    <span
                      class={[
                        "size-1.5 shrink-0 rounded-full",
                        branch.name === current() ? "bg-primary" : "bg-transparent",
                      ]}
                    />
                    <span class="min-w-0 flex-1 truncate">{branch.name}</span>
                    <Show when={worktreeOf(branch.name)}>
                      <span class="shrink-0 text-2xs text-muted-foreground">In a worktree</span>
                    </Show>
                    <Show when={branch.upstream?._tag === "Tracking" ? branch.upstream : null}>
                      {(tracking) => (
                        <span class="flex shrink-0 gap-1 text-2xs text-muted-foreground tabular-nums">
                          <Show when={tracking().ahead > 0}>
                            <span>↑{tracking().ahead}</span>
                          </Show>
                          <Show when={tracking().behind > 0}>
                            <span>↓{tracking().behind}</span>
                          </Show>
                        </span>
                      )}
                    </Show>
                  </CommandItem>
                )}
              </For>
            </CommandGroup>
            <Show when={remotes().length > 0}>
              <CommandGroup>
                <CommandGroupLabel class="px-2 pt-2 pb-0.5 section-label">Remote</CommandGroupLabel>
                <For each={remotes()}>
                  {(branch) => (
                    <CommandItem value={`${REMOTE}${branch.name}`} label={branch.name} class={itemClass}>
                      <span class="size-1.5 shrink-0" />
                      <span class="min-w-0 flex-1 truncate text-muted-foreground">{branch.name}</span>
                    </CommandItem>
                  )}
                </For>
              </CommandGroup>
            </Show>
          </CommandList>
          <Show when={failure()}>
            {(current) => (
              <div class="flex flex-col gap-1.5 border-t p-1.5">
                <Alert tone="error" title={current().title}>
                  {current().message}
                </Alert>
                <Show when={blocked()}>
                  {(block) => (
                    <div class="flex justify-end">
                      <Button variant="primary" disabled={stashing()} onClick={() => void stashAndSwitch(block())}>
                        Stash changes and switch
                      </Button>
                    </div>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
