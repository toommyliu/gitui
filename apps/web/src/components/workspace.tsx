import { useAtomMount } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useState } from "react"
import { pathQuery, watchAtom } from "@/lib/git"
import { useNarrow } from "@/lib/narrow"
import type { Selection } from "@/lib/selection"
import { CommandLogDrawer } from "./command-log"
import { CommitDetail } from "./commit-detail"
import { CommitList } from "./commit-list"
import { Sidebar } from "./sidebar"
import { WorkingCopy } from "./working-copy"

type Pane = "locations" | "history" | "detail"
const paneLabels: Record<Pane, string> = { locations: "Locations", history: "History", detail: "Details" }

export function Workspace({ repo }: { repo: RepoId }) {
  useAtomMount(watchAtom(repo))
  const narrow = useNarrow()
  const [selection, setSelection] = useState<Selection>({ _tag: "WorkingCopy" })
  const [pane, setPane] = useState<Pane>("history")
  const [query, setQuery] = useState("")
  const showHistory = (path: string) => {
    setQuery(pathQuery(path))
    if (narrow) setPane("history")
  }

  const select = (next: Selection) => {
    setSelection(next)
    if (narrow) setPane("detail")
  }

  const detail =
    selection._tag === "Commit" ? (
      <CommitDetail repo={repo} oid={selection.oid} onSelect={select} onHistory={showHistory} />
    ) : (
      <WorkingCopy repo={repo} onHistory={showHistory} />
    )
  const sidebar = <Sidebar repo={repo} onSelect={select} />
  const history = (
    <CommitList repo={repo} selection={selection} onSelect={select} query={query} onQueryChange={setQuery} />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CommandLogDrawer repo={repo}>
        {narrow ? (
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
