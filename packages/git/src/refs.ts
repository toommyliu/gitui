import type { Branch, Oid, Remote, RemoteBranch, Stash, Tag, Upstream, Worktree, WorktreeHead } from "@gitui/contracts"
import { groups, splitNul } from "./nul.ts"

const decoder = new TextDecoder()

export const forEachRefArgs = [
  "for-each-ref",
  "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(symref)",
  "refs/heads",
  "refs/remotes",
  "refs/tags",
]

const parseUpstream = (name: string, track: string): Upstream | null => {
  if (name === "") return null
  if (track === "gone") return { _tag: "Gone", name }
  const ahead = Number(track.match(/ahead (\d+)/)?.[1] ?? 0)
  const behind = Number(track.match(/behind (\d+)/)?.[1] ?? 0)
  return { _tag: "Tracking", name, ahead, behind }
}

export interface ParsedRefs {
  readonly branches: ReadonlyArray<Branch>
  readonly remoteBranches: ReadonlyArray<RemoteBranch>
  readonly tags: ReadonlyArray<Tag>
}

export const parseRefs = (bytes: Uint8Array, remotes: ReadonlyArray<Remote>): ParsedRefs => {
  const branches: Array<Branch> = []
  const remoteBranches: Array<RemoteBranch> = []
  const tags: Array<Tag> = []
  const remoteNames = remotes.map((r) => r.name).sort((a, b) => b.length - a.length)

  for (const line of decoder.decode(bytes).split("\n")) {
    if (line === "") continue
    const [ref = "", oid = "", peeled = "", upstream = "", track = "", symref = ""] = line.split("\0")
    if (symref !== "") continue
    if (ref.startsWith("refs/heads/")) {
      branches.push({ name: ref.slice(11), oid: oid as Oid, upstream: parseUpstream(upstream, track) })
    } else if (ref.startsWith("refs/remotes/")) {
      const name = ref.slice(13)
      const remote = remoteNames.find((r) => name.startsWith(`${r}/`)) ?? name.slice(0, name.indexOf("/"))
      remoteBranches.push({ remote, name, oid: oid as Oid })
    } else if (ref.startsWith("refs/tags/")) {
      tags.push({ name: ref.slice(10), oid: (peeled || oid) as Oid })
    }
  }
  return { branches, remoteBranches, tags }
}

export const remotesArgs = ["config", "-z", "--get-regexp", "^remote\\..*\\.url$"]

export const parseRemotes = (bytes: Uint8Array): Array<Remote> =>
  splitNul(bytes).flatMap((entry) => {
    const newline = entry.indexOf("\n")
    const key = entry.slice(0, newline)
    const name = key.slice("remote.".length, -".url".length)
    return newline === -1 || name === "" ? [] : [{ name, url: entry.slice(newline + 1) }]
  })

export const stashArgs = ["stash", "list", "-z", "--format=%H%x00%gs%x00%ct"]

export const parseStashes = (bytes: Uint8Array): Array<Stash> =>
  groups(splitNul(bytes), 3, ([oid = "", message = "", time = "0"]) => ({
    oid: oid as Oid,
    message,
    time: Number(time),
  }))

export const worktreeArgs = ["worktree", "list", "--porcelain", "-z"]

export const parseWorktrees = (bytes: Uint8Array): Array<Worktree> => {
  const worktrees: Array<Worktree> = []
  let attrs = new Map<string, string>()
  const finish = () => {
    const path = attrs.get("worktree")
    if (path === undefined) return
    const oid = (attrs.get("HEAD") ?? "") as Oid
    const branch = attrs.get("branch")
    const head: WorktreeHead = attrs.has("bare")
      ? { _tag: "Bare" }
      : branch !== undefined
        ? { _tag: "Branch", name: branch.replace(/^refs\/heads\//, ""), oid }
        : { _tag: "Detached", oid }
    worktrees.push({
      path,
      head,
      isMain: worktrees.length === 0,
      locked: attrs.get("locked") ?? null,
      prunable: attrs.get("prunable") ?? null,
    })
  }
  for (const token of splitNul(bytes)) {
    if (token === "") {
      finish()
      attrs = new Map()
      continue
    }
    const space = token.indexOf(" ")
    attrs.set(space === -1 ? token : token.slice(0, space), space === -1 ? "" : token.slice(space + 1))
  }
  finish()
  return worktrees
}
