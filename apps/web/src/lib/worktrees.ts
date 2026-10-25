import { useAtomSet } from "@effect/atom-react"
import type { Oid, RepoId, Worktree } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Atom from "effect/reactivity/Atom"
import * as Reactivity from "effect/reactivity/Reactivity"
import { useEffect } from "react"
import { basename } from "./format"
import { GitClient, keys } from "./git"

export const worktreeLabel = (worktree: Worktree) =>
  worktree.head._tag === "Branch" ? worktree.head.name : basename(worktree.path)

export const repoNameOf = (commonDir: string) => {
  const name = basename(commonDir)
  if (name === ".git") return basename(commonDir.slice(0, -"/.git".length))
  return name.endsWith(".git") ? name.slice(0, -".git".length) : name
}

export const worktreesKey = (repo: RepoId) => `worktrees:${repo}`

export const worktreeSummariesAtom = Atom.family((repo: RepoId) =>
  GitClient.query(
    "GetWorktreeSummaries",
    { repo },
    { reactivityKeys: [keys.refs(repo), worktreesKey(repo)], timeToLive: "10 minutes" },
  ),
)

export const worktreeAtom = Atom.family((worktree: RepoId) =>
  GitClient.query(
    "GetWorktree",
    { repo: worktree },
    { reactivityKeys: [keys.status(worktree)], timeToLive: "1 minute" },
  ),
)

export const worktreeDiffKey = (worktree: RepoId, allowLarge: boolean) => JSON.stringify([worktree, allowLarge])

export const worktreeDiffAtom = Atom.family((key: string) => {
  const [worktree, allowLarge] = JSON.parse(key) as [RepoId, boolean]
  return GitClient.query(
    "GetWorktreeDiff",
    { repo: worktree, allowLarge },
    { reactivityKeys: [keys.worktree(worktree)], timeToLive: "1 minute" },
  )
})

export const mergeCheckKey = (worktree: RepoId, base: Oid, fingerprint: string) =>
  JSON.stringify([worktree, base, fingerprint])

export const mergeCheckAtom = Atom.family((key: string) => {
  const [repo, base] = JSON.parse(key) as [RepoId, Oid, string]
  return GitClient.runtime.atom(
    Effect.gen(function* () {
      const client = yield* GitClient
      return yield* client("CheckWorktreeMerge", { repo, base })
    }),
  )
})

const invalidateAtom = GitClient.runtime.fn((targets: ReadonlyArray<string>) => Reactivity.invalidate(targets))

export const useRefreshOnFocus = (targets: ReadonlyArray<string>) => {
  const invalidate = useAtomSet(invalidateAtom)
  const joined = targets.join("\n")
  useEffect(() => {
    const refresh = () => invalidate(joined.split("\n"))
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [invalidate, joined])
}
