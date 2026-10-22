import { PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@dnd-kit/helpers"
import { DragDropProvider, PointerSensor } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useHotkeyHint, useHotkeys } from "@tanstack/react-hotkeys"
import { cn } from "cn"
import * as Cause from "effect/Cause"
import { SettingsIcon, XIcon } from "lucide-react"
import { type Ref, useEffect, useState } from "react"
import { CommandPalette } from "@/components/command-palette"
import { Loading } from "@/components/loading"
import { useBackgroundFetch } from "@/components/network"
import { RepoPicker } from "@/components/repo-picker"
import { SettingsPage } from "@/components/settings-page"
import { useTheme } from "@/components/theme-provider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Workspace } from "@/components/workspace"
import { paletteOpenAtom, tabKeys, useCommand, useDesktopMenu, useOverlayOpen } from "@/lib/commands"
import { desktop } from "@/lib/desktop"
import { basename } from "@/lib/format"
import { connectionAtom, keys, latest, repoInfoAtom, statusAtom } from "@/lib/git"
import { addRecent, recentAtom } from "@/lib/places"
import { settingsAtom, settingsViewAtom } from "@/lib/settings"
import { closeTab, cycleTab, openTab, reopenTab, type TabState, tabNumber } from "@/lib/tabs"
import { repoNameOf, useRefreshOnFocus } from "@/lib/worktrees"
import type { RepoInfo } from "@gitui/contracts"

const PICKER = "\0picker"
const tabClassName =
  "h-full flex-none rounded-none px-3 after:hidden focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none"
const tabFrameClassName =
  "flex h-full shrink-0 items-center border-r ring-ring ring-inset has-data-active:bg-background has-[[role=tab]:focus-visible]:ring-2"

const tabSensors = [
  PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })] }),
]
const tabModifiers = [RestrictToElement.configure({ element: ({ source }) => source?.element?.parentElement ?? null })]

const stored = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function App() {
  const [{ tabs, active, closed }, setTabState] = useState<TabState>(() => ({
    tabs: stored("gitui.tabs", []),
    active: stored("gitui.active", null),
    closed: [],
  }))
  const setActive = (active: string | null) => setTabState((current) => ({ ...current, active }))
  const connection = useAtomValue(connectionAtom)
  const navigateSettings = useAtomSet(settingsViewAtom)
  const overlayOpen = useOverlayOpen()
  const setPaletteOpen = useAtomSet(paletteOpenAtom)
  useDesktopMenu()
  useBackgroundFetch(tabs)
  useCommand("settings.open", () => {
    setPaletteOpen(false)
    navigateSettings("open")
  })
  useCommand("palette.open", () => setPaletteOpen(true))
  const { resolvedTheme, setTheme } = useTheme()
  useCommand("theme.toggle", () => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
  const [settings, setSettings] = useAtom(settingsAtom)
  const setRecent = useAtomSet(recentAtom)
  const remember = (path: string) => setRecent((recent) => addRecent(recent, path))
  useCommand("diff.wrap", () => setSettings({ ...settings, wrapLines: !settings.wrapLines }))
  useCommand("diff.layout", () =>
    setSettings({ ...settings, diffStyle: settings.diffStyle === "split" ? "unified" : "split" }),
  )

  useEffect(() => localStorage.setItem("gitui.tabs", JSON.stringify(tabs)), [tabs])
  useEffect(() => localStorage.setItem("gitui.active", JSON.stringify(active)), [active])
  useEffect(() => {
    document.title = active ?? "Git"
  }, [active])

  const open = (path: string) => {
    remember(path)
    setTabState((current) => openTab(current, path))
  }
  const openWorktree = (path: string, family: ReadonlyArray<string>) => {
    remember(path)
    setTabState((current) => openTab(current, path, family))
  }
  const close = (path: string) => {
    remember(path)
    setTabState((current) => closeTab(current, path))
  }

  useCommand("repo.open", () => {
    if (active !== null || desktop === undefined) return setActive(null)
    void desktop.pickFolder().then((folder) => {
      if (folder !== null) open(folder)
    })
  })
  useCommand("tab.close", () => {
    if (active !== null) close(active)
  })
  useCommand(
    "tab.reopen",
    () => {
      const tab = closed.at(-1)
      if (tab !== undefined) remember(tab.path)
      setTabState(reopenTab)
    },
    { enabled: closed.length > 0 },
  )
  useCommand("tab.next", () => setActive(cycleTab(tabs, active, 1)))
  useCommand("tab.previous", () => setActive(cycleTab(tabs, active, -1)))
  useHotkeys(
    tabKeys.map((hotkey, index) => ({
      hotkey,
      callback: () => {
        const tab = index === tabKeys.length - 1 ? tabs.at(-1) : tabs[index]
        if (tab !== undefined) setActive(tab)
      },
    })),
    { enabled: !overlayOpen },
  )
  const showTabNumbers = useHotkeyHint(tabKeys[0]) && !overlayOpen

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b bg-muted/40">
        <Tabs
          value={active ?? PICKER}
          onValueChange={(value: string) => setActive(value === PICKER ? null : value)}
          className="min-w-0 flex-1 gap-0"
        >
          <TabsList
            variant="line"
            className="h-8 w-full [scrollbar-width:none] justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-none p-0"
          >
            <DragDropProvider
              sensors={tabSensors}
              modifiers={tabModifiers}
              onDragEnd={({ canceled, operation: { source } }) => {
                if (canceled || !isSortable(source)) return
                setTabState((current) => ({
                  ...current,
                  tabs: arrayMove([...current.tabs], source.initialIndex, source.index),
                }))
              }}
            >
              <div className="flex h-full shrink-0">
                {tabs.map((path, index) => (
                  <SortableRepoTab
                    key={path}
                    path={path}
                    index={index}
                    shortcut={showTabNumbers ? tabNumber(tabs.length, index) : undefined}
                    onClose={() => close(path)}
                  />
                ))}
              </div>
            </DragDropProvider>
            <div className={tabFrameClassName}>
              <TabsTrigger value={PICKER} className={tabClassName}>
                Open…
              </TabsTrigger>
            </div>
          </TabsList>
        </Tabs>
        <div className="flex shrink-0 items-center gap-1 px-1">
          {connection === "disconnected" && (
            <Badge variant="destructive">
              <Spinner data-icon="inline-start" />
              Reconnecting to server
            </Badge>
          )}
          {desktop === undefined && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Settings"
                    onClick={() => navigateSettings("open")}
                  />
                }
              >
                <SettingsIcon />
              </TooltipTrigger>
              <TooltipContent side="bottom">Settings</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      {active === null ? (
        <RepoPicker onOpen={open} openPaths={tabs} />
      ) : (
        <RepoTab key={active} path={active} onOpenWorktree={openWorktree} />
      )}
      <SettingsPage />
      <CommandPalette />
    </div>
  )
}

