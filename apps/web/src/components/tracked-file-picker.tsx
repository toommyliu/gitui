import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { RepoId, RepoPath } from "@gitui/contracts"
import { cn } from "cn"
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react"
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { trackedFilesAtom } from "@/lib/file-investigation"
import { literalPath } from "@/lib/literal-path"
import { basename, dirname } from "@/lib/format"
import { latest, loadError } from "@/lib/git"
import { searchPaths } from "@/lib/path-search"
import { Loading, Nothing } from "./loading"

const LIMIT = 200
const PAGE = 10

export function TrackedFilePicker({ repo, onPick }: { repo: RepoId; onPick: (path: RepoPath) => void }) {
  const atom = trackedFilesAtom(repo)
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const files = latest(result)
  const error = loadError(result)
  const [query, setQuery] = useState("")
  const search = useDeferredValue(query)
  const [active, setActive] = useState(0)
  const { matches, total } = useMemo(() => searchPaths(files ?? [], search, LIMIT), [files, search])
  const current = Math.max(0, Math.min(active, matches.length - 1))
  const id = useId()
  const listId = `${id}-files`
  useEffect(() => {
    document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: "nearest" })
  }, [listId, current])

  const move = (delta: number) => setActive(Math.max(0, Math.min(matches.length - 1, current + delta)))
  const keys: Record<string, () => void> = {
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    PageDown: () => move(PAGE),
    PageUp: () => move(-PAGE),
    Enter: () => {
      const path = matches[current]
      if (path !== undefined) onPick(path)
    },
  }

  return (
    <>
      <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
        <DialogTitle className="text-sm">File history</DialogTitle>
        <DialogDescription>
          Choose a tracked file to see the commits that changed it, its contents, and blame at HEAD.
        </DialogDescription>
      </DialogHeader>
      <Field className="shrink-0 border-b p-3">
        <FieldLabel htmlFor={`${id}-query`}>Find a tracked file</FieldLabel>
        <Input
          id={`${id}-query`}
          autoFocus
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={matches.length > 0 ? `${listId}-${current}` : undefined}
          placeholder="src/app.tsx"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            const run = keys[event.key]
            if (run === undefined) return
            event.preventDefault()
            run()
          }}
        />
      </Field>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {files === undefined ? (
          error === undefined ? (
            <Loading label="Loading tracked files" />
          ) : (
            <Nothing title="Couldn't list tracked files" description={error} onRetry={refresh} />
          )
        ) : files.length === 0 ? (
          <Nothing title="No tracked files" description="Commit a file to see its history here." />
        ) : matches.length === 0 ? (
          <Nothing
            title="No matching files"
            description="Try part of the file name or a folder."
            action={{ label: "Clear search", onClick: () => setQuery("") }}
          />
        ) : (
          <ul id={listId} role="listbox" aria-label="Tracked files" className="py-1">
            {matches.map((path, index) => (
              <li
                key={path}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === current}
                title={literalPath(path)}
                className={cn(
                  "flex h-7 cursor-default items-center px-3",
                  index === current ? "bg-selection" : "hover:bg-muted/60",
                )}
                onMouseMove={() => setActive(index)}
                onClick={() => onPick(path)}
              >
                <span className="truncate">
                  {literalPath(path) !== path ? (
                    literalPath(path)
                  ) : (
                    <>
                      <span className="text-muted-foreground">{dirname(path)}</span>
                      {basename(path)}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p role="status" className="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground tabular-nums">
        {files === undefined
          ? ""
          : total > matches.length
            ? `Showing ${matches.length.toLocaleString()} of ${total.toLocaleString()} files. Type more to narrow the list.`
            : `${total.toLocaleString()} ${total === 1 ? "file" : "files"}`}
      </p>
    </>
  )
}
