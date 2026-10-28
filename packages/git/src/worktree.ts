import { join } from "node:path"
import {
  type BaseRef,
  type BranchCommit,
  type FileDiff,
  type Head,
  type MergeCheck,
  type Oid,
  type RepoId,
  type RepoPath,
  type StatusEntry,
  type WorktreeDetail,
  type WorktreeSummary,
  GitError,
} from "@gitui/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Git } from "./git.ts"
import { groups, splitNul } from "./nul.ts"
import { parseWorktrees, worktreeArgs } from "./refs.ts"
import { parseStatus, statusArgs } from "./status.ts"

const MAX_COMMITS = 100
const MAX_PATHS = 2000
const MAX_STATS = 1000
const MAX_UNTRACKED_DIFFS = 50
const MAX_PATCH_BYTES = 4 * 1024 * 1024
const MAX_REPLAY = 100
const decoder = new TextDecoder()

const baseRefsArgs = [
  "for-each-ref",
  "--format=%(refname)%00%(objectname)%00%(symref)",
  "refs/heads",
  "refs/remotes/origin",
]

export const parseBase = (out: string): BaseRef | null => {
  const refs = new Map<string, { oid: string; symref: string }>()
  for (const line of out.split("\n")) {
    const [ref = "", oid = "", symref = ""] = line.split("\0")
    if (ref !== "") refs.set(ref, { oid, symref })
  }
  const remoteHead = refs.get("refs/remotes/origin/HEAD")?.symref.replace(/^refs\/remotes\/origin\//, "")
  const candidates = [
    ...(remoteHead === undefined ? [] : [`refs/heads/${remoteHead}`, `refs/remotes/origin/${remoteHead}`]),
    "refs/heads/main",
    "refs/heads/master",
  ]
  for (const ref of candidates) {
    const found = refs.get(ref)
    if (found !== undefined) return { name: ref.replace(/^refs\/(heads|remotes)\//, ""), oid: found.oid as Oid }
  }
  return null
}

const headOid = (head: Head): Oid | null => (head._tag === "Unborn" ? null : head.oid)

const entryPaths = (entries: ReadonlyArray<StatusEntry>) =>
  entries.flatMap((entry) =>
    entry._tag === "Tracked" && entry.from !== null ? [entry.from, entry.path] : [entry.path],
  )

const uniqueCountArgs = (base: Oid) => ["rev-list", "--count", "--cherry-pick", "--right-only", `${base}...HEAD`]

const commitArgs = (base: Oid) => [
  "log",
  "-z",
  "--cherry-mark",
  "--right-only",
  `--max-count=${MAX_COMMITS + 1}`,
  "--format=%m%x00%H%x00%ct%x00%s",
  `${base}...HEAD`,
  "--",
]

const parseBranchCommits = (bytes: Uint8Array) =>
  groups(splitNul(bytes), 4, ([mark = "", oid = "", time = "0", subject = ""]) => ({
    oid: oid as Oid,
    subject,
    time: Number(time),
    equivalent: mark === "=",
  }))

const parsePatchIds = (out: string) => {
  const byCommit = new Map<string, string>()
  for (const line of out.split("\n")) {
    const [patchId, commit] = line.split(" ")
    if (patchId !== undefined && commit !== undefined) byCommit.set(commit, patchId)
  }
  return byCommit
}

const parseMergeTree = (bytes: Uint8Array) => {
  const [tree = "", ...rest] = splitNul(bytes)
  return { tree, conflicts: rest.filter((path) => path !== "") as Array<RepoPath> }
}

const toCheck = ({ conflicts }: { conflicts: Array<RepoPath> }): MergeCheck =>
  conflicts.length === 0 ? { _tag: "Clean" } : { _tag: "Conflicts", paths: conflicts }

const mergeTreeArgs = (mergeBase: string, ours: string, theirs: string) => [
  "merge-tree",
  "--write-tree",
  "-z",
  "--name-only",
  "--no-messages",
  `--merge-base=${mergeBase}`,
  ours,
  theirs,
]

export class Worktrees extends Context.Service<
  Worktrees,
  {
    readonly summaries: (repo: RepoId) => Effect.Effect<ReadonlyArray<WorktreeSummary>, GitError>
    readonly detail: (worktree: RepoId) => Effect.Effect<WorktreeDetail, GitError>
    readonly diff: (worktree: RepoId, allowLarge?: boolean) => Effect.Effect<FileDiff, GitError>
    readonly checkMerge: (worktree: RepoId, base: Oid) => Effect.Effect<MergeCheck, GitError>
  }
>()("@gitui/git/Worktrees") {
  static readonly layer = Layer.effect(
    Worktrees,
    Effect.gen(function* () {
      const git = yield* Git
      const fs = yield* FileSystem.FileSystem

      const base = (cwd: string) => Effect.map(git.text(cwd, baseRefsArgs), parseBase)

      const status = (cwd: string) => Effect.map(git.run(cwd, statusArgs), parseStatus)

      const committedPaths = (cwd: string, baseOid: Oid) =>
        Effect.map(
          git.run(cwd, ["log", "-z", "--cherry-pick", "--right-only", "--name-only", "--format=", `${baseOid}...HEAD`]),
          (bytes) => splitNul(bytes) as Array<RepoPath>,
        )

      const summary = Effect.fn("Worktrees.summary")(function* (path: string, baseRef: BaseRef | null) {
        const { head, entries } = yield* status(path)
        const changed = entryPaths(entries)
        if (baseRef === null || headOid(head) === null) {
          return {
            path,
            changes: entries.length,
            commits: baseRef === null ? null : 0,
            paths: changed.slice(0, MAX_PATHS),
          }
        }
        const count = yield* git.text(path, uniqueCountArgs(baseRef.oid))
        const commits = Number(count.trim())
        const committed = commits > 0 ? yield* committedPaths(path, baseRef.oid) : []
        const paths = [...new Set([...changed, ...committed].filter((p) => p !== ""))]
        return { path, changes: entries.length, commits, paths: paths.slice(0, MAX_PATHS) as Array<RepoPath> }
      })

      const summaries = Effect.fn("Worktrees.summaries")(function* (repo: RepoId) {
        const [listed, baseRef] = yield* Effect.all([git.run(repo, worktreeArgs), base(repo)], { concurrency: 2 })
        const worktrees = parseWorktrees(listed).filter((w) => w.head._tag !== "Bare" && w.prunable === null)
        const results = yield* Effect.forEach(worktrees, (worktree) => Effect.option(summary(worktree.path, baseRef)), {
          concurrency: 4,
        })
        return results.flatMap((result) => (Option.isSome(result) ? [result.value] : []))
      })

      const landedAs = Effect.fn("Worktrees.landedAs")(function* (
        worktree: RepoId,
        baseOid: Oid,
        equivalent: ReadonlyArray<Oid>,
      ) {
        if (equivalent.length === 0) return new Map<string, Oid>()
        const left = (yield* git.text(worktree, ["rev-list", "--cherry-mark", "--left-only", `${baseOid}...HEAD`]))
          .split("\n")
          .flatMap((line) => (line.startsWith("=") ? [line.slice(1)] : []))
        const patches = yield* git.run(worktree, ["diff-tree", "--stdin", "-p", "--no-color", "--no-ext-diff"], {
          stdin: new TextEncoder().encode([...left, ...equivalent].map((oid) => `${oid}\n`).join("")),
        })
        const ids = parsePatchIds(yield* git.text(worktree, ["patch-id", "--stable"], { stdin: patches }))
        const byPatch = new Map(left.flatMap((oid) => (ids.has(oid) ? [[ids.get(oid)!, oid as Oid]] : [])))
        return new Map(
          equivalent.flatMap((oid) => {
            const landed = byPatch.get(ids.get(oid) ?? "")
            return landed === undefined ? [] : [[oid, landed]]
          }),
        )
      })

      const editedAt = Effect.fn("Worktrees.editedAt")(function* (
        worktree: RepoId,
        entries: ReadonlyArray<StatusEntry>,
      ) {
        const times = yield* Effect.forEach(
          entries.slice(0, MAX_STATS),
          (entry) =>
            fs.stat(join(worktree, entry.path)).pipe(
              Effect.map((info) => Option.getOrUndefined(Option.map(info.mtime, (date) => date.getTime()))),
              Effect.orElseSucceed(() => undefined),
            ),
          { concurrency: 32 },
        )
        const newest = Math.max(...times.filter((time) => time !== undefined))
        return Number.isFinite(newest) ? Math.floor(newest / 1000) : null
      })

      const detail = Effect.fn("Worktrees.detail")(function* (worktree: RepoId) {
        const [{ head, entries }, baseRef] = yield* Effect.all([status(worktree), base(worktree)], { concurrency: 2 })
        const edited = yield* editedAt(worktree, entries)
        const empty = {
          head,
          base: baseRef,
          mergeBase: null,
          behind: 0,
          unique: 0,
          commits: [],
          truncated: false,
          entries,
          editedAt: edited,
        }
        if (baseRef === null || headOid(head) === null) return empty
        const mergeBase = (yield* git.text(worktree, ["merge-base", baseRef.oid, "HEAD"], { okExitCodes: [1] })).trim()
        const [behind, unique, log] = yield* Effect.all(
          [
            git.text(worktree, ["rev-list", "--count", `HEAD..${baseRef.oid}`]),
            git.text(worktree, uniqueCountArgs(baseRef.oid)),
            git.run(worktree, commitArgs(baseRef.oid)),
          ],
          { concurrency: 3 },
        )
        const parsed = parseBranchCommits(log)
        const shown = parsed.slice(0, MAX_COMMITS)
        const landed = yield* landedAs(
          worktree,
          baseRef.oid,
          shown.filter((commit) => commit.equivalent).map((commit) => commit.oid),
        )
        const commits: Array<BranchCommit> = shown.map(({ oid, subject, time }) => ({
          oid,
          subject,
          time,
          landed: landed.get(oid) ?? null,
        }))
        return {
          ...empty,
          mergeBase: mergeBase === "" ? null : (mergeBase as Oid),
          behind: Number(behind.trim()),
          unique: Number(unique.trim()),
          commits,
          truncated: parsed.length > MAX_COMMITS,
        }
      })

      const emptyTree = (worktree: RepoId) =>
        Effect.map(git.text(worktree, ["hash-object", "-t", "tree", "--stdin"], { stdin: new Uint8Array() }), (out) =>
          out.trim(),
        )

      const diff = Effect.fn("Worktrees.diff")(function* (worktree: RepoId, allowLarge = false) {
        const { head, entries } = yield* status(worktree)
        const against = headOid(head) ?? (yield* emptyTree(worktree))
        const common = ["--no-ext-diff", "--no-color", "-M"]
        const untracked = entries.flatMap((entry) => (entry._tag === "Untracked" ? [entry.path] : []))
        const [tracked, added] = yield* Effect.all(
          [
            git.run(worktree, ["diff", ...common, against, "--"]),
            Effect.forEach(
              untracked.slice(0, MAX_UNTRACKED_DIFFS),
              (path) =>
                git
                  .run(worktree, ["diff", "--no-index", ...common, "--", "/dev/null", path], { okExitCodes: [1] })
                  .pipe(Effect.orElseSucceed(() => new Uint8Array())),
              { concurrency: 4 },
            ),
          ],
          { concurrency: 2 },
        )
        const bytes = Buffer.concat([tracked, ...added])
        if (!allowLarge && bytes.length > MAX_PATCH_BYTES)
          return { _tag: "TooLarge", bytes: bytes.length } satisfies FileDiff
        const text = decoder.decode(bytes)
        if (!/^diff --git /m.test(text)) return { _tag: "Empty" } satisfies FileDiff
        return { _tag: "Patch", patch: text } satisfies FileDiff
      })

      const snapshot = Effect.fn("Worktrees.snapshot")(function* (worktree: RepoId, head: Oid | null) {
        const dir = yield* fs
          .makeTempDirectoryScoped({ prefix: "gitui-index-" })
          .pipe(Effect.mapError((error) => new GitError({ args: [], exitCode: -1, stderr: String(error) })))
        const env = { GIT_INDEX_FILE: join(dir, "index") }
        yield* git.run(worktree, head === null ? ["read-tree", "--empty"] : ["read-tree", head], { env })
        yield* git.run(worktree, ["add", "-A"], { env })
        return (yield* git.text(worktree, ["write-tree"], { env })).trim()
      }, Effect.scoped)

      const checkMerge = Effect.fn("Worktrees.checkMerge")(function* (worktree: RepoId, baseOid: Oid) {
        const { head } = yield* status(worktree)
        const headCommit = headOid(head)
        const tree = yield* snapshot(worktree, headCommit)
        const merge = (mergeBase: string, ours: string, theirs: string) =>
          Effect.map(git.run(worktree, mergeTreeArgs(mergeBase, ours, theirs), { okExitCodes: [1] }), parseMergeTree)
        if (headCommit === null) return toCheck(yield* merge(yield* emptyTree(worktree), baseOid, tree))
        const commits = (yield* git.text(worktree, [
          "rev-list",
          "--reverse",
          "--no-merges",
          "--cherry-pick",
          "--right-only",
          "--parents",
          `${baseOid}...HEAD`,
        ]))
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => line.split(" "))
        if (commits.length > MAX_REPLAY) {
          const forkPoint = (yield* git.text(worktree, ["merge-base", baseOid, headCommit], {
            okExitCodes: [1],
          })).trim()
          return toCheck(yield* merge(forkPoint || (yield* emptyTree(worktree)), baseOid, tree))
        }
        let tip: string = baseOid
        for (const [oid = "", parent] of commits) {
          const step = yield* merge(parent ?? (yield* emptyTree(worktree)), tip, oid)
          if (step.conflicts.length > 0) return toCheck(step)
          tip = step.tree
        }
        return toCheck(yield* merge(headCommit, tip, tree))
      })

      return Worktrees.of({ summaries, detail, diff, checkMerge })
    }),
  ).pipe(Layer.provide(Git.layer))
}
