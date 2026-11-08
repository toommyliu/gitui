import type { Branch, RepoId, Worktree, WorktreeSummary } from "@gitui/contracts"
import * as Atom from "effect/reactivity/Atom"

export type Staleness =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Landed" }
  | { readonly _tag: "Gone"; readonly commits: number }
  | { readonly _tag: "Unmerged"; readonly commits: number }
  | { readonly _tag: "Dirty"; readonly changes: number; readonly commits: number }
  | { readonly _tag: "Locked" }
  | { readonly _tag: "Checking" }

export type Candidate = { readonly worktree: Worktree; readonly staleness: Staleness }

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
  current: string,
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

export type CleanupRequest = { readonly preset: ReadonlySet<string> | null }

export const cleanupAtom = Atom.family((_repo: RepoId) => Atom.make<CleanupRequest | null>(null))

export type Picked = { readonly paths: ReadonlySet<string>; readonly anchor: string | null }

export const nothingPicked: Picked = { paths: new Set(), anchor: null }

export const pickWorktree = (
  picked: Picked,
  order: ReadonlyArray<string>,
  path: string,
  mode: "only" | "toggle" | "extend",
  open: string | null,
): Picked => {
  if (mode === "only") return { paths: new Set(), anchor: path }
  const start = picked.paths.size === 0 && open !== null ? new Set([open]) : new Set(picked.paths)
  if (mode === "toggle") {
    if (start.has(path)) start.delete(path)
    else start.add(path)
    return { paths: start, anchor: path }
  }
  const anchor = picked.anchor ?? open ?? path
  const from = order.indexOf(anchor)
  const to = order.indexOf(path)
  if (from === -1 || to === -1) return { paths: new Set([path]), anchor: path }
  return { paths: new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1)), anchor }
}
