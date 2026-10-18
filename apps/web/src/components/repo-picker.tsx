import { useAtom, useAtomValue } from "@effect/atom-react"
import type { DirectoryEntry, DirectoryListing } from "@gitui/contracts"
import { Button } from "@/components/ui/button"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { defaultFilter } from "cmdk"
import { ChevronRightIcon, CornerLeftUpIcon, FolderGit2Icon, FolderIcon, FolderOpenIcon } from "lucide-react"
import { useState } from "react"
import { desktop } from "@/lib/desktop"
import { directoryAtom, latest } from "@/lib/git"
import { settingsAtom } from "@/lib/settings"
import { SettingsDialog } from "./settings-dialog"

const CHOOSE = "choose"
const SUGGESTED = new Set(["projects", "code", "src", "dev", "developer", "repos", "git", "github", "workspace"])

export function RepoPicker({
  onOpen,
  openPaths,
}: {
  onOpen: (path: string) => void
  openPaths: ReadonlyArray<string>
}) {
  const [settings, setSettings] = useAtom(settingsAtom)
  const setBase = (repoBase: string | undefined) => {
    const { repoBase: _, ...rest } = settings
    setSettings(repoBase === undefined ? rest : { ...rest, repoBase })
  }
  if (settings.repoBase === undefined) return <ChooseBase onChoose={setBase} />
  return (
    <Browser
      base={settings.repoBase.trim() || "~"}
      onOpen={onOpen}
      openPaths={openPaths}
      onResetBase={() => setBase(undefined)}
    />
  )
}

const chooseFolder = (then: (folder: string) => void) =>
  void desktop?.pickFolder().then((folder) => {
    if (folder !== null) then(folder)
  })

