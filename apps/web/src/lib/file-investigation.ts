import type { FileIdentity, RepoId, RepoPath } from "@gitui/contracts"
import * as Atom from "effect/reactivity/Atom"
import { GitClient, keys } from "./git"

export type FileTarget = { readonly revision: string; readonly path: RepoPath; readonly destination?: RepoPath }

export type Investigation = { readonly _tag: "Pick" } | ({ readonly _tag: "File" } & FileTarget)

export const investigationAtom = Atom.family((_repo: RepoId) => Atom.make<Investigation | null>(null))

export const trackedFilesAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetTrackedFiles", { repo }, { reactivityKeys: [keys.status(repo)] }),
)

export const fileKey = (repo: RepoId, revision: string, path: RepoPath) => JSON.stringify([repo, revision, path])

const parseFileKey = (key: string) => JSON.parse(key) as [RepoId, string, RepoPath]

export const fileHistoryAtom = Atom.family((key: string) => {
  const [repo, revision, path] = parseFileKey(key)
  return GitClient.query(
    "GetFileHistory",
    { repo, revision, path },
    revision === "HEAD" ? { reactivityKeys: [keys.refs(repo)] } : {},
  )
})

export const fileRevisionAtom = Atom.family((key: string) => {
  const [repo, revision, path] = parseFileKey(key)
  return GitClient.query("GetFileRevision", { repo, revision, path }, { timeToLive: "2 minutes" })
})

export const fileBlameAtom = Atom.family((key: string) => {
  const [repo, revision, path] = parseFileKey(key)
  return GitClient.query("GetFileBlame", { repo, revision, path }, { timeToLive: "2 minutes" })
})

export const restorePreviewKey = (repo: RepoId, source: FileIdentity, destination: RepoPath) =>
  JSON.stringify([repo, source, destination])

export const restorePreviewAtom = Atom.family((key: string) => {
  const [repo, source, destination] = JSON.parse(key) as [RepoId, FileIdentity, RepoPath]
  return GitClient.query("PreviewFileRestore", { repo, source, destination }, { reactivityKeys: [keys.worktree(repo)] })
})
