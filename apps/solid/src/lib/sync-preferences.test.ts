import type { PushContext, RepoId } from "@gitui/contracts"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import {
  canRememberPush,
  defaultSyncPreferences,
  pushPlan,
  rememberPushDestination,
  savedPushDestination,
} from "./sync-preferences"

const context: PushContext = {
  branch: "main",
  fingerprint: "original-config",
  configuration: "original-config-without-upstream",
  upstream: { remote: null, merge: [] },
  remotes: [{ name: "fork", urls: ["/tmp/fork"], pushUrls: ["/tmp/fork"] }],
}
const destination = { branch: "main", remote: "fork", remoteBranch: "review" }

describe("sync preferences", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

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

  it("persists preferences per repository across reloads", async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    })
    const first = "/repo/first" as RepoId
    const second = "/repo/second" as RepoId
    const before = await import("./sync-preferences")
    expect(before.syncPreferences(first).pullStrategy).toBe("ff-only")
    before.updateSyncPreferences(first, (current) =>
      rememberPushDestination({ ...current, pullStrategy: "configured" }, context, destination),
    )
    before.updateSyncPreferences(second, (current) => ({ ...current, pullStrategy: "rebase" }))

    vi.resetModules()
    const after = await import("./sync-preferences")
    expect(after.syncPreferences(first).pullStrategy).toBe("configured")
    expect(savedPushDestination(after.syncPreferences(first), context)).toEqual(destination)
    expect(after.syncPreferences(second).pullStrategy).toBe("rebase")
    expect(savedPushDestination(after.syncPreferences(second), context)).toBeNull()
  })

  it("falls back to defaults when stored preferences are malformed", async () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ pullStrategy: "squash" }), setItem: () => {} })
    const fresh = await import("./sync-preferences")
    expect(fresh.syncPreferences("/repo" as RepoId)).toEqual(defaultSyncPreferences())
  })
})

describe("pushPlan", () => {
  const remote = (name: string) => ({ name, urls: [`https://example.com/${name}.git`], pushUrls: [] })
  const context = (overrides: Partial<PushContext>): PushContext => ({
    branch: "feature",
    fingerprint: "f1",
    configuration: "c1",
    upstream: { remote: null, merge: [] },
    remotes: [remote("origin")],
    ...overrides,
  })

  it("pushes to the configured upstream without asking", () => {
    expect(
      pushPlan(defaultSyncPreferences(), context({ upstream: { remote: "origin", merge: ["refs/heads/topic"] } })),
    ).toEqual({ destination: { branch: "feature", remote: "origin", remoteBranch: "topic" }, setUpstream: false })
  })

  it("publishes to the only remote and sets the upstream", () => {
    expect(pushPlan(defaultSyncPreferences(), context({}))).toEqual({
      destination: { branch: "feature", remote: "origin", remoteBranch: "feature" },
      setUpstream: true,
    })
  })

  it("asks when there is no upstream and several remotes", () => {
    expect(pushPlan(defaultSyncPreferences(), context({ remotes: [remote("origin"), remote("fork")] }))).toBeNull()
  })

  it("asks when the upstream remote no longer exists", () => {
    expect(
      pushPlan(defaultSyncPreferences(), context({ upstream: { remote: "gone", merge: ["refs/heads/feature"] } })),
    ).toBeNull()
  })
})
