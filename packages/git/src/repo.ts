import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, lstatSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import {
  type CommitDetail,
  type CommitIdentity,
  type IdentitySettings,
  type CommitUpdate,
  type CredentialPrompt,
  type CommitRow,
  type Comparison,
  type ComparisonDetail,
  type ConflictDetail,
  type DiffTarget,
  type FileDiff,
  type LineAction,
  type LineSelection,
  type LogHandle,
  type Oid,
  type Operation,
  type Progress,
  type Refs,
  type RefVisibility,
  type RepoId,
  type RepoInfo,
  type RepoPath,
  type Status,
  type Worktree,
  allRefsVisible,
  DirectoryNotFound,
  GitError,
  LogExpired,
  RepoNotFound,
} from "@gitui/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Latch from "effect/Latch"
import * as Layer from "effect/Layer"
import type { PlatformError } from "effect/PlatformError"
import * as Pull from "effect/Pull"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import { diffTreeArgs, parseCommit, parseFileChanges, showArgs } from "./commit.ts"
import { makeComparison, resolveRevision } from "./comparison.ts"
import { makeConflicts } from "./conflict.ts"
import { makeIdentity } from "./identity.ts"
import { Git, nulList } from "./git.ts"
import {
  hasGraph,
  logArgs,
  logRevArgs,
  parseLogQuery,
  parseStashParents,
  shaCandidate,
  stashParentsArgs,
} from "./log.ts"
import { LogStore } from "./log-store.ts"
import {
  forEachRefArgs,
  parseRefRows,
  parseRefs,
  parseRemotes,
  parseStashes,
  parseTracks,
  parseWorktrees,
  remotesArgs,
  stashArgs,
  trackArgs,
  trackingPairs,
  worktreeArgs,
} from "./refs.ts"
import { parseFilePatch, selectLines } from "./patch.ts"
import { parseStatus, statusArgs } from "./status.ts"
import { makePublishing } from "./publishing.ts"
import { makeRecovery } from "./recovery.ts"
import { makeRewrite } from "./rewrite.ts"

const chunks = <T>(items: ReadonlyArray<T>, size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

// A separate process finishes the delete even if the server exits first, and keeps the unlinks off
// libuv's threadpool, which every git spawn needs for its fs.access of the working directory.
// In the desktop app process.execPath is Electron, and the backend unsets ELECTRON_RUN_AS_NODE, so
// without it here Electron opens the script as an app and shows an "Error launching app" dialog.
const deleteInBackground = (path: string) =>
  spawn(
    process.execPath,
    ["-e", `require("node:fs").rmSync(process.argv[1], { recursive: true, force: true })`, path],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  )
    .on("error", () => {})
    .unref()

const MAX_UNTRACKED_DIFFS = 50
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

const MAX_LOG_SESSIONS = 4

export const DRAFT_FILE = "GITUI_MSG"

const LOG_PROGRESS_INTERVAL = "100 millis"

type LogStatus =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Done" }
  | { readonly _tag: "Failed"; readonly error: GitError }
  | { readonly _tag: "Closed" }

interface LogSession {
  readonly store: LogStore
  readonly scope: Scope.Closeable
  readonly wanted: Latch.Latch
  readers: number
  status: LogStatus
  progressed: Deferred.Deferred<void>
}

const want = (session: LogSession) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      if (session.readers++ === 0) Latch.openUnsafe(session.wanted)
    }),
    () =>
      Effect.sync(() => {
        if (--session.readers === 0) Latch.closeUnsafe(session.wanted)
      }),
  )

const wake = (session: LogSession) => {
  const progressed = session.progressed
  session.progressed = Deferred.makeUnsafe()
  Deferred.doneUnsafe(progressed, Exit.void)
}

const load = (session: LogSession, pull: Pull.Pull<ReadonlyArray<Uint8Array>, GitError>) =>
  Effect.whileLoop({
    while: () => session.status._tag === "Loading",
    body: () =>
      Effect.andThen(session.wanted.await, pull).pipe(
        Effect.map((chunks) => {
          for (const chunk of chunks) session.store.push(chunk)
        }),
        Pull.catchDone(() =>
          Effect.sync(() => {
            session.store.flush()
            session.status = { _tag: "Done" }
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            session.status = { _tag: "Failed", error }
          }),
        ),
        Effect.ensuring(Effect.sync(() => wake(session))),
      ),
    step: () => {},
  })

const waitFor = (session: LogSession, end: number): Effect.Effect<void, GitError | LogExpired> =>
  Effect.suspend(() => {
    switch (session.status._tag) {
      case "Closed":
        return Effect.fail(new LogExpired())
      case "Failed":
        return Effect.fail(session.status.error)
      case "Done":
        return Effect.void
      case "Loading":
        return session.store.length >= end
          ? Effect.void
          : Effect.andThen(Deferred.await(session.progressed), waitFor(session, end))
    }
  })

const find = (session: LogSession, oid: Oid, from: number): Effect.Effect<number | null, GitError | LogExpired> =>
  Effect.suspend(() => {
    const end = session.store.length
    const index = session.store.indexOf(oid, from)
    if (index !== -1) return Effect.succeed(index)
    switch (session.status._tag) {
      case "Closed":
        return Effect.fail(new LogExpired())
      case "Failed":
        return Effect.fail(session.status.error)
      case "Done":
        return Effect.succeed(null)
      case "Loading":
        return Effect.andThen(Deferred.await(session.progressed), find(session, oid, end))
    }
  })

type RepoCommands = ReturnType<typeof makePublishing> & ReturnType<typeof makeRecovery>

