import { useAtomMount } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@workspace/ui/components/resizable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { useState, useSyncExternalStore } from "react"
import { watchAtom } from "@/lib/git"
import type { Selection } from "@/lib/selection"
import { CommitDetail } from "./commit-detail"
import { CommitList } from "./commit-list"
import { Sidebar } from "./sidebar"
import { Toolbar } from "./toolbar"
import { WorkingCopy } from "./working-copy"

const narrowQuery = window.matchMedia("(max-width: 767px)")
const useNarrow = () =>
  useSyncExternalStore(
    (notify) => {
      narrowQuery.addEventListener("change", notify)
      return () => narrowQuery.removeEventListener("change", notify)
    },
    () => narrowQuery.matches,
  )

type Pane = "locations" | "history" | "detail"
const paneLabels: Record<Pane, string> = { locations: "Locations", history: "History", detail: "Details" }

export function Workspace({ repo }: { repo: RepoId }) {
  useAtomMount(watchAtom(repo))
  const narrow = useNarrow()
  const [selection, setSelection] = useState<Selection>({ _tag: "WorkingCopy" })
  const [pane, setPane] = useState<Pane>("history")

  const select = (next: Selection) => {
    setSelection(next)
    if (narrow) setPane("detail")
  }

  const detail =
    selection._tag === "Commit" ? (
      <CommitDetail repo={repo} oid={selection.oid} onSelect={select} />
    ) : (
      <WorkingCopy repo={repo} />
    )
  const sidebar = <Sidebar repo={repo} onSelect={select} />
  const history = <CommitList repo={repo} selection={selection} onSelect={select} />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar repo={repo} />
      {narrow ? (
        <Tabs value={pane} onValueChange={(value: Pane) => setPane(value)} className="min-h-0 flex-1 gap-0">
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
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
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
    </div>
  )
}
