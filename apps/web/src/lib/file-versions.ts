import type { FileHistory, FileHistoryEntry, FileIdentity } from "@gitui/contracts"

export type FileVersion =
  | { readonly _tag: "Head"; readonly key: string; readonly source: FileIdentity }
  | { readonly _tag: "Requested"; readonly key: string; readonly source: FileIdentity }
  | { readonly _tag: "Commit"; readonly key: string; readonly source: FileIdentity; readonly entry: FileHistoryEntry }
  | {
      readonly _tag: "BeforeDeletion"
      readonly key: string
      readonly source: FileIdentity
      readonly entry: FileHistoryEntry
    }

const entryVersion = (entry: FileHistoryEntry): FileVersion => {
  const key = `${entry.oid}\n${entry.path}`
  if (entry.change === "deleted" && entry.parent !== null)
    return { _tag: "BeforeDeletion", key, source: { revision: entry.parent, path: entry.path }, entry }
  return { _tag: "Commit", key, source: { revision: entry.oid, path: entry.path }, entry }
}

const anchor = (history: FileHistory, atHead: boolean): ReadonlyArray<FileVersion> => {
  const source = { revision: history.revision, path: history.path }
  if (atHead) return [{ _tag: "Head", key: "HEAD", source }]
  if (history.entries.some((entry) => entry.oid === history.revision)) return []
  return [{ _tag: "Requested", key: "requested", source }]
}

export const fileVersions = (history: FileHistory, atHead: boolean): ReadonlyArray<FileVersion> => [
  ...anchor(history, atHead),
  ...history.entries.map(entryVersion),
]
