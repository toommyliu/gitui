import type { PushContext, RepoId } from "@gitui/contracts"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { describe, expect, it, vi } from "vite-plus/test"
import {
  defaultSyncPreferences,
  rememberPushDestination,
  savedPushDestination,
  syncPreferencesAtom,
  canRememberPush,
} from "./publishing-preferences"

const context: PushContext = {
  branch: "main",
  fingerprint: "original-config",
  configuration: "original-config-without-upstream",
  upstream: { remote: null, merge: [] },
  remotes: [{ name: "fork", urls: ["/tmp/fork"], pushUrls: ["/tmp/fork"] }],
}
const destination = { branch: "main", remote: "fork", remoteBranch: "review" }

describe("routine sync preferences", () => {
  it("remembers expected upstream setup but reconfirms unrelated changes during a push", () => {
    const pushed = {
      ...context,
      fingerprint: "upstream-set",
      upstream: { remote: "fork", merge: ["refs/heads/review"] },
    }
    expect(canRememberPush(context, pushed, destination, true)).toBe(true)
    expect(canRememberPush(context, pushed, destination, false)).toBe(false)
    expect(canRememberPush(context, { ...pushed, configuration: "new-remote-config" }, destination, true)).toBe(false)
    expect(
      canRememberPush(
        context,
        { ...pushed, upstream: { remote: "origin", merge: ["refs/heads/main"] } },
        destination,
        true,
      ),
    ).toBe(false)
  })
  it("requires explicit first publish even with one remote or an upstream", () => {
    expect(savedPushDestination(defaultSyncPreferences(), context)).toBeNull()
    const confirmed = rememberPushDestination(defaultSyncPreferences(), context, destination)
    expect(savedPushDestination(confirmed, context)).toEqual(destination)
  })

  it("requires a choice in multi-remote repositories and never substitutes another remote", () => {
    const multiple = {
      ...context,
      remotes: [...context.remotes, { name: "origin", urls: ["/tmp/origin"], pushUrls: [] }],
    }
    expect(savedPushDestination(defaultSyncPreferences(), multiple)).toBeNull()
    const confirmed = rememberPushDestination(defaultSyncPreferences(), multiple, destination)
    expect(savedPushDestination(confirmed, multiple)).toEqual(destination)
    expect(savedPushDestination(confirmed, { ...multiple, remotes: [multiple.remotes[1]!] })).toBeNull()
  })

  it("reconfirms changed configuration or branch and preserves the original explicit choice", () => {
    const confirmed = rememberPushDestination(defaultSyncPreferences(), context, destination)
    expect(savedPushDestination(confirmed, { ...context, fingerprint: "changed-config" })).toBeNull()
    expect(savedPushDestination(confirmed, { ...context, branch: "other" })).toBeNull()
    expect(savedPushDestination(confirmed, context)).toEqual(destination)
  })

  it("persists strategies separately across repository switches and a fresh registry", async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    })
    const firstRepo = syncPreferencesAtom("/repo/first" as RepoId)
    const secondRepo = syncPreferencesAtom("/repo/second" as RepoId)
    const registry = AtomRegistry.make()
    const reloaded = AtomRegistry.make()
    try {
      registry.mount(firstRepo)
      registry.mount(secondRepo)
      expect(registry.get(firstRepo).pullStrategy).toBe("ff-only")
      registry.set(
        firstRepo,
        rememberPushDestination({ ...defaultSyncPreferences(), pullStrategy: "configured" }, context, destination),
      )
      registry.set(secondRepo, { ...defaultSyncPreferences(), pullStrategy: "rebase" })
      await vi.waitFor(() => expect(stored.size).toBe(2))
      registry.dispose()
      reloaded.mount(firstRepo)
      reloaded.mount(secondRepo)
      await vi.waitFor(() => {
        expect(reloaded.get(firstRepo).pullStrategy).toBe("configured")
        expect(savedPushDestination(reloaded.get(firstRepo), context)).toEqual(destination)
        expect(reloaded.get(secondRepo).pullStrategy).toBe("rebase")
        expect(savedPushDestination(reloaded.get(secondRepo), context)).toBeNull()
      })
    } finally {
      registry.dispose()
      reloaded.dispose()
      vi.unstubAllGlobals()
    }
  })
})