function Browser({
  base,
  onOpen,
  openPaths,
  onResetBase,
}: {
  base: string
  onOpen: (path: string) => void
  openPaths: ReadonlyArray<string>
  onResetBase: () => void
}) {
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState("")
  const input = query === "~" ? "~/" : query
  const dir = input.slice(0, input.lastIndexOf("/") + 1)
  const filter = input.slice(dir.length)
  const absolute = dir.startsWith("/") || dir.startsWith("~")
  const target = absolute ? dir : `${base.replace(/\/+$/, "")}/${dir}`
  const label = target.length > 1 ? target.replace(/\/+$/, "") : target

  const result = useAtomValue(directoryAtom(target))
  const [shown, setShown] = useState<DirectoryListing | undefined>(undefined)
  if (result._tag === "Success" && result.value !== shown) setShown(result.value)
  const listing = result._tag === "Failure" ? undefined : shown

  const entries = (listing?.entries ?? [])
    .filter((entry) => filter.startsWith(".") || !entry.name.startsWith("."))
    .map((entry) => ({ entry, score: filter === "" ? 1 : defaultFilter(entry.name, filter) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry)
  const canGoUp = dir !== "" && dir !== "/" && dir !== "~/"
  const values = [
    ...(listing?.isRepo === true ? [listing.path] : []),
    ...entries.map((entry) => entry.path),
    ...(desktop !== undefined ? [CHOOSE] : []),
  ]
  const active = values.includes(highlighted) ? highlighted : (values[0] ?? "")

  const enter = (entry: DirectoryEntry) => setQuery(`${dir}${entry.name}/`)
  const goUp = () => setQuery(dir.replace(/[^/]+\/$/, ""))
  const select = (entry: DirectoryEntry) => (entry.isRepo ? onOpen(entry.path) : enter(entry))

  return (
    <div className="flex min-h-0 flex-1 justify-center p-4">
      <div className="flex h-fit max-h-full w-full max-w-lg flex-col rounded-xl border bg-popover">
        <Command shouldFilter={false} value={active} onValueChange={setHighlighted} className="min-h-0">
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={`Search ${base}, or type a path`}
            onKeyDown={(event) => {
              const entry = entries.find((candidate) => candidate.path === active)
              if (event.key !== "Tab" || event.shiftKey || entry === undefined) return
              event.preventDefault()
              enter(entry)
            }}
          />
          <CommandList className="max-h-[calc(100svh-11rem)]">
            {listing?.isRepo === true && (
              <CommandGroup>
                <CommandItem value={listing.path} onSelect={() => onOpen(listing.path)}>
                  <FolderOpenIcon />
                  Open {label}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup
              heading={
                <span className="flex items-center justify-between">
                  {label}
                  {canGoUp && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Up one folder"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={goUp}
                    >
                      <CornerLeftUpIcon />
                    </Button>
                  )}
                </span>
              }
            >
              {entries.map((entry) => (
                <CommandItem key={entry.path} value={entry.path} onSelect={() => select(entry)}>
                  {entry.isRepo ? <FolderGit2Icon /> : <FolderIcon className="text-muted-foreground" />}
                  <span className="truncate">{entry.name}</span>
                  <CommandShortcut className="tracking-normal">
                    {entry.isRepo ? openPaths.includes(entry.path) && "open" : <ChevronRightIcon />}
                  </CommandShortcut>
                </CommandItem>
              ))}
              {result._tag === "Failure" ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
                  <p>Couldn't read {label}.</p>
                  {!absolute && dir === "" && (
                    <Button size="sm" variant="outline" onClick={onResetBase}>
                      Choose another folder
                    </Button>
                  )}
                </div>
              ) : listing === undefined ? (
                <p className="py-6 text-center text-muted-foreground">Loading…</p>
              ) : (
                entries.length === 0 && (
                  <p className="py-6 text-center text-muted-foreground">
                    {filter === "" ? "No folders here." : "No folders match."}
                  </p>
                )
              )}
            </CommandGroup>
            {desktop !== undefined && (
              <CommandGroup>
                <CommandItem value={CHOOSE} onSelect={() => chooseFolder(onOpen)}>
                  <FolderIcon className="text-muted-foreground" />
                  Choose a folder…
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <div className="flex items-center gap-1.5 border-t py-1 pr-1 pl-3 text-muted-foreground">
          <Kbd>Tab</Kbd>
          <span>goes into a folder</span>
          <span className="ml-auto">
            <SettingsDialog />
          </span>
        </div>
      </div>
    </div>
  )
}

function ChooseBase({ onChoose }: { onChoose: (path: string) => void }) {
  const home = latest(useAtomValue(directoryAtom("~")))
  const suggestions = (home?.entries ?? []).filter((entry) => SUGGESTED.has(entry.name.toLowerCase()))
  const [draft, setDraft] = useState("")
  const path = draft.trim()

  return (
    <Empty className="justify-start pt-[15svh]">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderGit2Icon />
        </EmptyMedia>
        <EmptyTitle>Where do you keep your repositories?</EmptyTitle>
        <EmptyDescription>
          New tabs list the repositories in this folder, and you can type to search them. You can change it later in
          Settings.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="items-stretch">
        {suggestions.map((entry) => (
          <Suggestion key={entry.path} path={`~/${entry.name}`} onChoose={onChoose} />
        ))}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (path !== "") onChoose(path)
          }}
        >
          <Input
            autoFocus
            aria-label="Repositories folder"
            placeholder="Or type a path, like ~/code"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="font-mono"
          />
          <Button type="submit" disabled={path === ""}>
            Use folder
          </Button>
        </form>
        {desktop !== undefined && (
          <Button variant="outline" onClick={() => chooseFolder(onChoose)}>
            Choose a folder…
          </Button>
        )}
      </EmptyContent>
    </Empty>
  )
}

function Suggestion({ path, onChoose }: { path: string; onChoose: (path: string) => void }) {
  const repos = latest(useAtomValue(directoryAtom(path)))?.entries.filter((entry) => entry.isRepo).length
  return (
    <Button variant="outline" size="lg" className="justify-between" onClick={() => onChoose(path)}>
      <span className="font-mono">{path}</span>
      {repos !== undefined && (
        <span className="text-muted-foreground">{repos === 1 ? "1 repository" : `${repos} repositories`}</span>
      )}
    </Button>
  )
}
