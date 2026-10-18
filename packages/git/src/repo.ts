import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import {
  type CommitDetail,
  type CommitRow,
  type DiffTarget,
  type FileDiff,
  type LogHandle,
  type Oid,
  type Operation,
  type Refs,
  type RepoId,
  type RepoInfo,
  type RepoPath,
  type Status,
  GitError,
  LogExpired,
  RepoNotFound,
} from "@gitui/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Pull from "effect/Pull"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import { diffTreeArgs, parseCommit, parseFileChanges, showArgs } from "./commit.ts"
import { Git, nulList } from "./git.ts"
import { LogParser, logArgs, logRevArgs } from "./log.ts"
import {
  forEachRefArgs,
  parseRefs,
  parseRemotes,
  parseStashes,
  parseWorktrees,
  remotesArgs,
  stashArgs,
  worktreeArgs,
} from "./refs.ts"
import { parseStatus, statusArgs } from "./status.ts"

const chunks = <T>(items: ReadonlyArray<T>, size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

const MAX_PATCH_BYTES = 4 * 1024 * 1024
const decoder = new TextDecoder()

const operationMarkers: ReadonlyArray<readonly [string, Operation]> = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"],
]

interface LogSession {
  readonly logId: string
  readonly total: number
  readonly rows: Array<CommitRow>
  readonly parser: LogParser
  readonly pull: Pull.Pull<ReadonlyArray<Uint8Array>, GitError>
  readonly scope: Scope.Closeable
  readonly lock: Semaphore.Semaphore
  done: boolean
}

export class Repo extends Context.Service<
  Repo,
  {
    open(path: string): Effect.Effect<RepoInfo, RepoNotFound>
    status(repo: RepoId): Effect.Effect<Status, GitError>
    refs(repo: RepoId): Effect.Effect<Refs, GitError>
    openLog(repo: RepoId): Effect.Effect<LogHandle, GitError>
    logPage(
      repo: RepoId,
      logId: string,
      start: number,
      count: number,
    ): Effect.Effect<ReadonlyArray<CommitRow>, GitError | LogExpired>
    commit(repo: RepoId, oid: Oid): Effect.Effect<CommitDetail, GitError>
    diff(repo: RepoId, target: DiffTarget, paths: ReadonlyArray<RepoPath>): Effect.Effect<FileDiff, GitError>
    stage(repo: RepoId, paths: ReadonlyArray<RepoPath>): Effect.Effect<void, GitError>
    unstage(repo: RepoId, paths: ReadonlyArray<RepoPath>): Effect.Effect<void, GitError>
    discard(repo: RepoId, paths: ReadonlyArray<RepoPath>): Effect.Effect<void, GitError>
    commitIndex(repo: RepoId, message: string, amend: boolean): Effect.Effect<void, GitError>
    checkout(repo: RepoId, branch: string): Effect.Effect<void, GitError>
    createBranch(repo: RepoId, name: string, startPoint: Oid, checkout: boolean): Effect.Effect<void, GitError>
    deleteBranch(repo: RepoId, name: string, force: boolean, removeWorktree: boolean): Effect.Effect<void, GitError>
    removeWorktree(repo: RepoId, path: string, force: boolean): Effect.Effect<void, GitError>
    pruneWorktrees(repo: RepoId): Effect.Effect<void, GitError>
    fetch(repo: RepoId): Effect.Effect<void, GitError>
    pull(repo: RepoId): Effect.Effect<void, GitError>
    push(repo: RepoId): Effect.Effect<void, GitError>
    stashApply(repo: RepoId, oid: Oid, drop: boolean): Effect.Effect<void, GitError>
    stashDrop(repo: RepoId, oid: Oid): Effect.Effect<void, GitError>
  }
