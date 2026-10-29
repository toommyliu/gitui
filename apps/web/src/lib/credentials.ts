import type { CredentialPrompt, RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import type * as Redacted from "effect/Redacted"
import * as Schedule from "effect/Schedule"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import { GitClient, latest, repoInfoAtom } from "./git"

const credentialPromptsAtom = Atom.family((repo: RepoId) =>
  GitClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* GitClient
      return client("CredentialPrompts", { repo })
    }).pipe(
      Stream.unwrap,
      Stream.catchCause((cause) => Stream.concat(Stream.make([]), Stream.failCause(cause))),
      Stream.retry(Schedule.spaced("1 second")),
    ),
  ),
)

export interface PendingPrompt {
  readonly repo: RepoId
  readonly path: string
  readonly prompt: CredentialPrompt
}

export const pendingKey = (pending: PendingPrompt) => `${pending.repo}\0${pending.prompt.id}`

export const promptPathsKey = (paths: ReadonlyArray<string>) => paths.join("\0")

export const pendingPromptsAtom = Atom.family((pathsKey: string) =>
  Atom.make((get): ReadonlyArray<PendingPrompt> => {
    const seen = new Set<RepoId>()
    return (pathsKey === "" ? [] : pathsKey.split("\0")).flatMap((path) => {
      const repo = latest(get(repoInfoAtom(path)))?.id
      if (repo === undefined || seen.has(repo)) return []
      seen.add(repo)
      return (latest(get(credentialPromptsAtom(repo))) ?? []).map((prompt) => ({ repo, path, prompt }))
    })
  }),
)

export const answerPromptAtom = GitClient.runtime
  .fn(
    (request: { readonly repo: RepoId; readonly id: string; readonly answer: Redacted.Redacted<string> | null }) =>
      Effect.gen(function* () {
        const client = yield* GitClient
        return yield* client("AnswerCredentialPrompt", request)
      }),
    { concurrent: true },
  )
  .pipe(Atom.keepAlive)
