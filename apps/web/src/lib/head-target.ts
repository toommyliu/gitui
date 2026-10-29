import type { RepoPath, StatusEntry } from "@gitui/contracts"
import type { FileTarget } from "./file-investigation"

export const headTarget = (entries: ReadonlyArray<StatusEntry>, path: RepoPath): FileTarget => {
  for (const entry of entries) {
    if (entry._tag === "Tracked" && entry.path === path && entry.from !== null)
      return { revision: "HEAD", path: entry.from, destination: path }
  }
  return { revision: "HEAD", path }
}
