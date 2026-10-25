import { useAtom } from "@effect/atom-react"
import type { RepoId, RepoPath } from "@gitui/contracts"
import * as Atom from "effect/reactivity/Atom"
import { joinSegments, type Segment } from "./conflict-blocks"

export interface Draft {
  readonly version: string
  readonly baseline: string
  readonly segments: ReadonlyArray<Segment>
}

export type ResolvedHow = "edited" | "ours" | "theirs" | "deleted" | "as-is"

export interface Resolved {
  readonly how: ResolvedHow
  readonly content: string | null
}

export interface ConflictSession {
  readonly open: boolean
  readonly path: RepoPath | null
  readonly files: ReadonlyArray<RepoPath>
  readonly resolved: ReadonlyMap<RepoPath, Resolved>
  readonly saved: ReadonlySet<RepoPath>
  readonly drafts: ReadonlyMap<RepoPath, Draft>
}

export const emptySession: ConflictSession = {
  open: false,
  path: null,
  files: [],
  resolved: new Map(),
  saved: new Set(),
  drafts: new Map(),
}

export const isDirty = (draft: Draft) => joinSegments(draft.segments) !== draft.baseline

export const dirtyPaths = (session: ConflictSession) =>
  [...session.drafts].flatMap(([path, draft]) => (isDirty(draft) ? [path] : []))

export const withFiles = (files: ReadonlyArray<RepoPath>, conflicted: ReadonlyArray<RepoPath>) => {
  const added = [...new Set(conflicted)].filter((path) => !files.includes(path))
  return added.length === 0 ? files : [...files, ...added]
}

export const nextUnresolved = (
  files: ReadonlyArray<RepoPath>,
  unresolved: (path: RepoPath) => boolean,
  after: RepoPath | null,
): RepoPath | null => {
  const start = after === null ? -1 : files.indexOf(after)
  const ordered = [...files.slice(start + 1), ...files.slice(0, start + 1)]
  return ordered.find((path) => path !== after && unresolved(path)) ?? null
}

export const afterOperationStep = (session: ConflictSession): ConflictSession => ({
  ...session,
  path: null,
  files: [],
  resolved: new Map(),
  saved: new Set(),
})

export const sessionsAtom = Atom.make<ReadonlyMap<RepoId, ConflictSession>>(new Map()).pipe(Atom.keepAlive)

export const railOpenAtom = Atom.make(true).pipe(Atom.keepAlive)

export type SessionUpdate = (update: (session: ConflictSession) => ConflictSession) => void

export const useConflictSession = (repo: RepoId): readonly [ConflictSession, SessionUpdate] => {
  const [sessions, setSessions] = useAtom(sessionsAtom)
  const update: SessionUpdate = (change) =>
    setSessions((current) => new Map(current).set(repo, change(current.get(repo) ?? emptySession)))
  return [sessions.get(repo) ?? emptySession, update]
}
