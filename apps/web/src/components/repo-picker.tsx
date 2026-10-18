import { useAtomValue } from "@effect/atom-react"
import { Input } from "@workspace/ui/components/input"
import { cn } from "cn"
import { useMemo, useState } from "react"
import { latest, reposAtom } from "@/lib/git"

export function RepoPicker({
  onOpen,
  openPaths,
}: {
  onOpen: (path: string) => void
  openPaths: ReadonlyArray<string>
}) {
  const repos = latest(useAtomValue(reposAtom)) ?? []
  const [query, setQuery] = useState("")
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q === "" ? repos : repos.filter((r) => r.name.toLowerCase().includes(q))
  }, [repos, query])
  const isPath = query.startsWith("/")

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-auto p-4">
      <div className="flex w-full max-w-lg flex-col gap-2">
        <h1 className="text-sm font-semibold">Open a repository</h1>
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            if (isPath) onOpen(query.trim())
            else if (matches[0] !== undefined) onOpen(matches[0].path)
          }}
          placeholder="Filter by name, or type an absolute path"
        />
        {isPath && (
          <button
            type="button"
            onClick={() => onOpen(query.trim())}
            className="rounded-md px-2 py-1.5 text-left hover:bg-muted"
          >
            Open <span className="font-mono">{query.trim()}</span>
          </button>
        )}
        <ul className="divide-y rounded-md border">
          {matches.map((repo) => (
            <li key={repo.path}>
              <button
                type="button"
                onClick={() => onOpen(repo.path)}
                className={cn("flex w-full items-baseline gap-2 px-2 py-1.5 text-left hover:bg-muted")}
              >
                <span className="font-medium">{repo.name}</span>
                <span className="truncate text-muted-foreground">{repo.path}</span>
                {openPaths.includes(repo.path) && <span className="ml-auto shrink-0 text-muted-foreground">open</span>}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">No repositories match.</li>}
        </ul>
      </div>
    </div>
  )
}
