import type { Change, CommitDetail, FileChange, Oid, RepoPath } from "@gitui/contracts"
import { splitNul } from "./nul.ts"

export const showArgs = (oid: Oid) => [
  "show",
  "-s",
  "-z",
  "--format=%H%x00%T%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%B",
  oid,
]

export const diffTreeArgs = (oid: Oid, parent: Oid | undefined) => [
  "diff-tree",
  "-r",
  "-z",
  "-M",
  "--raw",
  "--numstat",
  "--no-commit-id",
  ...(parent === undefined ? ["--root", oid] : [parent, oid]),
]

const changes: Record<string, Change> = {
  A: "added",
  D: "deleted",
  M: "modified",
  T: "typechange",
  R: "renamed",
  C: "copied",
}

export const parseFileChanges = (bytes: Uint8Array): Array<FileChange> => {
  const tokens = splitNul(bytes)
  const files: Array<FileChange> = []
  const byPath = new Map<string, number>()
  let i = 0
  while (i < tokens.length && tokens[i]!.startsWith(":")) {
    const letter = tokens[i]!.split(" ").at(-1)![0]!
    const twoPaths = letter === "R" || letter === "C"
    const from = twoPaths ? (tokens[i + 1] as RepoPath) : null
    const path = tokens[i + (twoPaths ? 2 : 1)] as RepoPath
    byPath.set(path, files.length)
    files.push({ path, from, change: changes[letter] ?? "modified", additions: null, deletions: null })
    i += twoPaths ? 3 : 2
  }
  while (i < tokens.length) {
    const [additions = "-", deletions = "-", inline = ""] = tokens[i]!.split("\t")
    const path = inline === "" ? tokens[i + 2] : inline
    i += inline === "" ? 3 : 1
    const index = path === undefined ? undefined : byPath.get(path)
    if (index === undefined) continue
    const binary = additions === "-"
    files[index] = {
      ...files[index]!,
      additions: binary ? null : Number(additions),
      deletions: binary ? null : Number(deletions),
    }
  }
  return files
}

export const parseCommit = (show: Uint8Array, files: Array<FileChange>): CommitDetail => {
  const [oid, tree, parents, an, ae, at, cn, ce, ct, message = ""] = splitNul(show)
  return {
    oid: oid as Oid,
    tree: tree as Oid,
    parents: parents ? (parents.split(" ") as Array<Oid>) : [],
    author: { name: an ?? "", email: ae ?? "", time: Number(at) },
    committer: { name: cn ?? "", email: ce ?? "", time: Number(ct) },
    message: message.trimEnd(),
    files,
  }
}
