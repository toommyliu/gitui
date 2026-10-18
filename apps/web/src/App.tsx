import { PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@dnd-kit/helpers"
import { DragDropProvider, PointerSensor } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { useAtomValue } from "@effect/atom-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "cn"
import * as Cause from "effect/Cause"
import { XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Loading } from "@/components/loading"
import { RepoPicker } from "@/components/repo-picker"
import { Workspace } from "@/components/workspace"
import { basename } from "@/lib/format"
import { repoInfoAtom } from "@/lib/git"

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

  useEffect(() => localStorage.setItem("gitui.tabs", JSON.stringify(tabs)), [tabs])
  useEffect(() => localStorage.setItem("gitui.active", JSON.stringify(active)), [active])
  useEffect(() => {
    document.title = active ?? "Git"
  }, [active])

  const open = (path: string) => {
    setTabs((current) => (current.includes(path) ? current : [...current, path]))
    setActive(path)
  }
  const close = (path: string) => {
    const remaining = tabs.filter((tab) => tab !== path)
    setTabs(remaining)
    if (active === path) setActive(remaining.at(-1) ?? null)
  }

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={active ?? PICKER}
        onValueChange={(value: string) => setActive(value === PICKER ? null : value)}
        className="shrink-0 gap-0 border-b bg-muted/40"
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
      {active === null ? <RepoPicker onOpen={open} openPaths={tabs} /> : <RepoTab key={active} path={active} />}
    </div>
  )
}

function SortableRepoTab({ path, index, onClose }: { path: string; index: number; onClose: () => void }) {
  const { ref, handleRef } = useSortable({ id: path, index })
  return (
    <div ref={ref} className={cn(tabFrameClassName, "group/repo-tab pr-1")}>
      <TabsTrigger ref={handleRef} value={path} className={tabClassName}>
        {basename(path)}
      </TabsTrigger>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${basename(path)}`}
        onClick={onClose}
        className="opacity-50 group-hover/repo-tab:opacity-100"
      >
        <XIcon />
      </Button>
    </div>
  )
}

function RepoTab({ path }: { path: string }) {
  const info = useAtomValue(repoInfoAtom(path))
  if (info._tag === "Success") return <Workspace repo={info.value.id} />
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
