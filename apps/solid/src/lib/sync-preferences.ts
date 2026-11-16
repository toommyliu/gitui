import { PullStrategy, PushDestination, type PushContext, type RepoId } from "@gitui/contracts"
import * as Schema from "effect/Schema"
import { createSignal } from "solid-js"
import { load, save } from "./storage"

const SyncPreferences = Schema.Struct({
  pullStrategy: PullStrategy,
  pushes: Schema.Record(Schema.String, Schema.Struct({ destination: PushDestination, fingerprint: Schema.String })),
})
export type SyncPreferences = typeof SyncPreferences.Type

export const defaultSyncPreferences = (): SyncPreferences => ({ pullStrategy: "ff-only", pushes: {} })

const decode = Schema.decodeUnknownSync(SyncPreferences)

const storageKey = (repo: RepoId) => `gitui.solid.sync:${repo}`

const cache = new Map<RepoId, SyncPreferences>()
const [version, setVersion] = createSignal(0)

const read = (repo: RepoId) => {
  const cached = cache.get(repo)
  if (cached !== undefined) return cached
  const stored = load(storageKey(repo), decode, defaultSyncPreferences())
  cache.set(repo, stored)
  return stored
}

export const syncPreferences = (repo: RepoId): SyncPreferences => {
  version()
  return read(repo)
}

export const updateSyncPreferences = (repo: RepoId, update: (current: SyncPreferences) => SyncPreferences) => {
  const next = update(read(repo))
  cache.set(repo, next)
  save(storageKey(repo), next)
  setVersion((current) => current + 1)
}

export const savedPushDestination = (preferences: SyncPreferences, context: PushContext): PushDestination | null => {
  const saved = preferences.pushes[context.branch]
  if (
    saved === undefined ||
    saved.fingerprint !== context.fingerprint ||
    saved.destination.branch !== context.branch ||
    !context.remotes.some((remote) => remote.name === saved.destination.remote)
  )
    return null
  return saved.destination
}

export const canRememberPush = (
  before: PushContext,
  after: PushContext,
  destination: PushDestination,
  setUpstream: boolean,
) =>
  before.fingerprint === after.fingerprint ||
  (setUpstream &&
    before.configuration === after.configuration &&
    after.upstream.remote === destination.remote &&
    after.upstream.merge.length === 1 &&
    after.upstream.merge[0] === `refs/heads/${destination.remoteBranch}`)

export const rememberPushDestination = (
  preferences: SyncPreferences,
  context: PushContext,
  destination: PushDestination,
): SyncPreferences => ({
  ...preferences,
  pushes: { ...preferences.pushes, [context.branch]: { destination, fingerprint: context.fingerprint } },
})

export const pushPlan = (
  preferences: SyncPreferences,
  context: PushContext,
): { readonly destination: PushDestination; readonly setUpstream: boolean } | null => {
  const saved = savedPushDestination(preferences, context)
  if (saved !== null) return { destination: saved, setUpstream: false }
  const merge = context.upstream.merge.length === 1 ? context.upstream.merge[0] : undefined
  const remote = context.upstream.remote
  if (
    remote !== null &&
    merge !== undefined &&
    merge.startsWith("refs/heads/") &&
    context.remotes.some((candidate) => candidate.name === remote)
  )
    return {
      destination: { branch: context.branch, remote, remoteBranch: merge.slice("refs/heads/".length) },
      setUpstream: false,
    }
  const only = context.remotes.length === 1 ? context.remotes[0] : undefined
  if (remote === null && only !== undefined)
    return {
      destination: { branch: context.branch, remote: only.name, remoteBranch: context.branch },
      setUpstream: true,
    }
  return null
}
