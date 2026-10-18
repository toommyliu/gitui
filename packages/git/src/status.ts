import type { Change, ConflictCode, Head, Oid, RepoPath, StatusEntry, Tracking } from "@gitui/contracts"
import { splitNul } from "./nul.ts"

export const statusArgs = [
  "status",
  "--porcelain=v2",
  "-z",
  "--branch",
  "--untracked-files=all",
  "--ignore-submodules=dirty",
]

const changes: Record<string, Change | null> = {
  ".": null,
  M: "modified",
  T: "typechange",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
}

const change = (code: string): Change | null => changes[code] ?? null

const afterFields = (record: string, fieldCount: number) => {
  let index = 0
  for (let i = 0; i < fieldCount; i++) index = record.indexOf(" ", index) + 1
  return record.slice(index)
}

export interface ParsedStatus {
  readonly head: Head
  readonly upstream: Tracking | null
  readonly entries: ReadonlyArray<StatusEntry>
}

export const parseStatus = (bytes: Uint8Array): ParsedStatus => {
  const tokens = splitNul(bytes)
  const entries: Array<StatusEntry> = []
  let oid = ""
  let branch = ""
  let upstreamName: string | null = null
  let ab: { ahead: number; behind: number } | null = null

  for (let i = 0; i < tokens.length; i++) {
    const record = tokens[i]!
    switch (record[0]) {
      case "#": {
        const [, key, value = ""] = record.match(/^# (\S+) (.*)$/) ?? []
        if (key === "branch.oid") oid = value
        else if (key === "branch.head") branch = value
        else if (key === "branch.upstream") upstreamName = value
        else if (key === "branch.ab") {
          const [, ahead = "0", behind = "0"] = value.match(/^\+(\d+) -(\d+)$/) ?? []
          ab = { ahead: Number(ahead), behind: Number(behind) }
        }
        break
      }
      case "1":
      case "2": {
        const xy = record.slice(2, 4)
        const submodule = record.slice(5, 9).startsWith("S")
        const isRename = record[0] === "2"
        const path = afterFields(record, isRename ? 9 : 8) as RepoPath
        const from = isRename ? (tokens[++i] as RepoPath) : null
        entries.push({
          _tag: "Tracked",
          path,
          from,
          staged: change(xy[0]!),
          unstaged: change(xy[1]!),
          submodule,
        })
        break
      }
      case "u":
        entries.push({
          _tag: "Conflicted",
          path: afterFields(record, 10) as RepoPath,
          code: record.slice(2, 4) as ConflictCode,
        })
        break
      case "?":
        entries.push({ _tag: "Untracked", path: record.slice(2) as RepoPath })
        break
    }
  }

  const head: Head =
    oid === "(initial)"
      ? { _tag: "Unborn", name: branch }
      : branch === "(detached)"
        ? { _tag: "Detached", oid: oid as Oid }
        : { _tag: "Branch", name: branch, oid: oid as Oid }
  const upstream = upstreamName !== null && ab !== null ? { name: upstreamName, ...ab } : null
  return { head, upstream, entries }
}
