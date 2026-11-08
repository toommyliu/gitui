import { useAtom, useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import * as Atom from "effect/reactivity/Atom"
import { useRef } from "react"
import { flushSync } from "react-dom"
import { useCompare } from "@/lib/comparison"
import { useCommand } from "@/lib/commands"
import { useConflictSession } from "@/lib/conflict-session"
import { type FileTarget, filePickerAtom } from "@/lib/file-investigation"
import { pathQuery, watchAtom } from "@/lib/git"
import { useNarrow } from "@/lib/narrow"
import { type Pane, paneAtom, selectionAtom, useSelect } from "@/lib/selection"
import { visibilityAtom } from "@/lib/visibility"
import { CommandLogDrawer } from "./command-log"
import { ComparisonDetail } from "./comparison-detail"
import { CommitDetail } from "./commit-detail"
import { CommitList } from "./commit-list"
import { ConflictWorkspace } from "./conflict-workspace"
import { FileHistoryView, FilePickerDialog } from "./file-investigation"
import { useNetworkCommands } from "./network"
import { Sidebar } from "./sidebar"
import { RemotesDialog } from "./remotes"
import { RecoveryDialog } from "./recovery"
import { WorkingCopy } from "./working-copy"
import { WorktreePreview } from "./worktree-preview"
import { RewriteDialog } from "./rewrite-dialog"

const paneLabels: Record<Pane, string> = { locations: "Locations", history: "History", detail: "Details" }

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
  const selection = useAtomValue(selectionAtom(repo))
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
  const select = useSelect(repo)
  const openFilePicker = useAtomSet(filePickerAtom(repo))
  const investigate = (target: FileTarget) =>
    select({ _tag: "FileHistory", target, back: selection._tag === "FileHistory" ? selection.back : selection })
  useCommand("history.file", () => openFilePicker(true))

  const detail =
    selection._tag === "Comparison" ? (
      <ComparisonDetail
        key={JSON.stringify([selection.comparison.base, selection.comparison.head])}
        repo={repo}
        comparison={selection.comparison}
        onSelect={select}
        onInvestigate={investigate}
      />
    ) : selection._tag === "Commit" ? (
      <CommitDetail key={selection.oid} repo={repo} oid={selection.oid} onSelect={select} onInvestigate={investigate} />
    ) : selection._tag === "FileHistory" ? (
      <FileHistoryView
        key={JSON.stringify(selection.target)}
        repo={repo}
        target={selection.target}
        onPick={() => openFilePicker(true)}
        onOpenCommit={(oid) => select({ _tag: "Commit", oid })}
        onClose={() => select(selection.back)}
      />
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
      <WorkingCopy key={repo} repo={repo} onInvestigate={investigate} />
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
      <RecoveryDialog repo={repo} onInspect={(oid) => select({ _tag: "Commit", oid })} />
      <RemotesDialog repo={repo} />
      <FilePickerDialog repo={repo} onPick={investigate} />
      <RewriteDialog repo={repo} onWorktree={() => select({ _tag: "WorkingCopy" })} />
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
