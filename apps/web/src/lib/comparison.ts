import { useAtomSet } from "@effect/atom-react"
import type { Comparison, ComparisonMode, RepoId } from "@gitui/contracts"
import * as Atom from "effect/reactivity/Atom"
import { shortOid } from "./format"
import { GitClient, keys } from "./git"

export const comparisonModes: Record<ComparisonMode, { value: ComparisonMode; label: string; description: string }> = {
  "merge-base": {
    value: "merge-base",
    label: "Since common ancestor",
    description: "Review changes on the compare side since the branches split.",
  },
  direct: {
    value: "direct",
    label: "Between endpoints",
    description: "Compare the exact contents of the base and compare commits.",
  },
  range: {
    value: "range",
    label: "Include base commit",
    description: "Compare from the base commit's first parent through the compare commit.",
  },
}

export type ComparisonDraft = { readonly head: string; readonly base?: string; readonly mode: ComparisonMode }

export const comparisonDialogAtom = Atom.family((_repo: RepoId) => Atom.make<ComparisonDraft | null>(null))

export const useCompare = (repo: RepoId) => useAtomSet(comparisonDialogAtom(repo))

export const comparisonKey = (repo: RepoId, comparison: Comparison) => JSON.stringify([repo, comparison])

export const comparisonAtom = Atom.family((key: string) => {
  const [repo, comparison] = JSON.parse(key) as [RepoId, Comparison]
  return GitClient.query("GetComparison", { repo, comparison }, { reactivityKeys: [keys.refs(repo)] })
})

export const comparisonLabel = (ref: string) =>
  /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref) ? shortOid(ref) : ref.replace(/^refs\/(heads|tags|remotes)\//, "")
