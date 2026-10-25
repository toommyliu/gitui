import type { Branch, Oid, Remote, RemoteBranch, Stash, Tag, Upstream, Worktree, WorktreeHead } from "@gitui/contracts"
import { groups, splitNul } from "./nul.ts"

const decoder = new TextDecoder()

export const forEachRefArgs = [
  "for-each-ref",
  "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream)%00%(upstream:short)%00%(symref)",
  "refs/heads",
  "refs/remotes",
  "refs/tags",
]

const rows = (bytes: Uint8Array) =>
  decoder
    .decode(bytes)
    .split("\n")
    .flatMap((line) => (line === "" ? [] : [line.split("\0")]))

export interface RefRow {
  readonly ref: string
  readonly oid: string
  readonly peeled: string
  readonly upstream: string
  readonly upstreamName: string
  readonly symref: string
}

export const parseRefRows = (bytes: Uint8Array): Array<RefRow> =>
  rows(bytes).map(([ref = "", oid = "", peeled = "", upstream = "", upstreamName = "", symref = ""]) => ({
    ref,
    oid,
    peeled,
    upstream,
    upstreamName,
    symref,
  }))

const pairKey = (oid: string, upstreamOid: string) => `${oid} ${upstreamOid}`

export const trackingPairs = (refs: ReadonlyArray<RefRow>) => {
  const oids = new Map(refs.map((row) => [row.ref, row.oid]))
  const pairs = new Map<string, readonly [branch: string, upstream: string]>()
  for (const row of refs) {
    const upstreamOid = oids.get(row.upstream)
    if (row.ref.startsWith("refs/heads/") && upstreamOid !== undefined) {
      pairs.set(pairKey(row.oid, upstreamOid), [row.ref, row.upstream])
    }
  }
  return pairs
}

export const trackArgs = (refs: Iterable<string>) => [
  "for-each-ref",
  "--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track,nobracket)",
  ...refs,
]

export const parseTracks = (bytes: Uint8Array): Map<string, string> => {
  const parsed = rows(bytes)
  const oids = new Map(parsed.map(([ref = "", oid = ""]) => [ref, oid]))
  const tracks = new Map<string, string>()
  for (const [, oid = "", upstream = "", track = ""] of parsed) {
    const upstreamOid = oids.get(upstream)
    if (upstreamOid !== undefined) tracks.set(pairKey(oid, upstreamOid), track)
  }
  return tracks
}

const parseUpstream = (ref: string, name: string, track: string): Upstream | null => {
  if (ref === "") return null
  if (track === "gone") return { _tag: "Gone", ref, name }
  const ahead = Number(track.match(/ahead (\d+)/)?.[1] ?? 0)
  const behind = Number(track.match(/behind (\d+)/)?.[1] ?? 0)
  return { _tag: "Tracking", ref, name, ahead, behind }
}

export interface ParsedRefs {
  readonly branches: ReadonlyArray<Branch>
  readonly remoteBranches: ReadonlyArray<RemoteBranch>
  readonly tags: ReadonlyArray<Tag>
}

export const parseRefs = (
  refs: ReadonlyArray<RefRow>,
  remotes: ReadonlyArray<Remote>,
  tracks: ReadonlyMap<string, string>,
): ParsedRefs => {
  const branches: Array<Branch> = []
  const remoteBranches: Array<RemoteBranch> = []
  const tags: Array<Tag> = []
  const remoteNames = remotes.map((r) => r.name).sort((a, b) => b.length - a.length)
  const oids = new Map(refs.map((row) => [row.ref, row.oid]))

  for (const { ref, oid, peeled, upstream, upstreamName, symref } of refs) {
    if (symref !== "") continue
    if (ref.startsWith("refs/heads/")) {
      const upstreamOid = oids.get(upstream)
      const track = upstreamOid === undefined ? "gone" : (tracks.get(pairKey(oid, upstreamOid)) ?? "")
      branches.push({ name: ref.slice(11), oid: oid as Oid, upstream: parseUpstream(upstream, upstreamName, track) })
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

export const remotesArgs = ["config", "-z", "--get-regexp", "^remote\\..*\\.(url|pushurl)$"]

export const parseRemotes = (bytes: Uint8Array): Array<Remote> => {
  const remotes = new Map<string, { name: string; urls: string[]; pushUrls: string[] }>()
  for (const entry of splitNul(bytes)) {
    const newline = entry.indexOf("\n")
    const key = entry.slice(0, newline)
    const push = key.endsWith(".pushurl")
    const name = key.slice("remote.".length, push ? -".pushurl".length : -".url".length)
    if (newline === -1 || name === "") continue
    const remote = remotes.get(name) ?? { name, urls: [], pushUrls: [] }
    const urls = remote[push ? "pushUrls" : "urls"]
    const url = entry.slice(newline + 1)
    if (url === "") urls.length = 0
    else urls.push(url)
    remotes.set(name, remote)
  }
  return [...remotes.values()]
}

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
