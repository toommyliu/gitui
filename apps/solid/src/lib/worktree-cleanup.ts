import type { Branch, Worktree, WorktreeSummary } from "@gitui/contracts"

export type Staleness =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Landed" }
  | { readonly _tag: "Gone"; readonly commits: number }
  | { readonly _tag: "Unmerged"; readonly commits: number }
  | { readonly _tag: "Dirty"; readonly changes: number; readonly commits: number }
  | { readonly _tag: "Locked" }
  | { readonly _tag: "Checking" }

export interface Candidate {
  readonly worktree: Worktree
  readonly staleness: Staleness
}

export const classify = (
  worktree: Worktree,
  summary: WorktreeSummary | undefined,
  branch: Branch | undefined,
): Staleness => {
  if (worktree.prunable !== null) return { _tag: "Missing" }
  if (worktree.locked !== null) return { _tag: "Locked" }
  if (summary === undefined) return { _tag: "Checking" }
  const commits = summary.commits ?? 0
  if (summary.changes > 0) return { _tag: "Dirty", changes: summary.changes, commits }
  if (summary.commits === 0) return { _tag: "Landed" }
  return branch?.upstream?._tag === "Gone" ? { _tag: "Gone", commits } : { _tag: "Unmerged", commits }
}

export const cleanupCandidates = (
  worktrees: ReadonlyArray<Worktree>,
  summaries: ReadonlyArray<WorktreeSummary> | undefined,
  branches: ReadonlyArray<Branch>,
  current: string | null,
): ReadonlyArray<Candidate> =>
  worktrees
    .filter((worktree) => !worktree.isMain && worktree.path !== current)
    .map((worktree) => {
      const name = worktree.head._tag === "Branch" ? worktree.head.name : null
      return {
        worktree,
        staleness: classify(
          worktree,
          summaries?.find((summary) => summary.path === worktree.path),
          name === null ? undefined : branches.find((branch) => branch.name === name),
        ),
      }
    })

export const suggested = (staleness: Staleness) =>
  staleness._tag === "Missing" || staleness._tag === "Landed" || staleness._tag === "Gone"

export const selectable = (staleness: Staleness) => staleness._tag !== "Locked" && staleness._tag !== "Checking"

export const bulkSelectable = (staleness: Staleness) => selectable(staleness) && staleness._tag !== "Dirty"

export const unmergedCommits = (staleness: Staleness) =>
  staleness._tag === "Gone" || staleness._tag === "Unmerged" || staleness._tag === "Dirty" ? staleness.commits : 0

export const uncommittedChanges = (staleness: Staleness) => (staleness._tag === "Dirty" ? staleness.changes : 0)
