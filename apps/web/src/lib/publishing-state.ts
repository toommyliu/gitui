import type { RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import { GitClient, keys } from "./git"
export { syncPreferencesAtom } from "./publishing-preferences"

export const pushContextKey = (repo: RepoId, branch: string) => JSON.stringify([repo, branch])

export const pushContextAtom = Atom.family((key: string) => {
  const [repo, branch] = JSON.parse(key) as [RepoId, string]
  return GitClient.query("GetPushContext", { repo, branch }, { reactivityKeys: [keys.refs(repo)] })
})

export const loadPushContextAtom = GitClient.runtime.fn((request: { readonly repo: RepoId; readonly branch: string }) =>
  Effect.gen(function* () {
    const client = yield* GitClient
    return yield* client("GetPushContext", request)
  }),
)
