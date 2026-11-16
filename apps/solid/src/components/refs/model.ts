import type { Branch, Refs, RefVisibility, RemoteBranch, Tag, Worktree } from "@gitui/contracts"
import type { TreeItemData } from "@ui-sdk/solid/tree"
import { basename } from "@/lib/format"
import { type Location, locationState } from "@/lib/visibility"

export type RefNode =
  | { readonly kind: "local"; readonly key: string; readonly name: string; readonly branch: Branch }
  | { readonly kind: "remote"; readonly key: string; readonly name: string; readonly branch: RemoteBranch }
  | { readonly kind: "tag"; readonly key: string; readonly name: string; readonly tag: Tag }
  | { readonly kind: "worktree"; readonly key: string; readonly name: string; readonly worktree: Worktree }

export const worktreeHead = (worktree: Worktree) => {
  switch (worktree.head._tag) {
    case "Branch":
      return worktree.head.name
    case "Detached":
      return worktree.head.oid.slice(0, 7)
    case "Bare":
      return "bare"
  }
}

export const nodesOf = (refs: Refs): Array<RefNode> => [
  ...refs.branches.map((branch): RefNode => ({
    kind: "local",
    key: `local:${branch.name}`,
    name: branch.name,
    branch,
  })),
  ...refs.remoteBranches.map((branch): RefNode => ({
    kind: "remote",
    key: `remote:${branch.name}`,
    name: branch.name,
    branch,
  })),
  ...refs.tags.map((tag): RefNode => ({ kind: "tag", key: `tag:${tag.name}`, name: tag.name, tag })),
  ...refs.worktrees.map((worktree): RefNode => ({
    kind: "worktree",
    key: `worktree:${worktree.path}`,
    name: basename(worktree.path),
    worktree,
  })),
]

export const matches = (node: RefNode, query: string) => {
  const needle = query.trim().toLowerCase()
  if (needle === "") return true
  const haystack = node.kind === "worktree" ? `${node.worktree.path} ${worktreeHead(node.worktree)}` : node.name
  return haystack.toLowerCase().includes(needle)
}

const section = (value: string, label: string, children: Array<TreeItemData>): Array<TreeItemData> =>
  children.length === 0 ? [] : [{ value, label, children }]

export const treeOf = (nodes: ReadonlyArray<RefNode>): Array<TreeItemData> => {
  const locals: Array<TreeItemData> = []
  const remotes = new Map<string, Array<TreeItemData>>()
  const tags: Array<TreeItemData> = []
  const worktrees: Array<TreeItemData> = []
  for (const node of nodes) {
    switch (node.kind) {
      case "local":
        locals.push({ value: node.key, label: node.name })
        break
      case "remote": {
        const group = remotes.get(node.branch.remote) ?? []
        group.push({ value: node.key, label: node.name.slice(node.branch.remote.length + 1) })
        remotes.set(node.branch.remote, group)
        break
      }
      case "tag":
        tags.push({ value: node.key, label: node.name })
        break
      case "worktree":
        worktrees.push({ value: node.key, label: node.name })
        break
    }
  }
  return [
    ...section("section:local", "Local", locals),
    ...section(
      "section:remotes",
      "Remotes",
      [...remotes].map(([remote, children]) => ({ value: `remote-group:${remote}`, label: remote, children })),
    ),
    ...section("section:tags", "Tags", tags),
    ...section("section:worktrees", "Worktrees", worktrees),
  ]
}

export const groupsOf = (items: ReadonlyArray<TreeItemData>): Array<string> =>
  items.flatMap((item) => (item.children === undefined ? [] : [item.value, ...groupsOf(item.children)]))

export const compareTarget = (node: RefNode, head: string | null, openPath: string | null): string | null => {
  switch (node.kind) {
    case "local":
      return node.name === head ? null : `refs/heads/${node.name}`
    case "remote":
      return `refs/remotes/${node.name}`
    case "tag":
      return `refs/tags/${node.name}`
    case "worktree": {
      const worktreeHead = node.worktree.head
      if (node.worktree.path === openPath || worktreeHead._tag === "Bare") return null
      if (worktreeHead._tag === "Detached") return worktreeHead.oid
      return worktreeHead.name === head ? null : `refs/heads/${worktreeHead.name}`
    }
  }
}

export type Bulk =
  | { readonly kind: "local"; readonly branches: ReadonlyArray<Branch> }
  | { readonly kind: "remote"; readonly branches: ReadonlyArray<RemoteBranch> }
  | { readonly kind: "tag"; readonly tags: ReadonlyArray<Tag> }
  | { readonly kind: "worktree"; readonly worktrees: ReadonlyArray<Worktree> }

export const bulkOf = (nodes: ReadonlyArray<RefNode>): Bulk | null => {
  const [first] = nodes
  if (first === undefined || nodes.length < 2) return null
  switch (first.kind) {
    case "local":
      return { kind: "local", branches: nodes.flatMap((node) => (node.kind === "local" ? [node.branch] : [])) }
    case "remote":
      return { kind: "remote", branches: nodes.flatMap((node) => (node.kind === "remote" ? [node.branch] : [])) }
    case "tag":
      return { kind: "tag", tags: nodes.flatMap((node) => (node.kind === "tag" ? [node.tag] : [])) }
    case "worktree":
      return { kind: "worktree", worktrees: nodes.flatMap((node) => (node.kind === "worktree" ? [node.worktree] : [])) }
  }
}

export interface RowVisibility {
  readonly dimmed: boolean
  readonly toggle: { readonly hidden: boolean; readonly location: Location } | null
}

export const rowVisibility = (key: string, visibility: RefVisibility, head: string | null): RowVisibility => {
  const at = (location: Location): RowVisibility => {
    const state = locationState(visibility, location)
    return {
      dimmed: state !== "shown",
      toggle: state === "inherited" ? null : { hidden: state === "hidden", location },
    }
  }
  const fixed = (shown: boolean): RowVisibility => ({ dimmed: !shown, toggle: null })
  const split = key.indexOf(":")
  const name = key.slice(split + 1)
  switch (key.slice(0, split)) {
    case "section":
      if (name === "local") return at({ section: "branches" })
      if (name === "remotes" || name === "tags") return at({ section: name })
      return fixed(true)
    case "local":
      return name === head ? fixed(true) : at({ section: "branches", name })
    case "remote-group":
    case "remote":
      return at({ section: "remotes", name })
    case "tag":
      return fixed(visibility.tags)
    default:
      return fixed(true)
  }
}
