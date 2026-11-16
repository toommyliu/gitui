import { createSignal } from "solid-js"
import { useCommand } from "@/lib/hotkeys"
import { AddWorktreeDialog } from "./add-dialog"
import { CleanupBranchesDialog } from "../refs/cleanup-branches"
import { CleanupWorktreesDialog } from "./cleanup-dialog"

export function WorktreeLauncher() {
  const [adding, setAdding] = createSignal(false)
  const [cleaning, setCleaning] = createSignal(false)
  const [pruning, setPruning] = createSignal(false)
  useCommand("repo.addWorktree", () => setAdding(true))
  useCommand("repo.cleanupWorktrees", () => setCleaning(true))
  useCommand("repo.cleanupBranches", () => setPruning(true))
  return (
    <>
      <AddWorktreeDialog open={adding()} onOpenChange={setAdding} />
      <CleanupWorktreesDialog open={cleaning()} onOpenChange={setCleaning} />
      <CleanupBranchesDialog open={pruning()} onOpenChange={setPruning} />
    </>
  )
}
