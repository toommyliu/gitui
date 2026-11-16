import type { Branch, Refs, RemoteBranch, Tag, Worktree } from "@gitui/contracts"
import type { TreeItemData } from "@ui-sdk/solid/tree"
import { basename } from "@/lib/format"

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
