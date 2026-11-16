import { Toggle } from "@ui-sdk/solid/toggle"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { MenuCommand } from "@gitui/contracts"
import * as Schema from "effect/Schema"
import { desktop } from "@/lib/desktop"
import { menuCommandIds, menuShortcutTable, runCommand, shortcut, useCommand } from "@/lib/hotkeys"
import { toggleTheme } from "@/lib/theme"
import { collect, connection } from "@/lib/rpc"
import { backgroundFetch, changeColors, toggleDiffStyle, toggleFilesOpen, toggleWrapLines } from "@/lib/settings"
import { active, closeRepo, cycleRepo, paths, reopenRepo, setActive, workspaceFor } from "@/lib/workspaces"
import { PanelLeft } from "./components/icons"
import { CommandLog } from "./components/command-log"
import { CommitPreviewCard } from "./components/commit-mention"
import { FileIconSprite } from "./components/file-icon"
import { CredentialPrompts } from "./components/credentials"
import { Palette } from "./components/palette"
import { Picker } from "./components/picker"
import { Settings } from "./components/settings"
import { RepoSwitcher } from "./components/repo-switcher"
import { TopBarSlot } from "./components/top-bar"
import { Tip } from "./components/ui"
import { WorkspaceView } from "./components/workspace"

const isMenuCommand = Schema.is(MenuCommand)

const fetchQuietly = (path: string) => {
  try {
    const repo = untrack(workspaceFor(path).repo)
    void collect((git) => git.Fetch({ repo: repo.id })).then(
      () => repo.invalidate(["refs"]),
      () => undefined,
    )
  } catch {}
}

const titlebar = desktop !== undefined && /Mac/.test(navigator.platform)

const [fullScreen, setFullScreen] = createSignal(desktop?.isFullScreen() ?? false)
desktop?.onFullScreen((value) => setFullScreen(value === true))

export function App() {
  const workspace = createMemo(() => {
    const path = active()
    return path === null ? null : workspaceFor(path)
  })
  const mounted = createMemo((previous: ReadonlyArray<string> = []) => {
    const current = active()
    const open = previous.filter((path) => paths().includes(path))
    return current === null || open.includes(current) ? open : [...open, current]
  })
  const listShown = () => !(workspace()?.focused() ?? false)
  const showList = (shown: boolean) => workspace()?.setFocused(!shown)
  useCommand("view.sidebar", () => showList(!listShown()))
  createEffect(
    () => backgroundFetch(),
    (interval) => {
      if (interval === "off") return
      const timer = setInterval(() => untrack(paths).forEach(fetchQuietly), Number(interval) * 60_000)
      return () => clearInterval(timer)
    },
  )
  createEffect(changeColors, (colors) => {
    document.documentElement.dataset.changeColors = colors
  })
  createEffect(
    () => active(),
    (path) => {
      if (path === null) document.title = "Open a repository"
    },
  )
  useCommand("repo.open", () => setActive(null))
  useCommand("repo.close", () => {
    const path = active()
    if (path !== null) closeRepo(path)
  })
  useCommand("repo.reopen", reopenRepo)
  useCommand("theme.toggle", toggleTheme)
  if (desktop !== undefined) {
    desktop.setMenuShortcuts(untrack(menuShortcutTable))
    onCleanup(
      desktop.onCommand((value) => {
        if (isMenuCommand(value)) runCommand(menuCommandIds[value])
      }),
    )
  }
  useCommand("diff.layout", toggleDiffStyle)
  useCommand("diff.wrap", toggleWrapLines)
  useCommand("view.files", toggleFilesOpen)
  for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const)
    useCommand(`repo.switch${slot}`, () => {
      const list = paths()
      const path = slot === 9 ? list.at(-1) : list[slot - 1]
      if (path !== undefined) setActive(path)
    })
  useCommand("rail.next", () => cycleRepo(1))
  useCommand("rail.previous", () => cycleRepo(-1))
  return (
    <div class="relative flex h-full flex-col">
      <div
        data-titlebar={titlebar ? "" : undefined}
        class={[
          "@container/top flex h-9 shrink-0 items-center",
          workspace() === null ? (titlebar ? "absolute inset-x-0 top-0 z-10" : "hidden") : "border-b",
        ]}
      >
        <Show when={titlebar && !fullScreen()}>
          <div class="w-[72px] shrink-0" />
        </Show>
        <Show when={workspace() !== null} fallback={<div class="w-1.5 shrink-0" />}>
          <div class="flex shrink-0 ps-2 pe-0.5">
            <Tip label={listShown() ? "Hide the list" : "Show the list"} keys={shortcut("view.sidebar")}>
              {(trigger) => (
                <Toggle
                  {...trigger}
                  pressed={listShown()}
                  onPressedChange={showList}
                  aria-label="List"
                  class="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-pressed:text-foreground"
                >
                  <PanelLeft />
                </Toggle>
              )}
            </Tip>
          </div>
        </Show>
        <Show when={workspace() !== null}>
          <RepoSwitcher />
        </Show>
        <TopBarSlot />
        <Show when={connection() !== "connected"}>
          <span class="me-2 flex shrink-0 items-center gap-1.5 rounded bg-change-modified/12 px-1.5 py-0.5 text-2xs text-change-modified">
            <span class="size-1.5 rounded-full bg-current" />
            {connection() === "connecting" ? "Connecting" : "Reconnecting"}
          </span>
        </Show>
      </div>
      <CommandLog>
        <div class="flex min-h-0 flex-1">
          <main class="flex min-w-0 flex-1 flex-col">
            <For each={mounted()}>
              {(path) => (
                <div class={["min-h-0 flex-1 flex-col", active() === path ? "flex" : "hidden"]}>
                  <WorkspaceView workspace={workspaceFor(path)} />
                </div>
              )}
            </For>
            <Show when={active() === null}>
              <Picker />
            </Show>
          </main>
        </div>
      </CommandLog>
      <CommitPreviewCard />
      <CredentialPrompts />
      <Palette />
      <Settings />
      <FileIconSprite />
    </div>
  )
}
