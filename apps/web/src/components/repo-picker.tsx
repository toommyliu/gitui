import { useAtomValue } from "@effect/atom-react"
import { Badge } from "@workspace/ui/components/badge"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { useState } from "react"
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
  const path = query.trim()

  return (
    <div className="flex min-h-0 flex-1 justify-center p-4">
      <Command className="h-fit max-h-full w-full max-w-lg border">
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Filter by name, or type an absolute path"
        />
        <CommandList className="max-h-[calc(100svh-8rem)]">
          <CommandEmpty>No repositories match.</CommandEmpty>
          {path.startsWith("/") && (
            <CommandGroup heading="Path">
              <CommandItem value={`open ${path}`} forceMount onSelect={() => onOpen(path)}>
                Open <span className="font-mono">{path}</span>
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading="Repositories">
            {repos.map((repo) => (
              <CommandItem key={repo.path} value={repo.path} keywords={[repo.name]} onSelect={() => onOpen(repo.path)}>
                <span className="font-medium">{repo.name}</span>
                <span className="truncate text-muted-foreground">{repo.path}</span>
                {openPaths.includes(repo.path) && (
                  <Badge variant="secondary" className="ml-auto">
                    open
                  </Badge>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}
