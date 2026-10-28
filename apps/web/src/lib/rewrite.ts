import type { Oid, RepoId, RewriteAction, RewriteRequest } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as Reactivity from "effect/reactivity/Reactivity"
import { GitClient, keys } from "./git"

export interface RewriteEntry {
  readonly first: Oid
  readonly target: Oid
  readonly action: RewriteAction
}

export const rewriteOpenAtom = Atom.family((_repo: RepoId) => Atom.make<RewriteEntry | null>(null))

export const rewritePlanAtom = Atom.family((key: string) => {
  const [repo, first] = key.split("\n") as [RepoId, Oid]
  return GitClient.query("GetRewritePlan", { repo, first }, { reactivityKeys: [keys.status(repo)] })
})

export const rebaseStateAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetRebaseState", { repo }, { reactivityKeys: [keys.status(repo)] }),
)

export const startRewriteAtom = GitClient.runtime.fn(
  (payload: { readonly repo: RepoId; readonly request: RewriteRequest }) =>
    Effect.gen(function* () {
      const client = yield* GitClient
      return yield* Reactivity.mutation(client("StartRewrite", payload), [
        keys.status(payload.repo),
        keys.refs(payload.repo),
        keys.worktree(payload.repo),
      ])
    }),
)
