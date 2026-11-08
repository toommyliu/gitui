import { useAtom, useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { cn } from "cn"
import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { basename } from "@/lib/format"
import { latest, refsAtom, useGitAction } from "@/lib/git"
import { LIST_ROW } from "@/lib/rows"
import {
  bulkSelectable,
  type Candidate,
  cleanupCandidates,
  cleanupAtom,
  selectable,
  type Staleness,
  suggested,
  uncommittedChanges,
  unmergedCommits,
} from "@/lib/worktree-cleanup"
import { worktreeLabel, worktreeSummariesAtom } from "@/lib/worktrees"

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`

const reason = (staleness: Staleness) => {
  switch (staleness._tag) {
    case "Missing":
      return "Folder is missing"
    case "Landed":
      return "Nothing of its own"
    case "Gone":
      return `Branch deleted on the remote · ${plural(staleness.commits, "commit")}`
    case "Unmerged":
      return plural(staleness.commits, "unmerged commit")
    case "Dirty":
      return plural(staleness.changes, "uncommitted change")
    case "Locked":
      return "Locked"
    case "Checking":
      return "Checking…"
  }
}

export function CleanupWorktreesDialog({ repo }: { repo: RepoId }) {
  const [request, setRequest] = useAtom(cleanupAtom(repo))
  return (
    <Dialog open={request !== null} onOpenChange={(open) => open || setRequest(null)}>
      <DialogContent className="flex max-h-[min(40rem,calc(100dvh-2rem))] flex-col gap-3 sm:max-w-xl">
        {request !== null && <CleanupForm repo={repo} preset={request.preset} onClose={() => setRequest(null)} />}
      </DialogContent>
    </Dialog>
  )
}

function CleanupForm({
  repo,
  preset,
  onClose,
}: {
  repo: RepoId
  preset: ReadonlySet<string> | null
  onClose: () => void
}) {
  const git = useGitAction()
  const refs = latest(useAtomValue(refsAtom(repo)))
  const summaries = latest(useAtomValue(worktreeSummariesAtom(repo)))
  const candidates = cleanupCandidates(refs?.worktrees ?? [], summaries, refs?.branches ?? [], repo)
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [deleteBranches, setDeleteBranches] = useState(true)
  const branchesId = useId()
  const checked = (candidate: Candidate) =>
    selectable(candidate.staleness) &&
    (overrides.get(candidate.worktree.path) ??
      (preset === null ? suggested(candidate.staleness) : preset.has(candidate.worktree.path)))
  const picked = candidates.filter(checked)
  const lostCommits = deleteBranches
    ? picked.reduce(
        (total, candidate) =>
          total + (candidate.worktree.head._tag === "Branch" ? unmergedCommits(candidate.staleness) : 0),
        0,
      )
    : 0
  const dirty = picked.filter((candidate) => uncommittedChanges(candidate.staleness) > 0)
  const discarded = dirty.reduce((total, candidate) => total + uncommittedChanges(candidate.staleness), 0)
  const bulk = candidates.filter((candidate) => bulkSelectable(candidate.staleness))
  const allPicked = bulk.length > 0 && bulk.every(checked)
  const somePicked = bulk.some(checked)
  const pickAll = (next: boolean) =>
    setOverrides((current) => {
      const updated = new Map(current)
      for (const candidate of bulk) updated.set(candidate.worktree.path, next)
      return updated
    })

  const remove = async () => {
    onClose()
    let removed = 0
    const missing = picked.filter((candidate) => candidate.staleness._tag === "Missing")
    for (const { worktree, staleness } of picked) {
      if (staleness._tag === "Missing") continue
      const hasBranch = worktree.head._tag === "Branch"
      const ok = await git(`Remove ${worktreeLabel(worktree)}`, repo, (c) =>
        c("RemoveWorktree", {
          repo,
          path: worktree.path,
          force: uncommittedChanges(staleness) > 0 || (deleteBranches && hasBranch && unmergedCommits(staleness) > 0),
          deleteBranch: deleteBranches && hasBranch,
        }),
      )
      if (ok) removed++
    }
    if (missing.length > 0 && (await git("Prune worktrees", repo, (c) => c("PruneWorktrees", { repo })))) {
      removed += missing.length
      if (deleteBranches) {
        for (const { worktree } of missing) {
          if (worktree.head._tag !== "Branch") continue
          const name = worktree.head.name
          await git(`Delete ${name}`, repo, (c) =>
            c("DeleteBranch", { repo, name, force: false, removeWorktree: false }),
          )
        }
      }
    }
    if (removed > 0) toast.success(`Removed ${plural(removed, "worktree")}`)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Clean up worktrees</DialogTitle>
        <DialogDescription>
          Worktrees that look finished are checked. Ones with uncommitted changes are left unchecked, and removing them
          discards those changes.
        </DialogDescription>
      </DialogHeader>
      {candidates.length === 0 ? (
        <p className="text-muted-foreground">There are no other worktrees.</p>
      ) : (
        <div className="flex max-h-96 min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
          <label
            htmlFor={`${branchesId}-all`}
            className="flex shrink-0 items-center gap-2 border-b px-3"
            style={{ height: LIST_ROW + 4 }}
          >
            <Checkbox
              id={`${branchesId}-all`}
              disabled={bulk.length === 0}
              checked={allPicked}
              indeterminate={somePicked && !allPicked}
              onCheckedChange={() => pickAll(!allPicked)}
            />
            Select all
            <span className="text-2xs text-muted-foreground">except ones with uncommitted changes</span>
            <span className="ml-auto text-2xs text-muted-foreground tabular-nums">
              {picked.length} of {candidates.length} selected
            </span>
          </label>
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
            {candidates.map((candidate) => {
              const enabled = selectable(candidate.staleness)
              const id = `${branchesId}-${candidate.worktree.path}`
              return (
                <li key={candidate.worktree.path}>
                  <label
                    htmlFor={id}
                    className={cn(
                      "flex h-7 items-center gap-2 px-3",
                      enabled ? "hover:bg-muted/60" : "text-muted-foreground",
                    )}
                  >
                    <Checkbox
                      id={id}
                      disabled={!enabled}
                      checked={checked(candidate)}
                      onCheckedChange={(next: boolean) =>
                        setOverrides((current) => new Map(current).set(candidate.worktree.path, next))
                      }
                    />
                    <span className="min-w-0 truncate">{worktreeLabel(candidate.worktree)}</span>
                    <span className="min-w-0 shrink truncate text-2xs text-muted-foreground">
                      {candidate.worktree.head._tag === "Branch" ? basename(candidate.worktree.path) : "detached"}
                    </span>
                    <span
                      className={cn(
                        "ml-auto shrink-0 text-2xs",
                        candidate.staleness._tag === "Unmerged" || candidate.staleness._tag === "Dirty"
                          ? "text-change-modified"
                          : "text-muted-foreground",
                      )}
                    >
                      {reason(candidate.staleness)}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <label htmlFor={`${branchesId}-branches`} className="flex items-center gap-2">
        <Checkbox
          id={`${branchesId}-branches`}
          checked={deleteBranches}
          onCheckedChange={(next: boolean) => setDeleteBranches(next)}
        />
        Also delete their branches
      </label>
      {(lostCommits > 0 || discarded > 0) && (
        <div className="space-y-1 text-destructive">
          {discarded > 0 && (
            <p>
              Discards {plural(discarded, "uncommitted change")} in {plural(dirty.length, "worktree")}.
            </p>
          )}
          {lostCommits > 0 && (
            <p>
              Deletes {plural(lostCommits, "commit")} not on the base branch. Squash-merged branches usually show up
              this way.
            </p>
          )}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={picked.length === 0} onClick={() => void remove()}>
          Remove {plural(picked.length, "worktree")}
        </Button>
      </DialogFooter>
    </>
  )
}
