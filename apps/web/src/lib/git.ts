import * as BrowserSocket from "@effect/platform-browser/BrowserSocket"
import { useAtomSet } from "@effect/atom-react"
import {
  type ChangeScope,
  type CommandEntry,
  type CommitRow,
  type DiffTarget,
  GitError,
  GitRpcs,
  type Oid,
  type Progress,
  type RepoId,
  type RepoPath,
} from "@gitui/contracts"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schedule from "effect/Schedule"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRpc from "effect/reactivity/AtomRpc"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as RpcClient from "effect/rpc/RpcClient"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { toast } from "sonner"
import { desktop } from "./desktop"

const socketUrl = desktop?.rpcUrl ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`

export type Connection = "connecting" | "connected" | "disconnected"

export const connectionAtom = Atom.make<Connection>("connecting").pipe(Atom.keepAlive)

export class GitClient extends AtomRpc.Service<GitClient>()("GitClient", {
  group: GitRpcs,
  protocol: (get) =>
    RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
      Layer.provide([
        BrowserSocket.layerWebSocket(socketUrl),
        RpcSerialization.layerJson,
        Layer.succeed(RpcClient.ConnectionHooks)({
          onConnect: Effect.sync(() => get.set(connectionAtom, "connected")),
          onDisconnect: Effect.sync(() => get.set(connectionAtom, "disconnected")),
        }),
      ]),
    ),
}) {}

export const keys = {
  status: (repo: RepoId) => `status:${repo}`,
  refs: (repo: RepoId) => `refs:${repo}`,
  worktree: (repo: RepoId) => `worktree:${repo}`,
}

const scopeKeys = (repo: RepoId, scope: ChangeScope): ReadonlyArray<string> => {
  switch (scope) {
    case "worktree":
      return [keys.status(repo), keys.worktree(repo)]
    case "index":
      return [keys.status(repo), keys.worktree(repo)]
    case "refs":
      return [keys.status(repo), keys.refs(repo), keys.worktree(repo)]
  }
}

export const latest = <A, E>(result: AsyncResult.AsyncResult<A, E>): A | undefined => {
  if (result._tag === "Success") return result.value
  if (result._tag === "Failure") return Option.getOrUndefined(Option.map(result.previousSuccess, (s) => s.value))
  return undefined
}

const CACHE_TTL = "10 minutes"

export const reposAtom = GitClient.query("ListRepos", undefined)

export const repoInfoAtom = Atom.family((path: string) =>
  GitClient.query("OpenRepo", { path }, { timeToLive: "5 minutes" }),
)

export const statusAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetStatus", { repo }, { reactivityKeys: [keys.status(repo)], timeToLive: CACHE_TTL }),
)

export const refsAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetRefs", { repo }, { reactivityKeys: [keys.refs(repo)], timeToLive: CACHE_TTL }),
)

export const logKey = (repo: RepoId, query: string) => JSON.stringify([repo, query])

export const logAtom = Atom.family((key: string) => {
  const [repo, query] = JSON.parse(key) as [RepoId, string]
  return GitClient.query("OpenLog", { repo, query }, { reactivityKeys: [keys.refs(repo)], timeToLive: CACHE_TTL })
})

export const pathQuery = (path: string) => `path:${/[\s"]/.test(path) ? `"${path}"` : path}`

export const LOG_PAGE_SIZE = 200

export const logPageAtom = Atom.family((key: string) => {
  const [repo, logId, page] = key.split("\n") as [RepoId, string, string]
  return GitClient.query("GetLogPage", { repo, logId, start: Number(page) * LOG_PAGE_SIZE, count: LOG_PAGE_SIZE })
})

export const logPageKey = (repo: RepoId, logId: string, page: number) => `${repo}\n${logId}\n${page}`

export const commitAtom = Atom.family((key: string) => {
  const [repo, oid] = key.split("\n") as [RepoId, Oid]
  return GitClient.query("GetCommit", { repo, oid }, { timeToLive: "2 minutes" })
})

export const diffKey = (repo: RepoId, target: DiffTarget, paths: ReadonlyArray<RepoPath> = []) =>
  JSON.stringify([repo, target, paths])

export const diffAtom = Atom.family((key: string) => {
  const [repo, target, paths] = JSON.parse(key) as [RepoId, DiffTarget, Array<RepoPath>]
  const live = target._tag !== "Commit"
  return GitClient.query("GetDiff", { repo, target, paths }, live ? { reactivityKeys: [keys.worktree(repo)] } : {})
})

export const watchAtom = Atom.family((repo: RepoId) =>
  GitClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* GitClient
      yield* Reactivity.invalidate(scopeKeys(repo, "refs"))
      yield* client("WatchRepo", { repo }).pipe(
        Stream.runForEach((event) => Reactivity.invalidate(event.scopes.flatMap((scope) => scopeKeys(repo, scope)))),
      )
    }).pipe(Effect.retry(Schedule.spaced("1 second"))),
  ),
)

