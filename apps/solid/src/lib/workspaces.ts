import type { Oid, RepoInfo } from "@gitui/contracts"
import * as Schema from "effect/Schema"
import { type Accessor, createContext, createMemo, createRoot, createSignal, runWithOwner } from "solid-js"
import { forget, remember } from "./places"
import { createRepo, type Repo } from "./repo"
import { call } from "./rpc"
import { load, save } from "./storage"

export const views = ["changes", "history", "branches", "stashes"] as const
export type View = (typeof views)[number]

export interface Workspace {
  readonly path: string
  readonly info: Accessor<RepoInfo>
  readonly repo: Accessor<Repo>
  readonly view: Accessor<View>
  readonly setView: (view: View) => void
  readonly focused: Accessor<boolean>
  readonly setFocused: (focused: boolean) => void
  readonly revealed: Accessor<{ readonly oid: Oid } | null>
  readonly reveal: (oid: Oid) => void
  readonly retry: () => void
  readonly dispose: () => void
}

export const WorkspaceContext = createContext<Workspace | null>(null)

const PATHS = "gitui.solid.repos"
const ACTIVE = "gitui.solid.active"

const [paths, setPaths] = createSignal<ReadonlyArray<string>>(
  load(PATHS, Schema.decodeUnknownSync(Schema.Array(Schema.String)), []),
)
const [active, setActiveSignal] = createSignal<string | null>(
  load(ACTIVE, Schema.decodeUnknownSync(Schema.NullOr(Schema.String)), null),
)

export { active, paths }

const entries = new Map<string, Workspace>()
const closed: Array<string> = []

type Failed = { readonly ok: false; readonly error: unknown }
type Found = { readonly ok: true; readonly info: RepoInfo } | Failed
type Opened = { readonly ok: true; readonly info: RepoInfo; readonly repo: Repo } | Failed

export class OpenRepoFailed extends Error {
  readonly reason: unknown
  constructor(reason: unknown) {
    super("Couldn't open the repository")
    this.reason = reason
  }
}

const createWorkspace = (path: string): Workspace =>
  runWithOwner(null, () =>
    createRoot((dispose) => {
      const [attempt, setAttempt] = createSignal(0)
      const result = createMemo(() => {
        attempt()
        return call((git) => git.OpenRepo({ path })).then(
          (info): Found => ({ ok: true, info }),
          (error: unknown): Found => ({ ok: false, error }),
        )
      })
      const opened = createMemo((): Opened => {
        const current = result()
        return current.ok ? { ...current, repo: createRepo(current.info.id) } : current
      })
      const settled = () => {
        const current = opened()
        if (!current.ok) throw new OpenRepoFailed(current.error)
        return current
      }
      const info = () => settled().info
      const repo = () => settled().repo
      const [view, setView] = createSignal<View>("changes")
      const [focused, setFocused] = createSignal(false)
      const [revealed, setRevealed] = createSignal<{ readonly oid: Oid } | null>(null)
      const reveal = (oid: Oid) => {
        setView("history")
        setRevealed({ oid })
      }
      const retry = () => setAttempt((count) => count + 1)
      return { path, info, repo, view, setView, focused, setFocused, revealed, reveal, retry, dispose }
    }),
  )

export const workspaceFor = (path: string) => {
  const existing = entries.get(path)
  if (existing !== undefined) return existing
  const created = createWorkspace(path)
  entries.set(path, created)
  return created
}

export const setActive = (path: string | null) => {
  setActiveSignal(path)
  save(ACTIVE, path)
}

const setOpen = (next: ReadonlyArray<string>) => {
  setPaths(next)
  save(PATHS, next)
}

export const openRepo = (path: string, after?: string) => {
  remember(path)
  const current = paths()
  if (!current.includes(path)) {
    const index = after === undefined ? -1 : current.indexOf(after)
    setOpen(index === -1 ? [...current, path] : [...current.slice(0, index + 1), path, ...current.slice(index + 1)])
  }
  setActive(path)
}

export const closeRepo = (path: string) => {
  const current = paths()
  const index = current.indexOf(path)
  if (index === -1) return
  remember(path)
  closed.push(path)
  const next = current.filter((other) => other !== path)
  setOpen(next)
  entries.get(path)?.dispose()
  entries.delete(path)
  if (active() === path) setActive(next[Math.min(index, next.length - 1)] ?? null)
}

export const forgetRepo = (path: string) => {
  closeRepo(path)
  forget(path)
  closed.splice(0, closed.length, ...closed.filter((other) => other !== path))
}

export const cycleRepo = (step: 1 | -1) => {
  const current = paths()
  if (current.length === 0) return
  const index = current.indexOf(active() ?? "")
  setActive(current[(index + step + current.length) % current.length] ?? null)
}

export const reopenRepo = () => {
  const path = closed.pop()
  if (path !== undefined) openRepo(path)
}
