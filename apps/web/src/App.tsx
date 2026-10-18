import { useAtomValue } from "@effect/atom-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import * as Cause from "effect/Cause"
import { XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Loading } from "@/components/loading"
import { RepoPicker } from "@/components/repo-picker"
import { Workspace } from "@/components/workspace"
import { basename } from "@/lib/format"
import { repoInfoAtom } from "@/lib/git"

const PICKER = "\0picker"

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
        <TabsList variant="line" className="h-8 w-full justify-start gap-0 overflow-x-auto rounded-none p-0">
          {tabs.map((path) => (
            <div key={path} className="group/repo-tab flex h-full shrink-0 items-center border-r pr-1">
              <TabsTrigger value={path} className="h-full flex-none rounded-none px-3">
                {basename(path)}
              </TabsTrigger>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Close ${basename(path)}`}
                onClick={() => close(path)}
                className="opacity-50 group-hover/repo-tab:opacity-100"
              >
                <XIcon />
              </Button>
            </div>
          ))}
          <TabsTrigger value={PICKER} className="h-full flex-none rounded-none px-3">
            Open…
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {active === null ? <RepoPicker onOpen={open} openPaths={tabs} /> : <RepoTab key={active} path={active} />}
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
