import { createHash } from "node:crypto"
import {
  GitError,
  type Oid,
  type PullStrategy,
  type PullTarget,
  type PushDestination,
  type PushContext,
  type Remote,
  type RepoId,
} from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { Git } from "./git.ts"
import { groups, splitNul } from "./nul.ts"

const pullFlags: Record<PullStrategy, ReadonlyArray<string>> = {
  configured: [],
  "ff-only": ["--no-rebase", "--ff-only"],
  merge: ["--no-rebase", "--ff", "--no-edit"],
  rebase: ["--rebase", "--ff"],
}

export const makePublishing = (git: Git["Service"]) => {
  const run = (repo: RepoId, args: ReadonlyArray<string>) => Effect.asVoid(git.run(repo, args, { write: true }))
  const invalid = (message: string) => new GitError({ args: [], exitCode: -1, stderr: message })
  const checkBranch = (repo: RepoId, branch: string) => git.run(repo, ["check-ref-format", `refs/heads/${branch}`])
  const checkRemote = Effect.fn(function* (repo: RepoId, name: string) {
    if (name === "" || name.startsWith("-")) return yield* invalid("Enter a remote name that does not start with '-'.")
    yield* git.run(repo, ["check-ref-format", `refs/remotes/${name}/branch`])
  })
  const checkSettings = Effect.fn(function* (repo: RepoId, remote: Remote) {
    yield* checkRemote(repo, remote.name)
    if (
      remote.urls.length === 0 ||
      [...remote.urls, ...remote.pushUrls].some((url) => url.trim() === "" || /[\0\r\n]/.test(url))
    )
      return yield* invalid("Enter a fetch URL. Put each URL on its own line.")
  })
  const configuredRemote = Effect.fn(function* (repo: RepoId, name: string) {
    yield* checkRemote(repo, name)
    yield* git.run(repo, ["remote", "get-url", "--push", "--all", "--", name])
  })
  const checkLocalRemote = Effect.fn(function* (repo: RepoId, name: string) {
    const args = ["--null", "--show-origin", "--get-regexp", "^remote\\."]
    const [effective, local] = yield* Effect.all([
      git.run(repo, ["config", ...args], { okExitCodes: [1] }),
      git.run(repo, ["config", "--local", "--no-includes", ...args], { okExitCodes: [1] }),
    ])
    const localEntries = new Set(groups(splitNul(local), 2, ([origin, entry]) => `${origin}\0${entry}`))
    const inherited = groups(splitNul(effective), 2, ([origin = "", entry = ""]) => ({ origin, entry })).filter(
      ({ origin, entry }) => {
        const key = entry.split("\n", 1)[0]!
        return key.slice(0, key.lastIndexOf(".")) === `remote.${name}` && !localEntries.has(`${origin}\0${entry}`)
      },
    )
    if (inherited.length > 0) {
      const sources = [...new Set(inherited.map(({ origin }) => origin.replace(/^file:/, "")))].join(", ")
      return yield* invalid(
        `Remote ${name} inherits settings from ${sources}. Edit its source configuration to change or remove it.`,
      )
    }
  })
  const writeUrls = Effect.fn(function* (repo: RepoId, remote: Remote) {
    for (const [key, urls] of [
      ["url", remote.urls],
      ["pushurl", remote.pushUrls],
    ] as const) {
      yield* git.run(repo, ["config", "--local", "--unset-all", `remote.${remote.name}.${key}`], {
        write: true,
        okExitCodes: [5],
      })
      for (const url of urls) yield* run(repo, ["config", "--local", "--add", `remote.${remote.name}.${key}`, url])
    }
  })
  const publish = (repo: RepoId, remote: string, args: ReadonlyArray<string>) =>
    git.progress(
      repo,
      [`--config-env=remote.${remote}.mirror=GITUI_REMOTE_MIRROR`, "push", "--progress", "--no-follow-tags", ...args],
      { env: { GITUI_REMOTE_MIRROR: "false" } },
    )
  const destinationRefspec = Effect.fn(function* (repo: RepoId, destination: PushDestination) {
    yield* configuredRemote(repo, destination.remote)
    yield* checkBranch(repo, destination.branch)
    yield* checkBranch(repo, destination.remoteBranch)
    return `refs/heads/${destination.branch}:refs/heads/${destination.remoteBranch}`
  })
  const pushContext = Effect.fn(function* (repo: RepoId, branch: string) {
    yield* checkBranch(repo, branch)
    const [head, config, names] = yield* Effect.all([
      git.text(repo, ["symbolic-ref", "--quiet", "HEAD"], { okExitCodes: [1] }),
      git.text(repo, ["config", "--null", "--get-regexp", "^(branch|remote|push|url)\\."], { okExitCodes: [1] }),
      git.text(repo, ["remote"]),
    ])
    const lines = (text: string) => text.trimEnd().split("\n").filter(Boolean)
    const remotes = yield* Effect.forEach(lines(names), (name) =>
      Effect.gen(function* () {
        const [urls, pushUrls] = yield* Effect.all([
          git.text(repo, ["remote", "get-url", "--all", "--", name]),
          git.text(repo, ["remote", "get-url", "--push", "--all", "--", name]),
        ])
        return { name, urls: lines(urls), pushUrls: lines(pushUrls) }
      }),
    )
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([branch, head, config, remotes]))
      .digest("hex")
    return { branch, fingerprint, remotes } satisfies PushContext
  })

  return {
    pushContext,
    addRemote: Effect.fn(function* (repo: RepoId, remote: Remote) {
      yield* checkSettings(repo, remote)
      yield* run(repo, ["remote", "add", "--", remote.name, remote.urls[0]!])
      yield* writeUrls(repo, remote)
    }),
    editRemote: Effect.fn(function* (repo: RepoId, name: string, remote: Remote) {
      yield* checkSettings(repo, remote)
      yield* configuredRemote(repo, name)
      yield* checkLocalRemote(repo, name)
      if (name !== remote.name) yield* run(repo, ["remote", "rename", "--", name, remote.name])
      yield* writeUrls(repo, remote)
    }),
    removeRemote: Effect.fn(function* (repo: RepoId, name: string) {
      yield* configuredRemote(repo, name)
      yield* checkLocalRemote(repo, name)
      yield* run(repo, ["remote", "remove", "--", name])
    }),
    setUpstream: Effect.fn(function* (repo: RepoId, branch: string, upstream: string | null) {
      yield* checkBranch(repo, branch)
      yield* run(repo, [
        "branch",
        upstream === null ? "--unset-upstream" : `--set-upstream-to=${upstream}`,
        "--",
        branch,
      ])
    }),
    pull: (repo: RepoId, strategy: PullStrategy, target: PullTarget) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* checkBranch(repo, target.branch)
          const branch = `refs/heads/${target.branch}`
          const head = (yield* git.text(repo, ["symbolic-ref", "--quiet", "HEAD"], { okExitCodes: [1] })).trim()
          const upstream = (yield* git.text(repo, ["for-each-ref", "--format=%(upstream)", branch])).trim()
          if (head !== branch || upstream !== target.upstream)
            return yield* invalid("The checked-out branch or its upstream changed. Close this dialog and pull again.")
          return git.progress(repo, ["pull", "--progress", ...pullFlags[strategy]])
        }),
      ),
    push: (repo: RepoId, destination: PushDestination, setUpstream: boolean, expectedContext?: string) =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (
            expectedContext !== undefined &&
            (yield* pushContext(repo, destination.branch)).fingerprint !== expectedContext
          )
            return yield* invalid("The branch or remote configuration changed. Choose the push destination again.")
          const refspec = yield* destinationRefspec(repo, destination)
          return publish(repo, destination.remote, [
            "--no-force",
            ...(setUpstream ? ["--set-upstream"] : []),
            "--",
            destination.remote,
            refspec,
          ])
        }),
      ),
    forcePush: (repo: RepoId, destination: PushDestination, expected: Oid) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const refspec = yield* destinationRefspec(repo, destination)
          return publish(repo, destination.remote, [
            `--force-with-lease=refs/heads/${destination.remoteBranch}:${expected}`,
            "--",
            destination.remote,
            refspec,
          ])
        }),
      ),
    pushTags: (repo: RepoId, remote: string, tags: ReadonlyArray<string>) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* configuredRemote(repo, remote)
          if (tags.length === 0) return yield* invalid("Choose at least one tag to push.")
          for (const tag of tags) yield* git.run(repo, ["check-ref-format", `refs/tags/${tag}`])
          return publish(repo, remote, [
            "--no-force",
            "--",
            remote,
            ...tags.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`),
          ])
        }),
      ),
    deleteRemoteBranch: (repo: RepoId, remote: string, branch: string, expected: Oid) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* configuredRemote(repo, remote)
          yield* checkBranch(repo, branch)
          return publish(repo, remote, [
            `--force-with-lease=refs/heads/${branch}:${expected}`,
            "--",
            remote,
            `:refs/heads/${branch}`,
          ])
        }),
      ),
    deleteRemoteTrackingBranch: (repo: RepoId, name: string) => run(repo, ["branch", "-d", "-r", "--", name]),
  }
}
