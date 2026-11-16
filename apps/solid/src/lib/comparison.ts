import {
  type Comparison,
  type ComparisonMode,
  type CommitRow,
  type Oid,
  type Refs,
  type RepoId,
} from "@gitui/contracts"
import { createSignal } from "solid-js"
import { shortOid } from "./format"

export type CompareMode = Extract<ComparisonMode, "merge-base" | "direct">

export const compareModes: ReadonlyArray<{ value: CompareMode; label: string; description: string }> = [
  {
    value: "merge-base",
    label: "Since common ancestor",
    description: "Changes on the compare side since the two split.",
  },
  { value: "direct", label: "Between endpoints", description: "The exact difference between the two snapshots." },
]

const fullOid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i

export const refLabel = (ref: string) =>
  fullOid.test(ref) ? shortOid(ref) : ref.replace(/^refs\/(heads|tags|remotes)\//, "")

export type RefKind = "current" | "branch" | "remote" | "tag"

export interface RefOption {
  readonly ref: string
  readonly label: string
  readonly kind: RefKind
}

export const refOptions = (refs: Refs, current: string | null): ReadonlyArray<RefOption> => [
  { ref: "HEAD", label: "HEAD", kind: "current" },
  ...refs.branches
    .toSorted((a, b) => Number(b.name === current) - Number(a.name === current))
    .map((branch): RefOption => ({ ref: `refs/heads/${branch.name}`, label: branch.name, kind: "branch" })),
  ...refs.remoteBranches.map((branch): RefOption => ({
    ref: `refs/remotes/${branch.name}`,
    label: branch.name,
    kind: "remote",
  })),
  ...refs.tags.map((tag): RefOption => ({ ref: `refs/tags/${tag.name}`, label: tag.name, kind: "tag" })),
]

export const resolveRef = (text: string, options: ReadonlyArray<RefOption>) => {
  const trimmed = text.trim()
  return options.find((option) => option.label === trimmed)?.ref ?? trimmed
}

const [shown, setShown] = createSignal<ReadonlyMap<RepoId, Comparison>>(new Map())

export const shownComparison = (repo: RepoId) => shown().get(repo) ?? null

export const showComparison = (repo: RepoId, comparison: Comparison | null) =>
  setShown((current) => {
    const next = new Map(current)
    if (comparison === null) next.delete(repo)
    else next.set(repo, comparison)
    return next
  })

export interface CompareDraft {
  readonly repo: RepoId
  readonly base: string | null
  readonly head: string | null
  readonly mode: CompareMode
}

const [draft, setDraft] = createSignal<CompareDraft | null>(null)

export { draft as compareDraft }

export const openCompare = (next: CompareDraft) => setDraft(next)

export const closeCompare = () => setDraft(null)

export interface Range {
  readonly commits: ReadonlyArray<CommitRow>
  readonly truncated: boolean
}

const PAGE = 1000

export const walkRange = async (
  read: (start: number, count: number) => Promise<ReadonlyArray<CommitRow>>,
  head: Oid,
  base: Oid,
  limits: { readonly commits: number; readonly rows: number } = { commits: 500, rows: 100_000 },
): Promise<Range> => {
  if (head === base) return { commits: [], truncated: false }
  const wanted = new Set<string>([head])
  const excluded = new Set<string>([base])
  const pending = new Set<string>([head])
  const commits: Array<CommitRow> = []
  for (let start = 0; start < limits.rows; start += PAGE) {
    const rows = await read(start, PAGE)
    for (const row of rows) {
      pending.delete(row.oid)
      if (excluded.has(row.oid)) {
        for (const parent of row.parents) {
          excluded.add(parent)
          pending.delete(parent)
        }
      } else if (wanted.has(row.oid)) {
        commits.push(row)
        if (commits.length >= limits.commits) return { commits, truncated: true }
        for (const parent of row.parents) {
          if (excluded.has(parent)) continue
          wanted.add(parent)
          pending.add(parent)
        }
      }
      if (pending.size === 0) return { commits, truncated: false }
    }
    if (rows.length < PAGE) return { commits, truncated: false }
  }
  return { commits, truncated: true }
}
