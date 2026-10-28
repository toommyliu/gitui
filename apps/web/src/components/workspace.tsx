import { useAtom, useAtomMount } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import * as Atom from "effect/reactivity/Atom"
import { useRef } from "react"
import { flushSync } from "react-dom"
import { useCompare } from "@/lib/comparison"
import { useCommand } from "@/lib/commands"
import { useConflictSession } from "@/lib/conflict-session"
import { pathQuery, watchAtom } from "@/lib/git"
import { useNarrow } from "@/lib/narrow"
import type { Selection } from "@/lib/selection"
import { visibilityAtom } from "@/lib/visibility"
import { CommandLogDrawer } from "./command-log"
import { ComparisonDetail } from "./comparison-detail"
import { ComparisonDialog } from "./comparison-dialog"
import { CommitDetail } from "./commit-detail"
import { CommitList } from "./commit-list"
import { ConflictWorkspace } from "./conflict-workspace"
import { useNetworkCommands } from "./network"
import { Sidebar } from "./sidebar"
import { RemotesDialog } from "./remotes"
import { WorkingCopy } from "./working-copy"
import { WorktreePreview } from "./worktree-preview"

type Pane = "locations" | "history" | "detail"
const paneLabels: Record<Pane, string> = { locations: "Locations", history: "History", detail: "Details" }

const selectionAtom = Atom.family((_repo: RepoId) => Atom.make<Selection>({ _tag: "WorkingCopy" }).pipe(Atom.keepAlive))
const paneAtom = Atom.family((_repo: RepoId) => Atom.make<Pane>("history").pipe(Atom.keepAlive))
const queryAtom = Atom.family((_repo: RepoId) => Atom.make("").pipe(Atom.keepAlive))

export function Workspace({
  repo,
  commonDir,
  onOpenWorktree,
}: {
  repo: RepoId
  commonDir: string
  onOpenWorktree: (path: string, family: ReadonlyArray<string>) => void
}) {
  useAtomMount(watchAtom(repo))
  useNetworkCommands(repo)
  const narrow = useNarrow()
  const [selection, setSelection] = useAtom(selectionAtom(repo))
  const openCompare = useCompare(repo)
  useCommand("history.compare", () =>
    openCompare({
      head: selection._tag === "Commit" ? selection.oid : "HEAD",
      mode: selection._tag === "Commit" ? "direct" : "merge-base",
    }),
  )
  const [pane, setPane] = useAtom(paneAtom(repo))
  const [query, setQuery] = useAtom(queryAtom(repo))
  const [visibility, setVisibility] = useAtom(visibilityAtom(commonDir))
  const [conflictSession] = useConflictSession(repo)
  const searchRef = useRef<HTMLInputElement>(null)
  useCommand("history.search", () => {
    if (narrow) flushSync(() => setPane("history"))
    searchRef.current?.focus()
    searchRef.current?.select()
  })
  const showHistory = (path: string) => {
    setQuery(pathQuery(path))
    if (narrow) setPane("history")
  }

  const select = (next: Selection) => {
    setSelection(next)
    if (narrow) setPane("detail")
  }

  const detail =
    selection._tag === "Comparison" ? (
      <ComparisonDetail
        key={JSON.stringify([selection.comparison.base, selection.comparison.head])}
        repo={repo}
        comparison={selection.comparison}
        onSelect={select}
        onHistory={showHistory}
      />
    ) : selection._tag === "Commit" ? (
      <CommitDetail key={selection.oid} repo={repo} oid={selection.oid} onSelect={select} onHistory={showHistory} />
    ) : selection._tag === "Worktree" ? (
      <WorktreePreview
        key={selection.path}
        repo={repo}
        path={selection.path}
        onSelect={select}
        onOpen={onOpenWorktree}
        onHistory={showHistory}
      />
    ) : (
      <WorkingCopy key={repo} repo={repo} onHistory={showHistory} />
    )
  const sidebar = (
    <Sidebar
      repo={repo}
      selection={selection}
      onSelect={select}
      onOpen={onOpenWorktree}
      visibility={visibility}
      onVisibilityChange={setVisibility}
    />
  )
  const history = (
    <CommitList
      repo={repo}
      selection={selection}
      onSelect={select}
      visibility={visibility}
      query={query}
      onQueryChange={setQuery}
      searchRef={searchRef}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RemotesDialog repo={repo} />
      <ComparisonDialog repo={repo} onSelect={select} />
      <CommandLogDrawer repo={repo}>
        {conflictSession.open ? (
          <ConflictWorkspace repo={repo} />
        ) : narrow ? (
          <Tabs value={pane} onValueChange={(value: Pane) => setPane(value)} className="h-full gap-0">
            <TabsList variant="line" className="h-9 w-full shrink-0 rounded-none border-b p-0">
              {(Object.keys(paneLabels) as Array<Pane>).map((p) => (
                <TabsTrigger key={p} value={p} className="h-full rounded-none">
                  {paneLabels[p]}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="locations" className="min-h-0">
              {sidebar}
            </TabsContent>
            <TabsContent value="history" className="min-h-0">
              {history}
            </TabsContent>
            <TabsContent value="detail" className="min-h-0">
              {detail}
            </TabsContent>
          </Tabs>
        ) : (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="18%" minSize="10%">
              {sidebar}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize="38%" minSize="20%">
              {history}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel minSize="25%">{detail}</ResizablePanel>
          </ResizablePanelGroup>
        )}
      </CommandLogDrawer>
    </div>
  )
}
