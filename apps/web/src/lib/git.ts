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
  type RefVisibility,
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
    // The client checks the timeout only when a ping is due, so a timeout equal to the 5s ping
    // interval drops a healthy idle socket whenever that timer fires a few ms late.
    RpcClient.layerProtocolSocket({ retryTransientErrors: true, pingTimeout: "15 seconds" }).pipe(
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
  draft: (repo: RepoId) => `draft:${repo}`,
}

const scopeKeys = (repo: RepoId, scope: ChangeScope): ReadonlyArray<string> => {
  switch (scope) {
    case "worktree":
      return [keys.status(repo), keys.worktree(repo)]
    case "index":
      return [keys.status(repo), keys.worktree(repo)]
    case "refs":
      return [keys.status(repo), keys.refs(repo), keys.worktree(repo)]
    case "draft":
      return [keys.draft(repo)]
  }
}

export const latest = <A, E>(result: AsyncResult.AsyncResult<A, E>): A | undefined => {
  if (result._tag === "Success") return result.value
  if (result._tag === "Failure") return Option.getOrUndefined(Option.map(result.previousSuccess, (s) => s.value))
  return undefined
}

export const describeFailure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof GitError ? error.summary : String(error)
}

export const loadError = <A, E>(result: AsyncResult.AsyncResult<A, E>): string | undefined =>
  result._tag === "Failure" && !result.waiting && Option.isNone(result.previousSuccess)
    ? describeFailure(result.cause)
    : undefined

const CACHE_TTL = "10 minutes"

export const directoryAtom = Atom.family((path: string) => GitClient.query("ListDirectory", { path }))

export const existingReposAtom = Atom.family((paths: string) =>
  GitClient.query("FilterRepos", { paths: JSON.parse(paths) as Array<string> }),
)

export const repoInfoAtom = Atom.family((path: string) =>
  GitClient.query("OpenRepo", { path }, { timeToLive: "5 minutes" }),
)

export const statusAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetStatus", { repo }, { reactivityKeys: [keys.status(repo)], timeToLive: CACHE_TTL }),
)

export const refsAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetRefs", { repo }, { reactivityKeys: [keys.refs(repo)], timeToLive: CACHE_TTL }),
)

export const draftAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetDraft", { repo }, { reactivityKeys: [keys.draft(repo)], timeToLive: CACHE_TTL }),
)

export const saveDraftAtom = GitClient.runtime.fn(
  (draft: { readonly repo: RepoId; readonly message: string }) =>
    Effect.gen(function* () {
      const client = yield* GitClient
      yield* client("SetDraft", draft)
    }),
  { concurrent: true },
)

export const logKey = (repo: RepoId, query: string, refs: RefVisibility) => JSON.stringify([repo, query, refs])

export const logAtom = Atom.family((key: string) => {
  const [repo, query, refs] = JSON.parse(key) as [RepoId, string, RefVisibility]
  return GitClient.runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* GitClient
        return client("OpenLog", { repo, query, refs })
      }).pipe(
        Stream.unwrap,
        Stream.map((handle) => ({ ...handle, key })),
        Stream.retry(($) =>
          $(Schedule.spaced("1 second")).pipe(Schedule.while(({ input }) => input._tag !== "GitError")),
        ),
      ),
    )
    .pipe(GitClient.runtime.factory.withReactivity([keys.refs(repo)]))
})

export const pathQuery = (path: string) => `path:${/[\s"]/.test(path) ? `"${path}"` : path}`

export const LOG_PAGE_SIZE = 200

export const logPageAtom = Atom.family((key: string) => {
  const [log, logId, page] = key.split("\n") as [string, string, string]
  const [repo, query, refs] = JSON.parse(log) as [RepoId, string, RefVisibility]
  const request = { repo, logId, start: Number(page) * LOG_PAGE_SIZE, count: LOG_PAGE_SIZE }
  return GitClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* GitClient
      return yield* client("GetLogPage", request).pipe(
        Effect.catchTag("LogExpired", () =>
          Effect.andThen(Stream.runHead(client("OpenLog", { repo, query, refs })), client("GetLogPage", request)),
        ),
      )
    }).pipe(Effect.retry({ while: (error) => error._tag === "RpcClientError", schedule: Schedule.spaced("1 second") })),
  )
})

export const logPageKey = (log: string, logId: string, page: number) => `${log}\n${logId}\n${page}`

export const logIndexAtom = Atom.family((key: string) => {
  const [repo, logId, oid] = key.split("\n") as [RepoId, string, Oid]
  return GitClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* GitClient
      return yield* client("GetLogIndex", { repo, logId, oid })
    }).pipe(Effect.retry({ while: (error) => error._tag === "RpcClientError", schedule: Schedule.spaced("1 second") })),
  )
})

export const logIndexKey = (repo: RepoId, logId: string, oid: Oid) => `${repo}\n${logId}\n${oid}`

export const commitAtom = Atom.family((key: string) => {
  const [repo, oid] = key.split("\n") as [RepoId, Oid]
  return GitClient.query("GetCommit", { repo, oid }, { timeToLive: "2 minutes" })
})

export const diffKey = (
  repo: RepoId,
  target: DiffTarget,
  paths: ReadonlyArray<RepoPath> = [],
  ignoreWhitespace = false,
) => JSON.stringify([repo, target, paths, ignoreWhitespace && target._tag === "Commit"])

