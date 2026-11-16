import type { BaseRef, Branch, Worktree } from "@gitui/contracts"

export type BranchStaleness = { readonly _tag: "Merged" } | { readonly _tag: "Gone" }

export type Held = { readonly _tag: "Current" } | { readonly _tag: "Worktree"; readonly path: string }

export interface BranchCandidate {
  readonly branch: Branch
  readonly staleness: BranchStaleness
}

export interface HeldCandidate extends BranchCandidate {
  readonly held: Held
}

const isBase = (branch: Branch, base: BaseRef) => branch.name === base.name || `origin/${branch.name}` === base.name

export const staleness = (branch: Branch, merged: ReadonlySet<string>): BranchStaleness | null => {
  if (merged.has(branch.name)) return { _tag: "Merged" }
  if (branch.upstream?._tag === "Gone") return { _tag: "Gone" }
  return null
}

export const heldBy = (branch: Branch, head: string | null, worktrees: ReadonlyArray<Worktree>): Held | null => {
  if (branch.name === head) return { _tag: "Current" }
  const worktree = worktrees.find((tree) => tree.head._tag === "Branch" && tree.head.name === branch.name)
  return worktree === undefined ? null : { _tag: "Worktree", path: worktree.path }
}

export const branchCleanup = (options: {
  readonly branches: ReadonlyArray<Branch>
  readonly merged: ReadonlySet<string>
  readonly base: BaseRef | null
  readonly head: string | null
  readonly worktrees: ReadonlyArray<Worktree>
}): { readonly candidates: ReadonlyArray<BranchCandidate>; readonly held: ReadonlyArray<HeldCandidate> } => {
  const candidates: Array<BranchCandidate> = []
  const held: Array<HeldCandidate> = []
  for (const branch of options.branches) {
    if (options.base !== null && isBase(branch, options.base)) continue
    const stale = staleness(branch, options.merged)
    if (stale === null) continue
    const holder = heldBy(branch, options.head, options.worktrees)
    if (holder === null) candidates.push({ branch, staleness: stale })
    else held.push({ branch, staleness: stale, held: holder })
  }
  return { candidates, held }
}

export const suggestedBranch = (staleness: BranchStaleness) => staleness._tag === "Merged"
