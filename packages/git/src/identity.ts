import { GitError, type CommitIdentity, type IdentitySettings, type RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import type { Git } from "./git.ts"

type Runner = Git["Service"]
const keys = {
  name: "user.name",
  email: "user.email",
  signing: "commit.gpgsign",
  signingKey: "user.signingkey",
  signingFormat: "gpg.format",
} as const

export const makeIdentity = (git: Runner) => {
  const get = (repo: RepoId, key: string, local = false, bool = false) =>
    git
      .text(repo, ["config", ...(local ? ["--local"] : []), ...(bool ? ["--bool"] : []), "--get", key], {
        okExitCodes: [1],
      })
      .pipe(Effect.map((text) => text.trimEnd() || null))
  const ident = (repo: RepoId, variable: string) =>
    git.text(repo, ["var", variable], { okExitCodes: [128] }).pipe(
      Effect.map((text) => {
        const match = /^(.*) <([^<>]*)> \d+ [+-]\d+\s*$/.exec(text)
        return { name: match?.[1] ?? "", email: match?.[2] ?? "" }
      }),
    )
  return {
    read: (repo: RepoId): Effect.Effect<CommitIdentity, GitError> =>
      Effect.gen(function* () {
        const [author, committer] = yield* Effect.all([
          ident(repo, "GIT_AUTHOR_IDENT"),
          ident(repo, "GIT_COMMITTER_IDENT"),
        ])
        if (!author.name) author.name = process.env.GIT_AUTHOR_NAME ?? (yield* get(repo, keys.name)) ?? ""
        if (!author.email)
          author.email = process.env.GIT_AUTHOR_EMAIL ?? (yield* get(repo, keys.email)) ?? process.env.EMAIL ?? ""
        if (!committer.name) committer.name = process.env.GIT_COMMITTER_NAME ?? (yield* get(repo, keys.name)) ?? ""
        if (!committer.email)
          committer.email = process.env.GIT_COMMITTER_EMAIL ?? (yield* get(repo, keys.email)) ?? process.env.EMAIL ?? ""
        const signing = (yield* get(repo, keys.signing, false, true)) === "true"
        const format = (yield* get(repo, keys.signingFormat)) ?? "openpgp"
        if (format !== "openpgp" && format !== "ssh" && format !== "x509")
          return yield* new GitError({
            args: ["config"],
            exitCode: -1,
            stderr: `Unsupported signing format: ${format}`,
          })
        const localFormat = yield* get(repo, keys.signingFormat, true)
        const localSign = yield* get(repo, keys.signing, true, true)
        return {
          ...author,
          committerName: committer.name,
          committerEmail: committer.email,
          signing,
          signingKey: (yield* get(repo, keys.signingKey)) ?? "",
          signingFormat: format,
          signingProgram:
            format === "openpgp"
              ? (yield* git.text(repo, ["config", "--null", "--get-regexp", "^gpg\\.(program|openpgp\\.program)$"], {
                  okExitCodes: [1],
                }))
                  .split("\0")
                  .filter(Boolean)
                  .at(-1)
                  ?.split("\n")
                  .slice(1)
                  .join("\n") || "gpg"
              : ((yield* get(repo, `gpg.${format}.program`)) ?? (format === "ssh" ? "ssh-keygen" : "gpgsm")),
          local: {
            name: yield* get(repo, keys.name, true),
            email: yield* get(repo, keys.email, true),
            signing: localSign === null ? null : localSign === "true",
            signingKey: yield* get(repo, keys.signingKey, true),
            signingFormat:
              localFormat === "openpgp" || localFormat === "ssh" || localFormat === "x509" ? localFormat : null,
          },
        }
      }),
    write: (repo: RepoId, settings: IdentitySettings) =>
      Effect.gen(function* () {
        for (const field of ["name", "email"] as const) {
          const value = settings[field]
          if (value !== null && (value.trim() === "" || /[\n\r<>\0]/.test(value)))
            return yield* new GitError({
              args: ["config"],
              exitCode: -1,
              stderr: `Enter a valid ${field === "name" ? "author name" : "email address"}.`,
            })
        }
        for (const field of Object.keys(keys) as Array<keyof typeof keys>) {
          const value = settings[field]
          yield* git.run(
            repo,
            [
              "config",
              "--local",
              value === null ? "--unset-all" : "--replace-all",
              keys[field],
              ...(value === null ? [] : [String(value)]),
            ],
            { write: true, okExitCodes: value === null ? [5] : [] },
          )
        }
      }),
  }
}