export class Repo extends Context.Service<
  Repo,
  RepoCommands & {
    readonly rewritePlan: ReturnType<typeof makeRewrite>["plan"]
    readonly startRewrite: ReturnType<typeof makeRewrite>["start"]
    readonly rebaseState: ReturnType<typeof makeRewrite>["state"]
    readonly splitRebaseCommit: ReturnType<typeof makeRewrite>["split"]
    readonly open: (path: string) => Effect.Effect<RepoInfo, RepoNotFound | DirectoryNotFound>
    readonly status: (repo: RepoId) => Effect.Effect<Status, GitError>
    readonly refs: (repo: RepoId) => Effect.Effect<Refs, GitError>
    readonly openLog: (
      repo: RepoId,
      query: string,
      refs?: RefVisibility,
    ) => Stream.Stream<LogHandle, GitError | LogExpired>
    readonly logPage: (
      repo: RepoId,
      logId: string,
      start: number,
      count: number,
    ) => Effect.Effect<ReadonlyArray<CommitRow>, GitError | LogExpired>
    readonly logIndex: (repo: RepoId, logId: string, oid: Oid) => Effect.Effect<number | null, GitError | LogExpired>
    readonly commit: (repo: RepoId, oid: Oid) => Effect.Effect<CommitDetail, GitError>
    readonly comparison: (repo: RepoId, comparison: Comparison) => Effect.Effect<ComparisonDetail, GitError>
    readonly diff: (
      repo: RepoId,
      target: DiffTarget,
      paths: ReadonlyArray<RepoPath>,
      ignoreWhitespace?: boolean,
      allowLarge?: boolean,
    ) => Effect.Effect<FileDiff, GitError>
    readonly stage: (repo: RepoId, paths: ReadonlyArray<RepoPath>) => Effect.Effect<void, GitError>
    readonly unstage: (repo: RepoId, paths: ReadonlyArray<RepoPath>) => Effect.Effect<void, GitError>
    readonly discard: (repo: RepoId, paths: ReadonlyArray<RepoPath>) => Effect.Effect<void, GitError>
    readonly applyLines: (
      repo: RepoId,
      action: LineAction,
      path: RepoPath,
      lines: ReadonlyArray<LineSelection>,
    ) => Effect.Effect<void, GitError>
    readonly readDraft: (repo: RepoId) => Effect.Effect<string, GitError>
    readonly writeDraft: (repo: RepoId, message: string) => Effect.Effect<void, GitError>
    readonly commitIndex: (repo: RepoId, message: string, amend: boolean) => Effect.Effect<void, GitError>
    readonly commitStream: (repo: RepoId, message: string, amend: boolean) => Stream.Stream<CommitUpdate, GitError>
    readonly identity: (repo: RepoId) => Effect.Effect<CommitIdentity, GitError>
    readonly setIdentity: (repo: RepoId, settings: IdentitySettings) => Effect.Effect<void, GitError>
    readonly credentialPrompts: (repo: RepoId) => Stream.Stream<ReadonlyArray<CredentialPrompt>>
    readonly answerCredential: (repo: RepoId, id: string, answer: string | null) => boolean
    readonly continueOperation: (repo: RepoId) => Effect.Effect<void, GitError>
    readonly skipOperation: (repo: RepoId) => Effect.Effect<void, GitError>
    readonly abortOperation: (repo: RepoId) => Effect.Effect<void, GitError>
    readonly resolveConflict: (
      repo: RepoId,
      paths: ReadonlyArray<RepoPath>,
      side: "ours" | "theirs",
    ) => Effect.Effect<void, GitError>
    readonly conflict: (repo: RepoId, path: RepoPath) => Effect.Effect<ConflictDetail, GitError>
    readonly saveConflictResult: (
      repo: RepoId,
      path: RepoPath,
      content: string,
      expectedVersion: string,
      stage: boolean,
    ) => Effect.Effect<string, GitError>
    readonly runMergeTool: (repo: RepoId, path: RepoPath) => Effect.Effect<void, GitError>
    readonly checkout: (repo: RepoId, branch: string) => Effect.Effect<void, GitError>
    readonly createBranch: (
      repo: RepoId,
      name: string,
      startPoint: Oid,
      checkout: boolean,
    ) => Effect.Effect<void, GitError>
    readonly deleteBranch: (
      repo: RepoId,
      name: string,
      force: boolean,
      removeWorktree: boolean,
    ) => Effect.Effect<void, GitError>
    readonly removeWorktree: (
      repo: RepoId,
      path: string,
      force: boolean,
      deleteBranch: boolean,
    ) => Effect.Effect<void, GitError>
    readonly pruneWorktrees: (repo: RepoId) => Effect.Effect<void, GitError>
    readonly fetch: (repo: RepoId) => Stream.Stream<Progress, GitError>
    readonly renameBranch: (repo: RepoId, from: string, to: string) => Effect.Effect<void, GitError>
    readonly merge: (repo: RepoId, ref: string) => Effect.Effect<void, GitError>
    readonly rebase: (repo: RepoId, onto: string) => Effect.Effect<void, GitError>
    readonly cherryPick: (repo: RepoId, oid: Oid) => Effect.Effect<void, GitError>
    readonly revert: (repo: RepoId, oid: Oid) => Effect.Effect<void, GitError>
    readonly reset: (repo: RepoId, oid: Oid, mode: "soft" | "mixed" | "hard") => Effect.Effect<void, GitError>
    readonly checkoutDetached: (repo: RepoId, oid: Oid) => Effect.Effect<void, GitError>
    readonly createTag: (repo: RepoId, name: string, oid: Oid, message: string) => Effect.Effect<void, GitError>
    readonly deleteTag: (repo: RepoId, name: string) => Effect.Effect<void, GitError>
    readonly stashPush: (
      repo: RepoId,
      message: string,
      includeUntracked: boolean,
      paths?: ReadonlyArray<RepoPath> | null,
      keepIndex?: boolean,
    ) => Effect.Effect<void, GitError>
    readonly addWorktree: (
      repo: RepoId,
      path: string,
      branch: string,
      startPoint: Oid | null,
    ) => Effect.Effect<void, GitError>
    readonly stashApply: (repo: RepoId, oid: Oid, drop: boolean) => Effect.Effect<void, GitError>
    readonly stashDrop: (repo: RepoId, oid: Oid) => Effect.Effect<void, GitError>
  }
