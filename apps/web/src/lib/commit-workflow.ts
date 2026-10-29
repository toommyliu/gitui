import { RegistryContext, useAtomSet } from "@effect/atom-react"
import { GitError, type IdentitySettings, type Oid, type RepoId } from "@gitui/contracts"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import * as Reactivity from "effect/reactivity/Reactivity"
import { useContext } from "react"
import { appendLine, type CommitOutput, type CommitRun, emptyOutput } from "./commit-run"
import { describeFailure, GitClient, isPromptCancel, keys } from "./git"

export const commitRunAtom = Atom.family((_repo: RepoId) => Atom.make<CommitRun | null>(null).pipe(Atom.keepAlive))

const startCommitAtom = Atom.family((repo: RepoId) =>
  GitClient.runtime
    .fn((request: { readonly message: string; readonly amend: boolean }, get) => {
      const run = commitRunAtom(repo)
      const { amend } = request
      let output: CommitOutput = emptyOutput
      let oid: Oid | null = null
      const finish = (exit: Exit.Exit<void, unknown>): CommitRun => {
        if (oid !== null) return { _tag: "Committed", amend, output, oid }
        if (Exit.isSuccess(exit))
          return { _tag: "Failed", amend, output, error: "Git exited without creating a commit." }
        if (Cause.hasInterruptsOnly(exit.cause) || isPromptCancel(exit.cause))
          return { _tag: "Cancelled", amend, output }
        const error = Cause.squash(exit.cause)
        if (output.text === "" && error instanceof GitError && error.stderr.trim() !== "")
          output = appendLine(output, error.stderr.trim())
        return { _tag: "Failed", amend, output, error: describeFailure(exit.cause) }
      }
      return Effect.gen(function* () {
        const client = yield* GitClient
        get.registry.set(run, { _tag: "Running", amend, output })
        yield* Stream.runForEach(client("Commit", { repo, ...request }), (update) =>
          Effect.sync(() => {
            if (update._tag === "Committed") {
              oid = update.oid
              return
            }
            output = appendLine(output, update.text)
            get.registry.set(run, { _tag: "Running", amend, output })
          }),
        )
      }).pipe(
        Effect.onExit((exit) => Effect.sync(() => get.registry.set(run, finish(exit)))),
        Effect.ensuring(Reactivity.invalidate([keys.status(repo), keys.refs(repo), keys.worktree(repo)])),
      )
    })
    .pipe(Atom.keepAlive),
)

export const useCommit = (repo: RepoId) => {
  const registry = useContext(RegistryContext)
  const start = useAtomSet(startCommitAtom(repo), { mode: "promiseExit" })
  const interrupt = useAtomSet(startCommitAtom(repo))
  return {
    run: async (request: { readonly message: string; readonly amend: boolean }) => {
      if (registry.get(commitRunAtom(repo))?._tag === "Running") return false
      await start(request)
      return registry.get(commitRunAtom(repo))?._tag === "Committed"
    },
    cancel: () => interrupt(Atom.Interrupt),
    dismiss: () => {
      if (registry.get(commitRunAtom(repo))?._tag !== "Running") registry.set(commitRunAtom(repo), null)
    },
  }
}

export const identityKey = (repo: RepoId) => `identity:${repo}`

export const identityAtom = Atom.family((repo: RepoId) =>
  GitClient.query("GetCommitIdentity", { repo }, { reactivityKeys: [identityKey(repo)] }),
)

export const saveIdentityAtom = GitClient.runtime.fn(
  (request: { readonly repo: RepoId; readonly settings: IdentitySettings }) =>
    Effect.gen(function* () {
      const client = yield* GitClient
      yield* client("SetCommitIdentity", request)
    }).pipe(Effect.ensuring(Reactivity.invalidate([identityKey(request.repo)]))),
  { concurrent: true },
)
