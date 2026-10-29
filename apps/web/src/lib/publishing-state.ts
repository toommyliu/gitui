import type { RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { GitClient, keys } from "./git"
export { syncPreferencesAtom } from "./publishing-preferences"

export const pushContextKey = (repo: RepoId, branch: string) => JSON.stringify([repo, branch])

export const pushContextAtom = Atom.family((key: string) => {
  const [repo, branch] = JSON.parse(key) as [RepoId, string]
  return GitClient.query("GetPushContext", { repo, branch }, { reactivityKeys: [keys.refs(repo)] })
})

export const loadPushContext = (registry: AtomRegistry.AtomRegistry, repo: RepoId, branch: string) =>
  Effect.runPromiseExit(
    AtomRegistry.getResult(
      registry,
      GitClient.runtime.atom(
        Effect.gen(function* () {
          const client = yield* GitClient
          return yield* client("GetPushContext", { repo, branch })
        }),
      ),
    ),
  )
