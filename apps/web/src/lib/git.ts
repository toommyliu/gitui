import * as BrowserSocket from "@effect/platform-browser/BrowserSocket"
import { useAtomSet } from "@effect/atom-react"
import {
  type ChangeScope,
  type CommitRow,
  type DiffTarget,
  GitRpcs,
  type Oid,
  type RepoId,
  type RepoPath,
} from "@gitui/contracts"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRpc from "effect/reactivity/AtomRpc"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { toast } from "sonner"

const socketUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`

export class GitClient extends AtomRpc.Service<GitClient>()("GitClient", {
  group: GitRpcs,
  protocol: RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide([BrowserSocket.layerWebSocket(socketUrl), RpcSerialization.layerJson]),
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

export const reposAtom = GitClient.query("ListRepos", undefined)

export const repoInfoAtom = Atom.family((path: string) =>
  GitClient.query("OpenRepo", { path }, { timeToLive: "5 minutes" }),
)

export const statusAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetStatus", { repo }, { reactivityKeys: [keys.status(repo)] }),
)

export const refsAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetRefs", { repo }, { reactivityKeys: [keys.refs(repo)] }),
)

export const logAtom = Atom.family((repo: RepoId) =>
  GitClient.query("OpenLog", { repo }, { reactivityKeys: [keys.refs(repo)] }),
)

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
      yield* client("WatchRepo", { repo }).pipe(
        Stream.runForEach((event) => Reactivity.invalidate(event.scopes.flatMap((scope) => scopeKeys(repo, scope)))),
      )
    }),
  ),
)

export type CommitRows = ReadonlyArray<CommitRow>

const describeFailure = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string") {
    return error.stderr || "git exited with an error"
  }
  return String(error)
}

type Client = GitClient["Service"]

const actionAtom = GitClient.runtime.fn(
  (action: { readonly repo: RepoId; readonly run: (client: Client) => Effect.Effect<unknown, unknown> }) =>
    Effect.gen(function* () {
      const client = yield* GitClient
      return yield* Reactivity.mutation(action.run(client), scopeKeys(action.repo, "refs"))
    }),
  { concurrent: true },
)

export const useGitAction = () => {
  const run = useAtomSet(actionAtom, { mode: "promiseExit" })
  return async (label: string, repo: RepoId, action: (client: Client) => Effect.Effect<unknown, unknown>) => {
    const exit = await run({ repo, run: action })
    if (Exit.isSuccess(exit)) return true
    toast.error(`${label} failed`, { description: describeFailure(exit.cause) })
    return false
  }
}