export type CommitRows = ReadonlyArray<CommitRow>

export const COMMAND_LOG_LIMIT = 2000

export const commandLogAtom = GitClient.runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* GitClient
      return client("CommandLog", undefined)
    }).pipe(
      Stream.unwrap,
      Stream.scan(
        (): ReadonlyArray<CommandEntry> => [],
        (all, batch) => {
          const next = all.concat(batch)
          return next.length > COMMAND_LOG_LIMIT ? next.slice(-COMMAND_LOG_LIMIT) : next
        },
      ),
      Stream.retry(Schedule.spaced("1 second")),
    ),
  )
  .pipe(Atom.keepAlive)

export type LogFilter = "all" | "writes" | "failures"

export const isFailure = (entry: CommandEntry) =>
  entry.outcome._tag === "SpawnFailed" || (entry.outcome._tag === "Exited" && !entry.outcome.accepted)

export const logViewAtom = Atom.make<{ readonly open: boolean; readonly filter: LogFilter; readonly seenId: number }>({
  open: false,
  filter: "all",
  seenId: 0,
}).pipe(Atom.keepAlive)

type Client = GitClient["Service"]
type ActionError = GitError | RpcClientError
type Action = (client: Client) => Effect.Effect<unknown, ActionError>

const describeFailure = (cause: Cause.Cause<ActionError>) => {
  const error = Cause.squash(cause)
  return error instanceof GitError ? error.summary : String(error)
}

const actionAtom = GitClient.runtime.fn(
  (action: { readonly repo: RepoId; readonly run: Action }) =>
    Effect.gen(function* () {
      const client = yield* GitClient
      return yield* Reactivity.mutation(action.run(client), scopeKeys(action.repo, "refs"))
    }),
  { concurrent: true },
)

const useFailureToast = () => {
  const setLogView = useAtomSet(logViewAtom)
  return (label: string, cause: Cause.Cause<ActionError>) =>
    toast.error(`${label} failed`, {
      description: describeFailure(cause),
      action: { label: "Show log", onClick: () => setLogView((view) => ({ ...view, open: true, filter: "failures" })) },
    })
}

export const useGitAction = () => {
  const run = useAtomSet(actionAtom, { mode: "promiseExit" })
  const fail = useFailureToast()
  return async (label: string, repo: RepoId, action: Action) => {
    const exit = await run({ repo, run: action })
    if (Exit.isSuccess(exit)) return true
    fail(label, exit.cause)
    return false
  }
}

export type NetworkRequest =
  | { readonly action: "Fetch" | "Pull" | "Push" }
  | { readonly action: "ForcePush"; readonly expected: Oid }

export const networkLabels: Record<NetworkRequest["action"], string> = {
  Fetch: "Fetch",
  Pull: "Pull",
  Push: "Push",
  ForcePush: "Force push",
}

export interface NetworkState {
  readonly action: NetworkRequest["action"]
  readonly progress: Progress | null
}

export const networkStateAtom = Atom.family((_repo: RepoId) =>
  Atom.make<NetworkState | null>(null).pipe(Atom.keepAlive),
)

const networkAtom = Atom.family((repo: RepoId) =>
  GitClient.runtime
    .fn((request: NetworkRequest, get) => {
      const state = networkStateAtom(repo)
      return Effect.gen(function* () {
        const client = yield* GitClient
        get.registry.set(state, { action: request.action, progress: null })
        const updates =
          request.action === "ForcePush"
            ? client("ForcePush", { repo, expected: request.expected })
            : client(request.action, { repo })
        yield* Reactivity.mutation(
          Stream.runForEach(updates, (progress) =>
            Effect.sync(() => get.registry.set(state, { action: request.action, progress })),
          ),
          scopeKeys(repo, "refs"),
        )
      }).pipe(Effect.ensuring(Effect.sync(() => get.registry.set(state, null))))
    })
    .pipe(Atom.keepAlive),
)

export const useNetwork = (repo: RepoId) => {
  const run = useAtomSet(networkAtom(repo), { mode: "promiseExit" })
  const interrupt = useAtomSet(networkAtom(repo))
  const fail = useFailureToast()
  return {
    run: async (request: NetworkRequest) => {
      const exit = await run(request)
      if (Exit.isSuccess(exit)) return true
      if (!Cause.hasInterruptsOnly(exit.cause)) fail(networkLabels[request.action], exit.cause)
      return false
    },
    cancel: () => interrupt(Atom.Interrupt),
  }
}
