import { PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@dnd-kit/helpers"
import { DragDropProvider, PointerSensor } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { useAtomValue } from "@effect/atom-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "cn"
import * as Cause from "effect/Cause"
import { XIcon } from "lucide-react"
import { type Ref, useEffect, useState } from "react"
import { Loading } from "@/components/loading"
import { RepoPicker } from "@/components/repo-picker"
import { SettingsDialog } from "@/components/settings-dialog"
import { Workspace } from "@/components/workspace"
import { basename } from "@/lib/format"
import { connectionAtom, keys, latest, repoInfoAtom, statusAtom } from "@/lib/git"
import { useRefreshOnFocus } from "@/lib/worktrees"
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
  const [tabs, setTabs] = useState<ReadonlyArray<string>>(() => stored("gitui.tabs", []))
  const [active, setActive] = useState<string | null>(() => stored("gitui.active", null))
  const connection = useAtomValue(connectionAtom)

  useEffect(() => localStorage.setItem("gitui.tabs", JSON.stringify(tabs)), [tabs])
  useEffect(() => localStorage.setItem("gitui.active", JSON.stringify(active)), [active])
  useEffect(() => {
    document.title = active ?? "Git"
  }, [active])

  const open = (path: string) => {
    setTabs((current) => (current.includes(path) ? current : [...current, path]))
    setActive(path)
  }
  const openWorktree = (path: string, family: ReadonlyArray<string>) => {
    setTabs((current) => {
      if (current.includes(path)) return current
      const parent = active === null ? -1 : current.indexOf(active)
      if (parent === -1) return [...current, path]
      let at = parent + 1
      while (at < current.length && family.includes(current[at]!)) at++
      return [...current.slice(0, at), path, ...current.slice(at)]
    })
    setActive(path)
  }
  const close = (path: string) => {
    const remaining = tabs.filter((tab) => tab !== path)
    setTabs(remaining)
    if (active === path) setActive(remaining.at(-1) ?? null)
  }

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
                setTabs((current) => arrayMove([...current], source.initialIndex, source.index))
              }}
            >
              <div className="flex h-full shrink-0">
                {tabs.map((path, index) => (
                  <SortableRepoTab key={path} path={path} index={index} onClose={() => close(path)} />
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
          {active !== null && <SettingsDialog icon />}
        </div>
      </div>
      {active === null ? (
        <RepoPicker onOpen={open} openPaths={tabs} />
      ) : (
        <RepoTab key={active} path={active} onOpenWorktree={openWorktree} />
      )}
    </div>
  )
}

function SortableRepoTab({ path, index, onClose }: { path: string; index: number; onClose: () => void }) {
  const { ref, handleRef } = useSortable({ id: path, index })
  const info = latest(useAtomValue(repoInfoAtom(path)))
  return (
    <div ref={ref} className={cn(tabFrameClassName, "group/repo-tab pr-1")}>
      {info === undefined ? (
        <RepoTabHandle handleRef={handleRef} path={path} label={basename(path)} dirty={false} onClose={onClose} />
      ) : (
        <OpenRepoTabHandle handleRef={handleRef} path={path} info={info} onClose={onClose} />
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
  onClose: () => void
}) {
  useRefreshOnFocus([keys.status(info.id)])
  const status = latest(useAtomValue(statusAtom(info.id)))
  const linked = info.gitDir !== info.commonDir
  const label = linked && status?.head._tag === "Branch" ? status.head.name : basename(props.path)
  return <RepoTabHandle {...props} label={label} dirty={(status?.entries.length ?? 0) > 0} />
}

function RepoTabHandle({
  handleRef,
  path,
  label,
  dirty,
  onClose,
}: {
  handleRef: Ref<HTMLButtonElement>
  path: string
  label: string
  dirty: boolean
  onClose: () => void
}) {
  return (
    <>
      <TabsTrigger ref={handleRef} value={path} title={path} className={tabClassName}>
        {label}
      </TabsTrigger>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={dirty ? `Close ${label}, which has uncommitted changes` : `Close ${label}`}
        title={dirty ? "Uncommitted changes" : undefined}
        onClick={onClose}
        className={cn("group/close", !dirty && "opacity-50 group-hover/repo-tab:opacity-100")}
      >
        {dirty && (
          <span className="size-2 rounded-full bg-current group-hover/close:hidden group-focus-visible/close:hidden" />
        )}
        <XIcon className={cn(dirty && "hidden group-hover/close:block group-focus-visible/close:block")} />
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
