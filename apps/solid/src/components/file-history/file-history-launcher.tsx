import type { RepoPath } from "@gitui/contracts"
import { createEffect, createSignal, Show } from "solid-js"
import { useCommand } from "@/lib/hotkeys"
import { active, workspaceFor } from "@/lib/workspaces"
import { FileHistoryView } from "./file-history-view"
import { FilePicker } from "./file-picker"

export function FileHistoryLauncher() {
  const [picking, setPicking] = createSignal(false)
  const [path, setPath] = createSignal<RepoPath | null>(null)
  const [workspacePath, setWorkspacePath] = createSignal<string | null>(null)
  useCommand("history.file", () => {
    setWorkspacePath(active())
    setPicking(true)
  })
  createEffect(
    () => {
      const owner = workspacePath()
      return owner === null ? null : workspaceFor(owner).view()
    },
    (_view, previous) => {
      if (previous !== undefined) setPath(null)
    },
  )
  return (
    <>
      <FilePicker
        open={picking()}
        onOpenChange={setPicking}
        onPick={(picked) => {
          setPicking(false)
          setPath(picked)
        }}
      />
      <Show when={path()} keyed>
        {(current) => (
          <div class="absolute inset-0 z-20 flex flex-col bg-background">
            <FileHistoryView path={current} onClose={() => setPath(null)} />
          </div>
        )}
      </Show>
    </>
  )
}