>()("@gitui/git/Repo") {
  static readonly layer = Layer.effect(
    Repo,
    Effect.gen(function* () {
      const git = yield* Git
      const fs = yield* FileSystem.FileSystem
      const conflicts = makeConflicts(git, fs)
      const identity = makeIdentity(git)
      const sessions = new Map<RepoId, Map<string, LogSession>>()
      const locks = new Map<RepoId, Semaphore.Semaphore>()
      const lockFor = (repo: RepoId) => {
        let lock = locks.get(repo)
        if (lock === undefined) {
          lock = Semaphore.makeUnsafe(1)
          locks.set(repo, lock)
        }
        return lock
      }
      const locked =
        <Args extends [RepoId, ...Array<unknown>], A, E>(f: (...args: Args) => Effect.Effect<A, E>) =>
        (...args: Args) =>
          lockFor(args[0]).withPermits(1)(f(...args))

      const hasHead = (repo: RepoId) =>
        git
          .text(repo, ["rev-parse", "--verify", "-q", "HEAD"], { okExitCodes: [1] })
          .pipe(Effect.map((out) => out.trim() !== ""))

      const open = Effect.fn("Repo.open")(function* (path: string) {
        if (statSync(resolve(path), { throwIfNoEntry: false })?.isDirectory() !== true)
          return yield* new DirectoryNotFound({ path })
        const out = yield* git
          .text(resolve(path), [
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--absolute-git-dir",
            "--git-common-dir",
          ])
          .pipe(Effect.mapError(() => new RepoNotFound({ path })))
        const [root = "", gitDir = "", commonDir = ""] = out.trimEnd().split("\n")
        if (root === "") return yield* new RepoNotFound({ path })
        return { id: root as RepoId, name: basename(root), gitDir, commonDir: resolve(root, commonDir) }
      })

      const gitDirOf = (repo: RepoId) =>
        git.text(repo, ["rev-parse", "--absolute-git-dir"]).pipe(Effect.map((s) => s.trim()))

      const operationOf = (gitDir: string) =>
        operationMarkers.find(([marker]) => existsSync(join(gitDir, marker)))?.[1] ?? null

      const status = Effect.fn("Repo.status")(function* (repo: RepoId) {
        const [bytes, gitDir] = yield* Effect.all([git.run(repo, statusArgs), gitDirOf(repo)], { concurrency: 2 })
        return { ...parseStatus(bytes), operation: operationOf(gitDir) }
      })

      const rewrite = makeRewrite(git, fs, status, gitDirOf)

      const operationCommand = Effect.fn("Repo.operationCommand")(function* (
        repo: RepoId,
        step: "continue" | "skip" | "abort",
      ) {
        const operation = operationOf(yield* gitDirOf(repo))
        const fail = (reason: string) => new GitError({ args: [step], exitCode: -1, stderr: reason })
        switch (operation) {
          case null:
            return yield* fail("Nothing is in progress.")
          case "merge":
            if (step === "skip") return yield* fail("A merge can't skip; continue or abort it.")
            return step === "continue" ? ["commit", "--no-edit"] : ["merge", "--abort"]
          case "bisect":
            if (step !== "abort") return yield* fail("Finish the bisect from a terminal, or abort it here.")
            return ["bisect", "reset"]
          case "rebase":
          case "cherry-pick":
          case "revert":
            return [operation, `--${step}`]
        }
      })

      const operationPosition = (gitDir: string) =>
        Effect.forEach(
          ["rebase-merge/msgnum", "rebase-apply/next", "sequencer/todo", "CHERRY_PICK_HEAD", "REVERT_HEAD"],
          (path) => fs.readFileString(join(gitDir, path)).pipe(Effect.orElseSucceed(() => null)),
        ).pipe(Effect.map(JSON.stringify))

      const stepOperation = (step: "continue" | "skip" | "abort") =>
        Effect.fn("Repo.stepOperation")(function* (repo: RepoId) {
          const gitDir = yield* gitDirOf(repo)
          const before = yield* operationPosition(gitDir)
          if (step === "continue") yield* rewrite.checkContinue(repo)
          const args = yield* operationCommand(repo, step)
          yield* Effect.asVoid(git.run(repo, args, { write: true, env: yield* rewrite.environment(repo) })).pipe(
            Effect.catchTag("GitError", (error) =>
              Effect.gen(function* () {
                if (
                  step !== "abort" &&
                  before !== (yield* operationPosition(gitDir)) &&
                  (yield* status(repo)).entries.some((entry) => entry._tag === "Conflicted")
                )
                  return
                return yield* error
              }),
            ),
          )
          yield* rewrite.cleanup(repo)
        })

      const tracks = new Map<RepoId, ReadonlyMap<string, string>>()

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
        const rows = parseRefRows(refsOut)
        const pairs = trackingPairs(rows)
        const known = tracks.get(repo) ?? new Map<string, string>()
        const missing = new Set([...pairs].flatMap(([key, refs]) => (known.has(key) ? [] : refs)))
        const fresh =
          missing.size === 0 ? new Map<string, string>() : parseTracks(yield* git.run(repo, trackArgs(missing)))
        const current = new Map<string, string>()
        for (const key of pairs.keys()) {
          const track = known.get(key) ?? fresh.get(key)
          if (track !== undefined) current.set(key, track)
        }
        tracks.set(repo, current)
        const remotes = parseRemotes(remotesOut)
        return {
          ...parseRefs(rows, remotes, current),
          remotes,
          stashes: parseStashes(stashOut),
          worktrees: parseWorktrees(worktreeOut),
        }
      })

      const closeSession = (session: LogSession) =>
        Effect.suspend(() => {
          session.status = { _tag: "Closed" }
          wake(session)
          return Scope.close(session.scope, Exit.void)
        })

      const logSession = Effect.fn("Repo.logSession")(function* (repo: RepoId, search: string, refs: RefVisibility) {
        const parsed = parseLogQuery(search)
        const head = yield* hasHead(repo)
        const sha = shaCandidate(parsed)
        const commit =
          sha === undefined
            ? ""
            : (yield* git.text(repo, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], {
                okExitCodes: [1, 128],
              })).trim()
        const query = commit === "" ? parsed : parseLogQuery("")
        const stashes = commit === "" && refs.stashes ? parseStashParents(yield* git.text(repo, stashParentsArgs)) : []
        const revs =
          commit === ""
            ? logRevArgs(
                head,
                refs,
                stashes.map((stash) => stash.oid),
              )
            : ["--no-walk", commit]
        const tips = commit || (yield* git.text(repo, ["rev-parse", ...revs], { okExitCodes: [128] }))
        const logId = createHash("sha1")
          .update(`${tips}\0${JSON.stringify(query)}`)
          .digest("hex")
          .slice(0, 16)
        const open = sessions.get(repo) ?? new Map<string, LogSession>()
        sessions.set(repo, open)
        const reuse = (session: LogSession) => {
          open.delete(logId)
          open.set(logId, session)
          return { logId, session }
        }
        const existing = open.get(logId)
        if (existing?.status._tag === "Failed") {
          open.delete(logId)
          yield* closeSession(existing)
        } else if (existing !== undefined) return reuse(existing)

        const scope = yield* Scope.make()
        const pull = yield* Stream.toPull(git.stream(repo, logArgs(revs, query))).pipe(Scope.provide(scope))
        const session: LogSession = {
          store: new LogStore(hasGraph(query), stashes),
          scope,
          wanted: Latch.makeUnsafe(false),
          readers: 0,
          status: { _tag: "Loading" },
          progressed: Deferred.makeUnsafe(),
        }
        const raced = open.get(logId)
        if (raced !== undefined) {
          yield* closeSession(session)
          return reuse(raced)
        }
        open.set(logId, session)
        yield* Effect.forkIn(load(session, pull), scope)
        for (const [id, old] of open) {
          if (open.size <= MAX_LOG_SESSIONS) break
          open.delete(id)
          yield* closeSession(old)
        }
        return { logId, session }
      })

      const openLog = (repo: RepoId, search: string, refs = allRefsVisible) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const { logId, session } = yield* logSession(repo, search, refs)
            yield* want(session)
            const handle = (): LogHandle => ({
              logId,
              loaded: session.store.length,
              done: session.status._tag === "Done",
            })
            return Stream.fromEffectSchedule(Effect.sync(handle), Schedule.spaced(LOG_PROGRESS_INTERVAL)).pipe(
              Stream.merge(Stream.fromEffect(Effect.map(waitFor(session, Infinity), handle)), {
                haltStrategy: "right",
              }),
              Stream.changesWith((a, b) => a.loaded === b.loaded && a.done === b.done),
            )
          }),
        )

      const logPage = Effect.fn("Repo.logPage")(function* (repo: RepoId, logId: string, start: number, count: number) {
        const session = sessions.get(repo)?.get(logId)
        if (session === undefined) return yield* new LogExpired()
        yield* Effect.scoped(Effect.andThen(want(session), waitFor(session, start + count)))
        return session.store.page(start, count)
      })

      const logIndex = Effect.fn("Repo.logIndex")(function* (repo: RepoId, logId: string, oid: Oid) {
        const session = sessions.get(repo)?.get(logId)
        if (session === undefined) return yield* new LogExpired()
        return yield* Effect.scoped(Effect.andThen(want(session), find(session, oid, 0)))
      })

      const commit = Effect.fn("Repo.commit")(function* (repo: RepoId, oid: Oid) {
        const show = yield* git.run(repo, showArgs(oid))
        const detail = parseCommit(show, [])
        const files = parseFileChanges(yield* git.run(repo, diffTreeArgs(oid, detail.parents[0])))
        return { ...detail, files }
      })

      const patchArgs = (
        target: DiffTarget,
        paths: ReadonlyArray<string>,
        ignoreWhitespace: boolean,
      ): ReadonlyArray<string> => {
        const common = ["--no-ext-diff", "--no-color", "-M", ...(ignoreWhitespace ? ["-w"] : [])]
        switch (target._tag) {
          case "Comparison":
            return ["diff", ...common, target.base, target.head, "--", ...paths]
          case "Commit":
            return [
              "diff-tree",
              "-p",
              "-r",
              "--no-commit-id",
              ...common,
              "--root",
              "--diff-merges=first-parent",
              target.oid,
              "--",
              ...paths,
            ]
          case "Staged":
            return ["diff", "--cached", ...common, "--", ...paths]
          case "Unstaged":
            return ["diff", ...common, "--", ...paths]
          case "Untracked":
            return ["diff", "--no-index", ...common, "--", "/dev/null", paths[0] ?? ""]
        }
      }

      const diff = Effect.fn("Repo.diff")(function* (
        repo: RepoId,
        target: DiffTarget,
        paths: ReadonlyArray<RepoPath>,
        ignoreWhitespace = false,
        allowLarge = false,
      ) {
        if (target._tag === "Comparison") {
          const [base, head] = yield* Effect.all([
            resolveRevision(git, repo, target.base, "tree"),
            resolveRevision(git, repo, target.head),
          ])
          target = { _tag: "Comparison", base, head }
        }
        const bytes =
          target._tag === "Untracked"
            ? Buffer.concat(
                yield* Effect.forEach(paths.slice(0, MAX_UNTRACKED_DIFFS), (path) =>
                  git.run(repo, patchArgs(target, [path], ignoreWhitespace), { okExitCodes: [1] }),
                ),
              )
            : yield* git.run(repo, patchArgs(target, paths, ignoreWhitespace))
        if (!allowLarge && bytes.length > MAX_PATCH_BYTES)
          return { _tag: "TooLarge", bytes: bytes.length } satisfies FileDiff
        const text = decoder.decode(bytes)
        const files = text.match(/^diff --git /gm)?.length ?? 0
        if (files === 0) return { _tag: "Empty" } satisfies FileDiff
        return { _tag: "Patch", patch: text } satisfies FileDiff
      })

      const withPaths = (repo: RepoId, args: ReadonlyArray<string>, paths: ReadonlyArray<string>) =>
        paths.length === 0
          ? Effect.void
          : Effect.asVoid(
              git.run(repo, [...args, "--pathspec-from-file=-", "--pathspec-file-nul"], {
                stdin: nulList(paths),
                write: true,
              }),
            )

      const stage = (repo: RepoId, paths: ReadonlyArray<RepoPath>) => withPaths(repo, ["add", "-A"], paths)

      const unstage = Effect.fn("Repo.unstage")(function* (repo: RepoId, paths: ReadonlyArray<RepoPath>) {
        if (yield* hasHead(repo)) return yield* withPaths(repo, ["restore", "--staged"], paths)
        return yield* withPaths(repo, ["rm", "--cached", "-r", "-q"], paths)
      })

      const chunked = (repo: RepoId, args: ReadonlyArray<string>, paths: ReadonlyArray<string>, write: boolean) =>
        Effect.forEach(chunks(paths, 500), (chunk) => git.run(repo, [...args, "--", ...chunk], { write }))

      const discard = Effect.fn("Repo.discard")(function* (repo: RepoId, paths: ReadonlyArray<RepoPath>) {
        const listed = yield* chunked(repo, ["ls-files", "-z"], paths, false)
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
          true,
        )
      })

      const applyLines = Effect.fn("Repo.applyLines")(function* (
        repo: RepoId,
        action: LineAction,
        path: RepoPath,
        lines: ReadonlyArray<LineSelection>,
      ) {
        const targetDiff = action === "unstage" ? { _tag: "Staged" as const } : { _tag: "Unstaged" as const }
        const entry =
          action === "unstage" ? (yield* status(repo)).entries.find((entry) => entry.path === path) : undefined
        const paths = entry?._tag === "Tracked" && entry.from !== null ? [entry.from, path] : [path]
        let args = patchArgs(targetDiff, paths, false)
        let text = decoder.decode(yield* git.run(repo, args))
        if (text === "" && action === "stage") {
          const untracked = yield* git.text(repo, ["ls-files", "--others", "--exclude-standard", "-z", "--", path])
          if (untracked.split("\0").includes(path)) {
            args = patchArgs({ _tag: "Untracked" }, [path], false)
            text = decoder.decode(yield* git.run(repo, args, { okExitCodes: [1] }))
          }
        }
        if ((text.match(/^diff --git /gm)?.length ?? 0) > 1)
          return yield* new GitError({
            args: ["apply"],
            exitCode: -1,
            stderr: "Use a whole-file action for file type changes.",
          })
        const selected = selectLines(parseFilePatch(text), lines, action === "stage" ? "forward" : "reverse")
        if (selected._tag !== "Patch") {
          return yield* new GitError({ args: ["apply"], exitCode: -1, stderr: selected.reason })
        }
        const target = action === "discard" ? [] : ["--cached"]
        const reverse = action === "stage" ? [] : ["--reverse"]
        yield* git.run(repo, ["apply", ...target, ...reverse, "--recount", "--whitespace=nowarn", "-"], {
          stdin: new TextEncoder().encode(selected.patch),
          write: true,
        })
      })

      const run = (repo: RepoId, args: ReadonlyArray<string>, stdin?: Uint8Array) =>
        Effect.asVoid(git.run(repo, args, stdin === undefined ? { write: true } : { stdin, write: true }))

      const stashIndex = Effect.fn("Repo.stashIndex")(function* (repo: RepoId, oid: Oid) {
        const index = parseStashes(yield* git.run(repo, stashArgs)).findIndex((stash) => stash.oid === oid)
        if (index === -1)
          return yield* new GitError({ args: ["stash", "drop"], exitCode: -1, stderr: `Stash ${oid} no longer exists` })
        return `stash@{${index}}`
      })

      const ensureMerged = Effect.fn("Repo.ensureMerged")(function* (repo: RepoId, name: string) {
        const branch = `refs/heads/${name}`
        const upstream = (yield* git.text(repo, ["rev-parse", "--verify", "-q", `${branch}@{upstream}`], {
          okExitCodes: [1, 128],
        })).trim()
        const target = upstream === "" ? "HEAD" : upstream
        const unmerged = Number((yield* git.text(repo, ["rev-list", "--count", `${target}..${branch}`])).trim())
        if (unmerged > 0) {
          return yield* new GitError({
            args: ["branch", "-d", name],
            exitCode: 1,
            stderr: `${name} has ${unmerged} ${unmerged === 1 ? "commit" : "commits"} that ${upstream === "" ? "HEAD" : upstream} doesn't contain. Nothing was deleted.`,
          })
        }
      })

      const draftPath = (repo: RepoId) => Effect.map(gitDirOf(repo), (dir) => join(dir, DRAFT_FILE))
      const draftError = (action: string, error: PlatformError) =>
        new GitError({ args: [], exitCode: -1, stderr: `Couldn't ${action} the commit draft: ${error.message}` })

      const worktreesOf = (repo: RepoId) => Effect.map(git.run(repo, worktreeArgs), parseWorktrees)

      const removeWorktreeArgs = (path: string, force: boolean) => [
        "worktree",
        "remove",
        ...(force ? ["--force", "--force"] : []),
        path,
      ]

      // `git worktree remove` skips its clean and submodule checks when the directory is already gone,
      // so they run here, before the directory moves.
      const cleanForRemoval = Effect.fn("Repo.cleanForRemoval")(function* (worktree: Worktree) {
        const [status, index, gitDir] = yield* Effect.all(
          [
            git.text(worktree.path, ["status", "--porcelain", "--ignore-submodules=none"]),
            git.text(worktree.path, ["ls-files", "--stage", "-z"]),
            git.text(worktree.path, ["rev-parse", "--absolute-git-dir"]),
          ],
          { concurrency: 3 },
        )
        const populatedSubmodule = index
          .split("\0")
          .some(
            (entry) =>
              entry.startsWith("160000 ") &&
              existsSync(join(worktree.path, entry.slice(entry.indexOf("\t") + 1), ".git")),
          )
        return status === "" && !populatedSubmodule && !existsSync(join(gitDir.trim(), "modules"))
      })

      const removeListedWorktree = Effect.fn("Repo.removeListedWorktree")(function* (
        repo: RepoId,
        worktree: Worktree,
        force: boolean,
      ) {
        const remove = run(repo, removeWorktreeArgs(worktree.path, force))
        const movable =
          !worktree.isMain &&
          worktree.prunable === null &&
          (force || (worktree.locked === null && (yield* cleanForRemoval(worktree))))
        if (!movable) return yield* remove
        const trash = join(
          dirname(worktree.path),
          `.${basename(worktree.path)}.removing-${randomBytes(4).toString("hex")}`,
        )
        const moved = yield* fs.rename(worktree.path, trash).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        )
        if (!moved) return yield* remove
        yield* remove.pipe(Effect.tapError(() => Effect.ignore(fs.rename(trash, worktree.path))))
        yield* Effect.sync(() => deleteInBackground(trash))
      })

      const removeWorktree = Effect.fn("Repo.removeWorktree")(function* (
        repo: RepoId,
        path: string,
        force: boolean,
        deleteBranch: boolean,
      ) {
        const worktree = (yield* worktreesOf(repo)).find((candidate) => candidate.path === path)
        if (worktree === undefined) return yield* run(repo, removeWorktreeArgs(path, force))
        const branch = deleteBranch && worktree.head._tag === "Branch" ? worktree.head.name : null
        if (branch !== null && !force) yield* ensureMerged(repo, branch)
        yield* removeListedWorktree(repo, worktree, force)
        if (branch !== null) yield* run(repo, ["branch", force ? "-D" : "-d", branch])
      })

      const service: Repo["Service"] = {
        ...makePublishing(git),
        ...makeRecovery(git, status),
        open,
        status,
        refs,
        openLog,
        logPage,
        logIndex,
        commit,
        comparison: makeComparison(git),
        diff,
        stage,
        unstage,
        discard,
        applyLines,
        readDraft: Effect.fn("Repo.readDraft")(function* (repo) {
          const path = yield* draftPath(repo)
          return yield* fs
            .readFileString(path)
            .pipe(
              Effect.catch((error) =>
                error.reason._tag === "NotFound" ? Effect.succeed("") : Effect.fail(draftError("read", error)),
              ),
            )
        }),
        writeDraft: Effect.fn("Repo.writeDraft")(function* (repo, message) {
          const path = yield* draftPath(repo)
          yield* (message === "" ? fs.remove(path, { force: true }) : fs.writeFileString(path, message)).pipe(
            Effect.mapError((error) => draftError("write", error)),
          )
        }),
        identity: identity.read,
        setIdentity: identity.write,
        credentialPrompts: (repo) => git.prompts(repo),
        answerCredential: (repo, id, answer) => git.answerPrompt(repo, id, answer),
        commitStream: (repo, message, amend) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* rewrite.checkCommit(repo, amend)
              const output = git
                .output(repo, ["commit", "--cleanup=strip", "-F", "-", ...(amend ? ["--amend"] : [])], {
                  stdin: new TextEncoder().encode(message),
                  write: true,
                })
                .pipe(Stream.map((text): CommitUpdate => ({ _tag: "Output", text })))
              const completed = Effect.gen(function* () {
                const oid = (yield* git.text(repo, ["rev-parse", "HEAD"])).trim() as Oid
                if (!amend) yield* fs.remove(yield* draftPath(repo), { force: true }).pipe(Effect.ignore)
                return { _tag: "Committed", oid } as const
              })
              return output.pipe(Stream.concat(Stream.fromEffect(completed)))
            }),
          ),
        commitIndex: (repo, message, amend) => Stream.runDrain(service.commitStream(repo, message, amend)),
        continueOperation: stepOperation("continue"),
        skipOperation: stepOperation("skip"),
        abortOperation: stepOperation("abort"),
        conflict: conflicts.detail,
        saveConflictResult: conflicts.save,
        resolveConflict: conflicts.resolve,
        runMergeTool: conflicts.runTool,
        checkout: (repo, branch) => run(repo, ["switch", branch]),
        createBranch: (repo, name, startPoint, checkout) =>
          run(repo, checkout ? ["switch", "-c", name, startPoint] : ["branch", name, startPoint]),
        deleteBranch: Effect.fn("Repo.deleteBranch")(function* (repo, name, force, alsoRemoveWorktree) {
          if (!force) yield* ensureMerged(repo, name)
          if (alsoRemoveWorktree) {
            for (const worktree of yield* worktreesOf(repo)) {
              if (worktree.isMain || worktree.head._tag !== "Branch" || worktree.head.name !== name) continue
              yield* removeListedWorktree(repo, worktree, true)
            }
          }
          yield* run(repo, ["branch", force ? "-D" : "-d", name])
        }),
        removeWorktree,
        pruneWorktrees: (repo) => run(repo, ["worktree", "prune"]),
        fetch: (repo) =>
          existsSync(join(repo, ".git"))
            ? git.progress(repo, ["fetch", "--all", "--prune", "--progress"])
            : Stream.fail(new GitError({ args: ["fetch"], exitCode: -1, stderr: `${repo} is no longer a repository` })),
        renameBranch: (repo, from, to) => run(repo, ["branch", "-m", from, to]),
        merge: (repo, ref) => run(repo, ["merge", "--no-edit", ref]),
        rebase: (repo, onto) => run(repo, ["rebase", onto]),
        rewritePlan: rewrite.plan,
        startRewrite: rewrite.start,
        rebaseState: rewrite.state,
        splitRebaseCommit: rewrite.split,
        cherryPick: (repo, oid) => run(repo, ["cherry-pick", oid]),
        revert: (repo, oid) => run(repo, ["revert", "--no-edit", oid]),
        reset: (repo, oid, mode) => run(repo, ["reset", `--${mode}`, oid]),
        checkoutDetached: (repo, oid) => run(repo, ["switch", "--detach", oid]),
        createTag: (repo, name, oid, message) =>
          message.trim() === ""
            ? run(repo, ["tag", name, oid])
            : run(repo, ["tag", "-a", name, "-F", "-", oid], new TextEncoder().encode(message)),
        deleteTag: (repo, name) => run(repo, ["tag", "-d", name]),
        stashPush: Effect.fn("Repo.stashPush")(function* (
          repo,
          message,
          includeUntracked,
          paths = null,
          keepIndex = false,
        ) {
          if (paths !== null && paths.length === 0)
            return yield* new GitError({
              args: ["stash", "push"],
              exitCode: -1,
              stderr: "Select at least one file to stash.",
            })
          if (paths === null && !keepIndex) {
            yield* git.run(
              repo,
              [
                "stash",
                "push",
                ...(includeUntracked ? ["--include-untracked"] : []),
                ...(message === "" ? [] : ["-m", message]),
              ],
              { write: true, patternPathspecs: true },
            )
            return
          }
          const current = yield* status(repo)
          const selectedPaths = [
            ...new Set(
              paths ??
                current.entries.flatMap((entry) =>
                  entry._tag === "Tracked" && entry.from !== null ? [entry.from, entry.path] : [entry.path],
                ),
            ),
          ]
          if (selectedPaths.length === 0) return
          if (current.operation !== null || current.entries.some((entry) => entry._tag === "Conflicted"))
            return yield* new GitError({
              args: ["stash"],
              exitCode: -1,
              stderr: "Finish the current Git operation before stashing selected files.",
            })
          yield* Effect.scoped(
            Effect.gen(function* () {
              const temp = yield* fs.makeTempDirectoryScoped({ prefix: "gitui-stash-" })
              const env = { GIT_INDEX_FILE: join(temp, "index") }
              const temporary = (args: ReadonlyArray<string>, stdin?: Uint8Array) =>
                git.text(repo, args, { env, ...(stdin === undefined ? {} : { stdin }), write: true })
              const head = (yield* git.text(repo, ["rev-parse", "--verify", "HEAD"])).trim()
              const headTree = (yield* git.text(repo, ["rev-parse", `${head}^{tree}`])).trim()
              const previous = (yield* git.text(repo, ["rev-parse", "--verify", "-q", "refs/stash"], {
                okExitCodes: [1],
              })).trim()
              const entries = yield* git.run(repo, ["ls-files", "--stage", "-z", "--", ...selectedPaths])
              const indexPaths = decoder
                .decode(entries)
                .split("\0")
                .filter(Boolean)
                .map((entry) => entry.slice(entry.indexOf("\t") + 1))
              const headPaths = (yield* git.text(repo, [
                "ls-tree",
                "-r",
                "--name-only",
                "-z",
                head,
                "--",
                ...selectedPaths,
              ]))
                .split("\0")
                .filter(Boolean)
              const untracked = (yield* git.text(repo, [
                "ls-files",
                "--others",
                "--exclude-standard",
                "-z",
                "--",
                ...selectedPaths,
              ]))
                .split("\0")
                .filter(Boolean)
              if (includeUntracked && untracked.some((path) => path.endsWith("/")))
                return yield* new GitError({
                  args: ["stash"],
                  exitCode: -1,
                  stderr: "Nested repositories must be stashed separately.",
                })
              const restoring = keepIndex ? indexPaths : [...new Set([...headPaths, ...indexPaths])]
              const inspect = <A>(read: () => A) =>
                Effect.try({
                  try: read,
                  catch: (cause) =>
                    new GitError({
                      args: ["stash"],
                      exitCode: -1,
                      stderr: `Couldn't inspect files before stashing: ${String(cause)}`,
                    }),
                })
              const overlaps = (path: string) =>
                restoring.some((target) => {
                  const from = path.split("/")
                  const to = target.split("/")
                  const depth = Math.min(from.length, to.length)
                  const left = from.slice(0, depth).join("/")
                  const right = to.slice(0, depth).join("/")
                  if (left === right) return true
                  try {
                    const a = lstatSync(join(repo, left), { throwIfNoEntry: false })
                    const b = lstatSync(join(repo, right), { throwIfNoEntry: false })
                    return a !== undefined && b !== undefined && a.dev === b.dev && a.ino === b.ino
                  } catch (cause) {
                    if (cause instanceof Error && "code" in cause && cause.code === "ENOTDIR") return false
                    throw cause
                  }
                })
              const captured = new Set(indexPaths)
              const indexed = (yield* git.text(repo, ["ls-files", "--cached", "-z"])).split("\0").filter(Boolean)
              if (yield* inspect(() => indexed.some((path) => !captured.has(path) && overlaps(path))))
                return yield* new GitError({
                  args: ["stash"],
                  exitCode: -1,
                  stderr:
                    "Stashing would overwrite unselected tracked files. Select all affected files before stashing.",
                })
              const otherRoots = (yield* git.text(repo, ["ls-files", "--others", "--directory", "-z"]))
                .split("\0")
                .filter(Boolean)
                .map((path) => path.replace(/\/$/, ""))
              const untrackedRoots = yield* inspect(() => otherRoots.filter(overlaps))
              const obstructions = [...new Set([...restoring, ...untrackedRoots])]
              if (obstructions.length > 0) {
                const saved = new Set(includeUntracked ? untracked : [])
                const unsaved = (yield* git.text(repo, ["ls-files", "--others", "-z", "--", ...obstructions]))
                  .split("\0")
                  .filter(Boolean)
                if (yield* inspect(() => unsaved.some((path) => !saved.has(path) && overlaps(path.replace(/\/$/, "")))))
                  return yield* new GitError({
                    args: ["stash"],
                    exitCode: -1,
                    stderr:
                      "Untracked or ignored files would be overwritten. Move them aside or include the untracked files in the stash.",
                  })
              }
              yield* temporary(["read-tree", head])
              yield* temporary(["update-index", "--force-remove", "-z", "--stdin"], nulList(selectedPaths))
              if (entries.length > 0) yield* temporary(["update-index", "-z", "--index-info"], entries)
              const indexTree = (yield* temporary(["write-tree"])).trim()
              if (indexPaths.length > 0)
                yield* temporary(["add", "-u", "--pathspec-from-file=-", "--pathspec-file-nul"], nulList(indexPaths))
              const workTree = (yield* temporary(["write-tree"])).trim()
              let untrackedCommit: string | null = null
              if (includeUntracked && untracked.length > 0) {
                yield* temporary(["read-tree", "--empty"])
                yield* temporary(["add", "--pathspec-from-file=-", "--pathspec-file-nul"], nulList(untracked))
                const tree = (yield* temporary(["write-tree"])).trim()
                untrackedCommit = (yield* git.text(repo, ["commit-tree", tree, "-m", "untracked files"], {
                  write: true,
                })).trim()
              }
              if (workTree === headTree && indexTree === headTree && untrackedCommit === null) return
              const indexCommit = (yield* git.text(
                repo,
                ["commit-tree", indexTree, "-p", head, "-m", "index on selected files"],
                { write: true },
              )).trim()
              const branch = current.head._tag === "Branch" ? current.head.name : "(no branch)"
              const subject = `On ${branch}: ${message.trim() === "" ? "selected files" : message}`
              const stash = (yield* git.text(
                repo,
                [
                  "commit-tree",
                  workTree,
                  "-p",
                  head,
                  "-p",
                  indexCommit,
                  ...(untrackedCommit === null ? [] : ["-p", untrackedCommit]),
                  "-m",
                  subject,
                ],
                { write: true },
              )).trim()
              yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  yield* git.run(
                    repo,
                    ["update-ref", "--create-reflog", "-m", subject, "refs/stash", stash, previous],
                    { write: true },
                  )
                  if (keepIndex) {
                    if (indexPaths.length > 0) yield* withPaths(repo, ["restore", "--worktree"], indexPaths)
                  } else {
                    yield* withPaths(repo, ["restore", "--source", head, "--staged", "--worktree"], restoring)
                  }
                  if (includeUntracked && untracked.length > 0)
                    yield* chunked(
                      repo,
                      ["clean", "-f", "-q"],
                      untracked.filter((path) => keepIndex || !headPaths.includes(path)),
                      true,
                    )
                }),
              )
            }),
          ).pipe(
            Effect.catchTag("PlatformError", (error) =>
              Effect.fail(new GitError({ args: ["stash"], exitCode: -1, stderr: error.message })),
            ),
          )
        }),
        addWorktree: Effect.fn("Repo.addWorktree")(function* (repo, path, branch, startPoint) {
          const exists = (yield* git.text(repo, ["branch", "--list", branch])).trim() !== ""
          yield* run(
            repo,
            exists
              ? ["worktree", "add", path, branch]
              : ["worktree", "add", "-b", branch, path, ...(startPoint === null ? [] : [startPoint])],
          )
        }),
        stashApply: Effect.fn("Repo.stashApply")(function* (repo, oid, drop) {
          const ref = yield* stashIndex(repo, oid)
          yield* run(repo, ["stash", drop ? "pop" : "apply", ref])
        }),
        stashDrop: Effect.fn("Repo.stashDrop")(function* (repo, oid) {
          yield* run(repo, ["stash", "drop", yield* stashIndex(repo, oid)])
        }),
      }
      return Repo.of({
        ...service,
        recoverCommit: locked(service.recoverCommit),
        undoCommit: locked(service.undoCommit),
        stage: locked(service.stage),
        unstage: locked(service.unstage),
        discard: locked(service.discard),
        applyLines: locked(service.applyLines),
        commitIndex: locked(service.commitIndex),
        setIdentity: locked(service.setIdentity),
        commitStream: (repo, message, amend) =>
          Stream.unwrap(
            Effect.as(
              Effect.acquireRelease(lockFor(repo).take(1), () => lockFor(repo).release(1)),
              service.commitStream(repo, message, amend),
            ),
          ),
        continueOperation: locked(service.continueOperation),
        skipOperation: locked(service.skipOperation),
        abortOperation: locked(service.abortOperation),
        resolveConflict: locked(service.resolveConflict),
        saveConflictResult: locked(service.saveConflictResult),
        runMergeTool: locked(service.runMergeTool),
        checkout: locked(service.checkout),
        createBranch: locked(service.createBranch),
        deleteBranch: locked(service.deleteBranch),
        removeWorktree: locked(service.removeWorktree),
        pruneWorktrees: locked(service.pruneWorktrees),
        renameBranch: locked(service.renameBranch),
        merge: locked(service.merge),
        rebase: locked(service.rebase),
        startRewrite: locked(service.startRewrite),
        splitRebaseCommit: locked(service.splitRebaseCommit),
        cherryPick: locked(service.cherryPick),
        revert: locked(service.revert),
        reset: locked(service.reset),
        checkoutDetached: locked(service.checkoutDetached),
        createTag: locked(service.createTag),
        deleteTag: locked(service.deleteTag),
        deleteRemoteTrackingBranch: locked(service.deleteRemoteTrackingBranch),
        addRemote: locked(service.addRemote),
        editRemote: locked(service.editRemote),
        removeRemote: locked(service.removeRemote),
        setUpstream: locked(service.setUpstream),
        pull: (repo, strategy, target) =>
          Stream.unwrap(
            Effect.as(
              Effect.acquireRelease(lockFor(repo).take(1), () => lockFor(repo).release(1)),
              service.pull(repo, strategy, target),
            ),
          ),
        stashPush: locked(service.stashPush),
        addWorktree: locked(service.addWorktree),
        stashApply: locked(service.stashApply),
        stashDrop: locked(service.stashDrop),
      })
    }),
  ).pipe(Layer.provide(Git.layer))
}