>()("@gitui/git/Repo") {
  static readonly layer = Layer.effect(
    Repo,
    Effect.gen(function* () {
      const git = yield* Git
      const sessions = new Map<RepoId, LogSession>()

      const hasHead = (repo: RepoId) =>
        git
          .text(repo, ["rev-parse", "--verify", "-q", "HEAD"], { okExitCodes: [1] })
          .pipe(Effect.map((out) => out.trim() !== ""))

      const open = Effect.fn("Repo.open")(function* (path: string) {
        const out = yield* git
          .text(resolve(path), ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"])
          .pipe(Effect.mapError(() => new RepoNotFound({ path })))
        const [root = "", gitDir = "", commonDir = ""] = out.trimEnd().split("\n")
        if (root === "") return yield* new RepoNotFound({ path })
        return { id: root as RepoId, name: basename(root), gitDir, commonDir: resolve(root, commonDir) }
      })

      const gitDirOf = (repo: RepoId) =>
        git.text(repo, ["rev-parse", "--absolute-git-dir"]).pipe(Effect.map((s) => s.trim()))

      const status = Effect.fn("Repo.status")(function* (repo: RepoId) {
        const [bytes, gitDir] = yield* Effect.all([git.run(repo, statusArgs), gitDirOf(repo)], { concurrency: 2 })
        const parsed = parseStatus(bytes)
        const operation = operationMarkers.find(([marker]) => existsSync(join(gitDir, marker)))?.[1] ?? null
        return { ...parsed, operation }
      })

      const refs = Effect.fn("Repo.refs")(function* (repo: RepoId) {
        const [remotesOut, refsOut, stashOut, worktreeOut] = yield* Effect.all(
          [
            git.run(repo, remotesArgs, { okExitCodes: [1] }),
            git.run(repo, forEachRefArgs),
            git.run(repo, stashArgs),
            git.run(repo, worktreeArgs),
          ],
          { concurrency: 4 },
        )
        const remotes = parseRemotes(remotesOut)
        return {
          ...parseRefs(refsOut, remotes),
          remotes,
          stashes: parseStashes(stashOut),
          worktrees: parseWorktrees(worktreeOut),
        }
      })

      const closeSession = (repo: RepoId) => {
        const session = sessions.get(repo)
        sessions.delete(repo)
        return session === undefined ? Effect.void : Scope.close(session.scope, Exit.void)
      }

      const openLog = Effect.fn("Repo.openLog")(function* (repo: RepoId) {
        const head = yield* hasHead(repo)
        const tips = yield* git.text(repo, ["rev-parse", ...logRevArgs(head)], { okExitCodes: [128] })
        const logId = createHash("sha1").update(tips).digest("hex").slice(0, 16)
        const existing = sessions.get(repo)
        if (existing?.logId === logId) return { logId, total: existing.total }
        yield* closeSession(repo)

        const total = Number(
          (yield* git.text(repo, ["rev-list", "--count", ...logRevArgs(head)], { okExitCodes: [128] })).trim() || 0,
        )
        const scope = yield* Scope.make()
        const pull = yield* Stream.toPull(git.stream(repo, logArgs(head))).pipe(Scope.provide(scope))
        sessions.set(repo, {
          logId,
          total,
          rows: [],
          parser: new LogParser(),
          pull,
          scope,
          lock: Semaphore.makeUnsafe(1),
          done: total === 0,
        })
        return { logId, total }
      })

      const logPage = Effect.fn("Repo.logPage")(function* (repo: RepoId, logId: string, start: number, count: number) {
        const session = sessions.get(repo)
        if (session === undefined || session.logId !== logId) return yield* new LogExpired()
        const end = start + count
        yield* session.lock.withPermits(1)(
          Effect.gen(function* () {
            while (!session.done && session.rows.length < end) {
              const chunks = yield* session.pull.pipe(
                Pull.catchDone(() => {
                  session.done = true
                  return Effect.succeed([] as ReadonlyArray<Uint8Array>)
                }),
              )
              for (const chunk of chunks) session.rows.push(...session.parser.push(chunk))
              if (session.done) session.rows.push(...session.parser.flush())
            }
          }),
        )
        return session.rows.slice(start, end)
      })

      const commit = Effect.fn("Repo.commit")(function* (repo: RepoId, oid: Oid) {
        const show = yield* git.run(repo, showArgs(oid))
        const detail = parseCommit(show, [])
        const files = parseFileChanges(yield* git.run(repo, diffTreeArgs(oid, detail.parents[0])))
        return { ...detail, files }
      })

      const patchArgs = (target: DiffTarget, paths: ReadonlyArray<string>): ReadonlyArray<string> => {
        const common = ["--no-ext-diff", "--no-color", "-M"]
        switch (target._tag) {
          case "Commit":
            return [
              "diff-tree",
              "-p",
              "-r",
              "--no-commit-id",
              ...common,
              "--root",
              "-m",
              "--first-parent",
              target.oid,
              "--",
              ...paths,
            ]
          case "Staged":
            return ["diff", "--cached", ...common, "--", ...paths]
          case "Unstaged":
            return ["diff", ...common, "--", ...paths]
          case "Untracked":
            return ["diff", "--no-index", ...common, "--", "/dev/null", ...paths]
        }
      }

      const diff = Effect.fn("Repo.diff")(function* (repo: RepoId, target: DiffTarget, paths: ReadonlyArray<RepoPath>) {
        const bytes = yield* git.run(repo, patchArgs(target, paths), {
          okExitCodes: target._tag === "Untracked" ? [1] : [],
        })
        if (bytes.length > MAX_PATCH_BYTES) return { _tag: "TooLarge", bytes: bytes.length } satisfies FileDiff
        const text = decoder.decode(bytes)
        const files = text.match(/^diff --git /gm)?.length ?? 0
        if (files === 0) return { _tag: "Empty" } satisfies FileDiff
        if (files === 1 && /^Binary files .* differ$/m.test(text)) return { _tag: "Binary" } satisfies FileDiff
        return { _tag: "Patch", patch: text } satisfies FileDiff
      })

      const withPaths = (repo: RepoId, args: ReadonlyArray<string>, paths: ReadonlyArray<string>) =>
        paths.length === 0
          ? Effect.void
          : Effect.asVoid(
              git.run(repo, [...args, "--pathspec-from-file=-", "--pathspec-file-nul"], { stdin: nulList(paths) }),
            )

      const stage = (repo: RepoId, paths: ReadonlyArray<RepoPath>) => withPaths(repo, ["add", "-A"], paths)

      const unstage = Effect.fn("Repo.unstage")(function* (repo: RepoId, paths: ReadonlyArray<RepoPath>) {
        if (yield* hasHead(repo)) return yield* withPaths(repo, ["restore", "--staged"], paths)
        return yield* withPaths(repo, ["rm", "--cached", "-r", "-q"], paths)
      })

      const chunked = (repo: RepoId, args: ReadonlyArray<string>, paths: ReadonlyArray<string>) =>
        Effect.forEach(chunks(paths, 500), (chunk) => git.run(repo, [...args, "--", ...chunk]))

      const discard = Effect.fn("Repo.discard")(function* (repo: RepoId, paths: ReadonlyArray<RepoPath>) {
        const listed = yield* chunked(repo, ["ls-files", "-z"], paths)
        const tracked = new Set(listed.flatMap((bytes) => decoder.decode(bytes).split("\0")))
        yield* withPaths(
          repo,
          ["restore", "--worktree"],
          paths.filter((path) => tracked.has(path)),
        )
        yield* chunked(
          repo,
          ["clean", "-f", "-q"],
          paths.filter((path) => !tracked.has(path)),
        )
      })

      const run = (repo: RepoId, args: ReadonlyArray<string>, stdin?: Uint8Array) =>
        Effect.asVoid(git.run(repo, args, stdin === undefined ? {} : { stdin }))

      const stashIndex = Effect.fn("Repo.stashIndex")(function* (repo: RepoId, oid: Oid) {
        const index = parseStashes(yield* git.run(repo, stashArgs)).findIndex((stash) => stash.oid === oid)
        if (index === -1)
          return yield* new GitError({ args: ["stash", "drop"], exitCode: -1, stderr: `Stash ${oid} no longer exists` })
        return `stash@{${index}}`
      })

      const removeWorktree = (repo: RepoId, path: string, force: boolean) =>
        run(repo, ["worktree", "remove", ...(force ? ["--force", "--force"] : []), path])

      return Repo.of({
        open,
        status,
        refs,
        openLog,
        logPage,
        commit,
        diff,
        stage,
        unstage,
        discard,
        commitIndex: (repo, message, amend) =>
          run(
            repo,
            ["commit", "--cleanup=strip", "-F", "-", ...(amend ? ["--amend"] : [])],
            new TextEncoder().encode(message),
          ),
        checkout: (repo, branch) => run(repo, ["switch", branch]),
        createBranch: (repo, name, startPoint, checkout) =>
          run(repo, checkout ? ["switch", "-c", name, startPoint] : ["branch", name, startPoint]),
        deleteBranch: Effect.fn("Repo.deleteBranch")(function* (repo, name, force, alsoRemoveWorktree) {
          if (alsoRemoveWorktree) {
            const worktrees = parseWorktrees(yield* git.run(repo, worktreeArgs))
            for (const worktree of worktrees) {
              if (worktree.isMain || worktree.head._tag !== "Branch" || worktree.head.name !== name) continue
              yield* removeWorktree(repo, worktree.path, force)
            }
          }
          yield* run(repo, ["branch", force ? "-D" : "-d", name])
        }),
        removeWorktree,
        pruneWorktrees: (repo) => run(repo, ["worktree", "prune"]),
        fetch: (repo) => run(repo, ["fetch", "--all", "--prune"]),
        pull: (repo) => run(repo, ["pull"]),
        push: (repo) => run(repo, ["push"]),
        stashApply: Effect.fn("Repo.stashApply")(function* (repo, oid, drop) {
          const ref = yield* stashIndex(repo, oid)
          yield* run(repo, ["stash", drop ? "pop" : "apply", ref])
        }),
        stashDrop: Effect.fn("Repo.stashDrop")(function* (repo, oid) {
          yield* run(repo, ["stash", "drop", yield* stashIndex(repo, oid)])
        }),
      })
    }),
  ).pipe(Layer.provide(Git.layer))
}
