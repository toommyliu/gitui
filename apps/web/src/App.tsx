import { useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import * as Cause from "effect/Cause"
import { useEffect, useState } from "react"
import { RepoPicker } from "@/components/repo-picker"
import { Workspace } from "@/components/workspace"
import { basename } from "@/lib/format"
import { repoInfoAtom } from "@/lib/git"

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
      <nav className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b bg-muted/40">
        {tabs.map((path) => (
          <div
            key={path}
            className={cn(
              "group flex shrink-0 items-center gap-1 border-r pr-1 pl-3",
              active === path ? "bg-background font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <button type="button" onClick={() => setActive(path)} className="h-full">
              {basename(path)}
            </button>
            <button
              type="button"
              aria-label={`Close ${basename(path)}`}
              onClick={() => close(path)}
              className="rounded-sm px-1 text-muted-foreground opacity-60 group-hover:opacity-100 hover:bg-muted"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setActive(null)}
          className={cn("px-3 text-muted-foreground hover:text-foreground", active === null && "bg-background")}
        >
          Open…
        </button>
      </nav>
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
        <p className="font-medium">Couldn't open {path}</p>
        <p className="text-muted-foreground">{Cause.pretty(info.cause).split("\n")[0]}</p>
      </div>
    )
  }
  return <div className="p-4 text-muted-foreground">Opening {basename(path)}…</div>
}
