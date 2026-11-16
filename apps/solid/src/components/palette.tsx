import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/solid/command"
import { Dialog, DialogBackdrop, DialogContent, DialogTitle } from "@ui-sdk/solid/dialog"
import { createSignal, For, Show } from "solid-js"
import { basename, dirname } from "@/lib/format"
import { type CommandId, commands, isRunnable, runCommand, shortcut, useCommand } from "@/lib/hotkeys"
import { active, paths, setActive } from "@/lib/workspaces"
import { Search } from "./icons"
import { Kbd } from "./ui"

const groups = ["General", "Repositories", "Remote", "View", "Working copy", "History", "Diff", "Lists"] as const
type Group = (typeof groups)[number]

const groupOf = {
  "palette.open": null,
  "settings.open": "General",
  "theme.toggle": "General",
  "log.toggle": "General",
  "repo.open": "Repositories",
  "repo.switch": "Repositories",
  "branch.switch": "Repositories",
  "repo.close": "Repositories",
  "repo.reopen": "Repositories",
  "rail.next": "Repositories",
  "rail.previous": "Repositories",
  "repo.fetch": "Remote",
  "repo.pull": "Remote",
  "repo.push": "Remote",
  "repo.pullWith": "Remote",
  "repo.pushTo": "Remote",
  "repo.pushTags": "Remote",
  "repo.remotes": "Remote",
  "repo.recovery": "Repositories",
  "repo.undoCommit": "Repositories",
  "repo.identity": "Repositories",
  "repo.addWorktree": "Repositories",
  "repo.cleanupWorktrees": "Repositories",
  "repo.switch1": null,
  "repo.switch2": null,
  "repo.switch3": null,
  "repo.switch4": null,
  "repo.switch5": null,
  "repo.switch6": null,
  "repo.switch7": null,
  "repo.switch8": null,
  "repo.switch9": null,
  "view.changes": "View",
  "view.history": "View",
  "view.branches": "View",
  "view.stashes": "View",
  "view.sidebar": "View",
  "view.files": "View",
  "view.back": null,
  "commit.create": null,
  "files.stageAll": "Working copy",
  "files.unstageAll": "Working copy",
  "files.discard": null,
  "files.extendNext": null,
  "files.extendPrevious": null,
  "files.selectAll": null,
  "files.stage": null,
  "lines.stage": null,
  "lines.unstage": null,
  "lines.discard": null,
  "lines.clear": null,
  "history.search": null,
  "view.search": null,
  "history.compare": "History",
  "history.file": "History",
  "history.extendNext": null,
  "history.extendPrevious": null,
  "history.copySha": "History",
  "commit.rewrite": "History",
  "diff.nextHunk": null,
  "diff.nextFile": null,
  "diff.previousFile": null,
  "diff.find": "Diff",
  "diff.wrap": "Diff",
  "diff.previousHunk": null,
  "diff.layout": "Diff",
  "list.next": null,
  "list.previous": null,
} as const satisfies Record<CommandId, Group | null>

const ids = Object.keys(commands).filter((id): id is CommandId => id in groupOf)

const SWITCH = "\0switch:"

const itemClass =
  "group/row flex h-6 cursor-default items-center gap-2 rounded px-2 text-xs data-highlighted:bg-selection data-highlighted:text-selection-foreground"

export function Palette() {
  const [open, setOpen] = createSignal(false)
  let chosen: (() => void) | undefined
  useCommand("palette.open", () => setOpen(!open()))

  const runnable = (group: Group) => ids.filter((id) => groupOf[id] === group && isRunnable(id))
  const others = () => paths().filter((path) => path !== active())

  const choose = (value: string) => {
    chosen = value.startsWith(SWITCH)
      ? () => setActive(value.slice(SWITCH.length))
      : () => {
          const id = ids.find((candidate) => candidate === value)
          if (id !== undefined) runCommand(id)
        }
    setOpen(false)
  }

  return (
    <Dialog
      open={open()}
      onOpenChange={(next) => setOpen(next)}
      onOpenChangeComplete={(next) => {
        if (next) return
        const run = chosen
        chosen = undefined
        run?.()
      }}
    >
      <DialogBackdrop class="bg-transparent" />
      <DialogContent class="mt-[12svh] mb-auto w-[min(520px,calc(100%-2rem))] gap-0 overflow-hidden p-0">
        <DialogTitle class="sr-only">Commands</DialogTitle>
        <Command onAction={choose} autoHighlight loop>
          <div class="flex h-8 items-center gap-2 border-b px-2.5 text-muted-foreground">
            <Search />
            <CommandInput
              autofocus
              aria-label="Search commands"
              placeholder="Search commands"
              autocomplete="off"
              spellcheck={false}
              class="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <CommandEmpty class="hidden px-2 py-6 text-center text-xs text-muted-foreground data-empty:block">
            No matching commands.
          </CommandEmpty>
          <CommandList class="max-h-[min(26rem,60svh)] overflow-y-auto overscroll-none p-1">
            <For each={groups}>
              {(group) => (
                <CommandGroup>
                  <CommandGroupLabel class="px-2 pt-2 pb-1 section-label leading-4">{group}</CommandGroupLabel>
                  <For each={runnable(group)}>
                    {(id) => (
                      <CommandItem value={id} label={commands[id].name} class={itemClass}>
                        <span class="min-w-0 truncate">{commands[id].name}</span>
                        <Show when={shortcut(id)}>
                          {(keys) => (
                            <span class="ms-auto">
                              <Kbd>{keys()}</Kbd>
                            </span>
                          )}
                        </Show>
                      </CommandItem>
                    )}
                  </For>
                  <Show when={group === "Repositories"}>
                    <For each={others()}>
                      {(path) => (
                        <CommandItem
                          value={`${SWITCH}${path}`}
                          label={`Switch to ${basename(path)}`}
                          keywords={[path]}
                          class={itemClass}
                        >
                          <span class="shrink-0">Switch to {basename(path)}</span>
                          <span class="min-w-0 truncate text-2xs text-muted-foreground group-data-highlighted/row:text-selection-foreground/70">
                            {dirname(path).slice(0, -1)}
                          </span>
                        </CommandItem>
                      )}
                    </For>
                  </Show>
                </CommandGroup>
              )}
            </For>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
