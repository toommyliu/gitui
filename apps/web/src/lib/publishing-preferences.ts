import * as BrowserKeyValueStore from "@effect/platform-browser/BrowserKeyValueStore"
import { PullStrategy, PushDestination, type PushContext, type RepoId } from "@gitui/contracts"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"

export const SyncPreferences = Schema.Struct({
  pullStrategy: PullStrategy,
  pushes: Schema.Record(Schema.String, Schema.Struct({ destination: PushDestination, fingerprint: Schema.String })),
})
export type SyncPreferences = typeof SyncPreferences.Type

export const defaultSyncPreferences = (): SyncPreferences => ({ pullStrategy: "ff-only", pushes: {} })

const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage)

export const syncPreferencesAtom = Atom.family((repo: RepoId) =>
  Atom.kvs({
    runtime: storage,
    key: `gitui.sync:${repo}`,
    schema: SyncPreferences,
    defaultValue: defaultSyncPreferences,
  }),
)

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

export const rememberPushDestination = (
  preferences: SyncPreferences,
  context: PushContext,
  destination: PushDestination,
): SyncPreferences => ({
  ...preferences,
  pushes: { ...preferences.pushes, [context.branch]: { destination, fingerprint: context.fingerprint } },
})
