import type { ChangeScope, RepoInfo, RefVisibility } from "@gitui/contracts"
import type * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createStore,
  onCleanup,
  onSettled,
  useContext,
} from "solid-js"
import { call, type Client, collect, connection, describeError, subscribe } from "./rpc"
import { refVisibility, setRefVisibility } from "./visibility"

type Ticks = Record<ChangeScope, number>

export type Network = "fetch" | "pull" | "push"

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string }

export const createRepo = ({ id, commonDir }: Pick<RepoInfo, "id" | "commonDir">) => {
  const [ticks, setTicks] = createStore<Ticks>({ worktree: 0, index: 0, refs: 0, draft: 0 })

  const invalidate = (scopes: ReadonlyArray<ChangeScope>) =>
    setTicks((draft) => {
      for (const scope of scopes) draft[scope]++
    })

  const track = (...scopes: ReadonlyArray<ChangeScope>) => scopes.reduce((sum, scope) => sum + ticks[scope], 0)

  // A change that lands while the last refresh is in flight joins its transition, so changes arriving
  // faster than a refresh takes would hold it forever. Apply them once the refresh settles.
  let held: Set<ChangeScope> | null = null
  const refresh = (scopes: ReadonlyArray<ChangeScope>) => {
    if (held !== null) {
      for (const scope of scopes) held.add(scope)
      return
    }
    held = new Set()
    invalidate(scopes)
    onSettled(() => {
      const next = held ?? new Set()
      held = null
      if (next.size > 0) refresh([...next])
    })
  }

  onCleanup(
    subscribe(
      (git) => git.WatchRepo({ repo: id }),
      (event) => refresh(event.scopes),
    ),
  )

  createEffect(
    () => connection(),
    (state, previous) => {
      if (state === "connected" && previous === "disconnected") invalidate(["worktree", "index", "refs", "draft"])
    },
  )

  const status = createMemo(() => {
    track("worktree", "index", "refs")
    return call((git) => git.GetStatus({ repo: id }))
  })

  const refs = createMemo(() => {
    track("refs")
    return call((git) => git.GetRefs({ repo: id }))
  })

  const mutate = async <A, E>(scopes: ReadonlyArray<ChangeScope>, request: (git: Client) => Effect.Effect<A, E>) => {
    try {
      return await call(request)
    } finally {
      invalidate(scopes)
    }
  }

  const [network, setNetwork] = createSignal<Network | null>(null)

  let streaming = false
  const stream = async <E>(kind: Network, request: (git: Client) => Stream.Stream<unknown, E>): Promise<Outcome> => {
    if (streaming) return { ok: false, message: "Wait for the current fetch, pull or push to finish." }
    streaming = true
    setNetwork(kind)
    try {
      await collect(request)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: describeError(error) }
    } finally {
      streaming = false
      setNetwork(null)
      invalidate(["refs"])
    }
  }

  const visibility = () => refVisibility(commonDir)
  const setVisibility = (next: RefVisibility) => setRefVisibility(commonDir, next)

  return { id, track, invalidate, status, refs, visibility, setVisibility, mutate, network, stream }
}

export type Repo = ReturnType<typeof createRepo>

export const RepoContext = createContext<Repo>()

export const useRepo = () => useContext(RepoContext)