function SortableRepoTab({
  path,
  index,
  shortcut,
  onClose,
}: {
  path: string
  index: number
  shortcut: number | undefined
  onClose: () => void
}) {
  const { ref, handleRef } = useSortable({ id: path, index })
  const info = latest(useAtomValue(repoInfoAtom(path)))
  return (
    <div ref={ref} className={cn(tabFrameClassName, "group/repo-tab pr-1")}>
      {info === undefined ? (
        <RepoTabHandle
          handleRef={handleRef}
          path={path}
          label={basename(path)}
          dirty={false}
          shortcut={shortcut}
          onClose={onClose}
        />
      ) : (
        <OpenRepoTabHandle handleRef={handleRef} path={path} info={info} shortcut={shortcut} onClose={onClose} />
      )}
    </div>
  )
}

function OpenRepoTabHandle({
  info,
  ...props
}: {
  handleRef: Ref<HTMLButtonElement>
  path: string
  info: RepoInfo
  shortcut: number | undefined
  onClose: () => void
}) {
  useRefreshOnFocus([keys.status(info.id)])
  const status = latest(useAtomValue(statusAtom(info.id)))
  const linked = info.gitDir !== info.commonDir
  const label = linked && status?.head._tag === "Branch" ? status.head.name : basename(props.path)
  return (
    <RepoTabHandle
      {...props}
      repo={linked ? repoNameOf(info.commonDir) : undefined}
      label={label}
      dirty={(status?.entries.length ?? 0) > 0}
    />
  )
}

function RepoTabHandle({
  handleRef,
  path,
  repo,
  label,
  dirty,
  shortcut,
  onClose,
}: {
  handleRef: Ref<HTMLButtonElement>
  path: string
  repo?: string | undefined
  label: string
  dirty: boolean
  shortcut: number | undefined
  onClose: () => void
}) {
  return (
    <>
      <TabsTrigger ref={handleRef} value={path} title={path} className={tabClassName}>
        {repo !== undefined && <span className="opacity-60">{repo}</span>}
        {label}
      </TabsTrigger>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={dirty ? `Close ${label}, which has uncommitted changes` : `Close ${label}`}
        title={dirty ? "Uncommitted changes" : undefined}
        onClick={onClose}
        className={cn("group/close", !dirty && shortcut === undefined && "opacity-50 group-hover/repo-tab:opacity-100")}
      >
        {shortcut !== undefined ? (
          <Kbd>{shortcut}</Kbd>
        ) : (
          <>
            {dirty && (
              <span className="size-2 rounded-full bg-current group-hover/close:hidden group-focus-visible/close:hidden" />
            )}
            <XIcon className={cn(dirty && "hidden group-hover/close:block group-focus-visible/close:block")} />
          </>
        )}
      </Button>
    </>
  )
}

function RepoTab({
  path,
  onOpenWorktree,
}: {
  path: string
  onOpenWorktree: (path: string, family: ReadonlyArray<string>) => void
}) {
  const info = useAtomValue(repoInfoAtom(path))
  if (info._tag === "Success") return <Workspace repo={info.value.id} onOpenWorktree={onOpenWorktree} />
  if (info._tag === "Failure") {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTitle>Couldn't open {path}</AlertTitle>
          <AlertDescription>{Cause.pretty(info.cause).split("\n")[0]}</AlertDescription>
        </Alert>
      </div>
    )
  }
  return <Loading label={`Opening ${basename(path)}`} />
}
