import type { RepoPath, Status } from "@gitui/contracts"

export const stashBlocked = (status: Status) =>
  status.operation !== null || status.entries.some((entry) => entry._tag === "Conflicted")

export const hasStaged = (status: Status) =>
  status.entries.some((entry) => entry._tag === "Tracked" && entry.staged !== null)

export interface StashFiles {
  readonly files: ReadonlyArray<RepoPath>
  readonly paths: ReadonlyArray<RepoPath>
  readonly untracked: number
  readonly staged: boolean
}

export const stashFiles = (status: Status, selected: ReadonlySet<RepoPath>): StashFiles => {
  const entries = status.entries.filter((entry) => entry._tag !== "Conflicted" && selected.has(entry.path))
  return {
    files: entries.map((entry) => entry.path),
    paths: entries.flatMap((entry) =>
      entry._tag === "Tracked" && entry.from !== null ? [entry.from, entry.path] : [entry.path],
    ),
    untracked: entries.filter((entry) => entry._tag === "Untracked").length,
    staged: entries.some((entry) => entry._tag === "Tracked" && entry.staged !== null),
  }
}
