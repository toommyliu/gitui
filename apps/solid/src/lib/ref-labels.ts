import type { Head, Oid, Refs, RefVisibility } from "@gitui/contracts"
import { locationState } from "./visibility"

export type RefLabel =
  | { readonly kind: "branch"; readonly name: string; readonly current: boolean }
  | { readonly kind: "head" | "remote" | "tag"; readonly name: string }

const add = (labels: Map<Oid, Array<RefLabel>>, oid: Oid, label: RefLabel) => {
  const existing = labels.get(oid)
  if (existing === undefined) labels.set(oid, [label])
  else existing.push(label)
}

export const refLabels = (
  refs: Refs,
  head: Head,
  visibility: RefVisibility,
): ReadonlyMap<Oid, ReadonlyArray<RefLabel>> => {
  const labels = new Map<Oid, Array<RefLabel>>()
  if (head._tag === "Detached") add(labels, head.oid, { kind: "head", name: "HEAD" })
  const current = head._tag === "Branch" ? head.name : null
  const shown = (section: "branches" | "remotes", name: string) =>
    locationState(visibility, { section, name }) === "shown"
  const branches = refs.branches.filter((branch) => branch.name === current || shown("branches", branch.name))
  const ordered = branches.sort((a, b) => Number(b.name === current) - Number(a.name === current))
  for (const branch of ordered)
    add(labels, branch.oid, { kind: "branch", name: branch.name, current: branch.name === current })
  for (const remote of refs.remoteBranches) {
    if (!shown("remotes", remote.name)) continue
    const short = remote.name.slice(remote.remote.length + 1)
    const local = branches.some((branch) => branch.name === short && branch.oid === remote.oid)
    if (!local) add(labels, remote.oid, { kind: "remote", name: remote.name })
  }
  if (visibility.tags) for (const tag of refs.tags) add(labels, tag.oid, { kind: "tag", name: tag.name })
  return labels
}