export const diffAtom = Atom.family((key: string) => {
  const [repo, target, paths, ignoreWhitespace] = JSON.parse(key) as [RepoId, DiffTarget, Array<RepoPath>, boolean]
  const live = target._tag !== "Commit"
  return GitClient.query(
    "GetDiff",
    { repo, target, paths, ignoreWhitespace },
    live ? { reactivityKeys: [keys.worktree(repo)] } : {},
  )
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

export const commandLogAtom = Atom.family((repo: RepoId) =>
  GitClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* GitClient
      return client("CommandLog", { repo })
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
  ),
)

export const isFailure = (entry: CommandEntry) =>
  entry.outcome._tag === "SpawnFailed" || (entry.outcome._tag === "Exited" && !entry.outcome.accepted)

export const logOpenAtom = Atom.make(false).pipe(Atom.keepAlive)

export const logSeenAtom = Atom.family((_repo: RepoId) => Atom.make(0).pipe(Atom.keepAlive))

type Client = GitClient["Service"]
type ActionError = GitError | RpcClientError
type Action = (client: Client) => Effect.Effect<unknown, ActionError>

const actionAtom = GitClient.runtime.fn(
  (action: { readonly repo: RepoId; readonly run: Action }) =>
    Effect.gen(function* () {
      const client = yield* GitClient
      return yield* Reactivity.mutation(action.run(client), scopeKeys(action.repo, "refs"))
    }),
  { concurrent: true },
)

const useFailureToast = () => {
  const setLogOpen = useAtomSet(logOpenAtom)
  return (
    label: string,
    cause: Cause.Cause<ActionError>,
    recover?: { readonly label: string; readonly onClick: () => void },
  ) => {
    const log = { label: "Show log", onClick: () => setLogOpen(true) }
    toast.error(`${label} failed`, {
      description: describeFailure(cause),
      ...(recover === undefined
        ? { action: log, classNames: { description: "whitespace-pre-line" } }
        : {
            action: recover,
            cancel: log,
            classNames: {
              toast: "flex-wrap!",
              // Sonner's icon row is 23px: a 16px icon, -3px and 4px margins, and the 6px gap.
              content: "basis-[calc(100%-23px)]!",
              description: "whitespace-pre-line",
              actionButton: "ml-0!",
            },
          }),
    })
  }
}

export const useRunGitAction = () => {
  const run = useAtomSet(actionAtom, { mode: "promiseExit" })
  return (repo: RepoId, action: Action) => run({ repo, run: action })
}

export const useGitAction = () => {
  const run = useRunGitAction()
  const fail = useFailureToast()
  return async (label: string, repo: RepoId, action: Action) => {
    const exit = await run(repo, action)
    if (Exit.isSuccess(exit)) return true
    fail(label, exit.cause)
    return false
  }
}

export const useCheckout = () => {
  const run = useAtomSet(actionAtom, { mode: "promiseExit" })
  const git = useGitAction()
  const fail = useFailureToast()
  return async (repo: RepoId, branch: string) => {
    const checkout: Action = (c) => c("Checkout", { repo, branch })
    const exit = await run({ repo, run: checkout })
    if (Exit.isSuccess(exit)) return
    const error = Cause.squash(exit.cause)
    if (!(error instanceof GitError) || !/would be (?:overwritten|removed) by checkout:/.test(error.stderr)) {
      fail("Checkout", exit.cause)
      return
    }
    const includeUntracked = error.stderr.includes("untracked working tree files would be")
    const stashAndSwitch = async () => {
      if (await git("Stash", repo, (c) => c("StashPush", { repo, message: "", includeUntracked })))
        await git("Checkout", repo, checkout)
    }
    fail("Checkout", exit.cause, { label: "Stash and switch", onClick: () => void stashAndSwitch() })
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

export const networkDoneLabels: Record<NetworkRequest["action"], string> = {
  Fetch: "Fetched",
  Pull: "Pulled",
  Push: "Pushed",
  ForcePush: "Force pushed",
}

export type NetworkState =
  | { readonly _tag: "Running"; readonly action: NetworkRequest["action"]; readonly progress: Progress | null }
  | {
      readonly _tag: "Finished"
      readonly action: NetworkRequest["action"]
      readonly outcome: "succeeded" | "failed" | "cancelled"
      readonly at: Date
    }

export const networkStateAtom = Atom.family((_repo: RepoId) =>
  Atom.make<NetworkState | null>(null).pipe(Atom.keepAlive),
)

export const networkAtom = Atom.family((repo: RepoId) =>
  GitClient.runtime
    .fn((request: NetworkRequest, get) => {
      const state = networkStateAtom(repo)
      return Effect.gen(function* () {
        const client = yield* GitClient
        get.registry.set(state, { _tag: "Running", action: request.action, progress: null })
        const updates =
          request.action === "ForcePush"
            ? client("ForcePush", { repo, expected: request.expected })
            : client(request.action, { repo })
        yield* Reactivity.mutation(
          Stream.runForEach(updates, (progress) =>
            Effect.sync(() => get.registry.set(state, { _tag: "Running", action: request.action, progress })),
          ),
          scopeKeys(repo, "refs"),
        )
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() =>
            get.registry.set(state, {
              _tag: "Finished",
              action: request.action,
              outcome: Exit.isSuccess(exit)
                ? "succeeded"
                : Cause.hasInterruptsOnly(exit.cause)
                  ? "cancelled"
                  : "failed",
              at: new Date(),
            }),
          ),
        ),
      )
    })
    .pipe(Atom.keepAlive),
)

export const useNetwork = (repo: RepoId) => {
  const run = useAtomSet(networkAtom(repo), { mode: "promiseExit" })
  const interrupt = useAtomSet(networkAtom(repo))
  const fail = useFailureToast()
  return {
    run: async (request: NetworkRequest, options?: { readonly quiet?: boolean }) => {
      const exit = await run(request)
      if (Exit.isSuccess(exit)) return true
      if (options?.quiet !== true && !Cause.hasInterruptsOnly(exit.cause))
        fail(networkLabels[request.action], exit.cause)
      return false
    },
    cancel: () => interrupt(Atom.Interrupt),
  }
}
