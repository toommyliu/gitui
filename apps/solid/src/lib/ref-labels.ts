import type { Head, Oid, Refs } from "@gitui/contracts"

export type RefLabel =
  | { readonly kind: "branch"; readonly name: string; readonly current: boolean }
  | { readonly kind: "head" | "remote" | "tag"; readonly name: string }

const add = (labels: Map<Oid, Array<RefLabel>>, oid: Oid, label: RefLabel) => {
  const existing = labels.get(oid)
  if (existing === undefined) labels.set(oid, [label])
  else existing.push(label)
}

export const refLabels = (refs: Refs, head: Head): ReadonlyMap<Oid, ReadonlyArray<RefLabel>> => {
  const labels = new Map<Oid, Array<RefLabel>>()
  if (head._tag === "Detached") add(labels, head.oid, { kind: "head", name: "HEAD" })
  const current = head._tag === "Branch" ? head.name : null
  const ordered = [...refs.branches].sort((a, b) => Number(b.name === current) - Number(a.name === current))
  for (const branch of ordered)
    add(labels, branch.oid, { kind: "branch", name: branch.name, current: branch.name === current })
  for (const remote of refs.remoteBranches) {
    const short = remote.name.slice(remote.remote.length + 1)
    const local = refs.branches.some((branch) => branch.name === short && branch.oid === remote.oid)
    if (!local) add(labels, remote.oid, { kind: "remote", name: remote.name })
  }
  for (const tag of refs.tags) add(labels, tag.oid, { kind: "tag", name: tag.name })
  return labels
}
