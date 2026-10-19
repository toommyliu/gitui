import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import {
  type CommitDetail,
  type CommitRow,
  type DiffTarget,
  type FileDiff,
  type LineAction,
  type LineSelection,
  type LogHandle,
  type Oid,
  type Operation,
  type Progress,
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
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import type { PlatformError } from "effect/PlatformError"
import * as Pull from "effect/Pull"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import { diffTreeArgs, parseCommit, parseFileChanges, showArgs } from "./commit.ts"
import { Git, nulList } from "./git.ts"
import { filterArgs, hasGraph, logArgs, logRevArgs, parseLogQuery, shaCandidate } from "./log.ts"
import { LogStore } from "./log-store.ts"
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
import { parseFilePatch, selectLines } from "./patch.ts"
import { parseStatus, statusArgs } from "./status.ts"

const chunks = <T>(items: ReadonlyArray<T>, size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

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

interface LogSession {
  readonly total: number
  readonly store: LogStore
  readonly pull: Pull.Pull<ReadonlyArray<Uint8Array>, GitError>
  readonly scope: Scope.Closeable
  readonly lock: Semaphore.Semaphore
  done: boolean
}

export class Repo extends Context.Service<
  Repo,
  {
    readonly open: (path: string) => Effect.Effect<RepoInfo, RepoNotFound>
    readonly status: (repo: RepoId) => Effect.Effect<Status, GitError>
    readonly refs: (repo: RepoId) => Effect.Effect<Refs, GitError>
    readonly openLog: (repo: RepoId, query: string) => Effect.Effect<LogHandle, GitError>
    readonly logPage: (
      repo: RepoId,
      logId: string,
      start: number,
      count: number,
    ) => Effect.Effect<ReadonlyArray<CommitRow>, GitError | LogExpired>
    readonly commit: (repo: RepoId, oid: Oid) => Effect.Effect<CommitDetail, GitError>
    readonly diff: (
      repo: RepoId,
      target: DiffTarget,
      paths: ReadonlyArray<RepoPath>,
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
    readonly continueOperation: (repo: RepoId) => Effect.Effect<void, GitError>
    readonly skipOperation: (repo: RepoId) => Effect.Effect<void, GitError>
    readonly abortOperation: (repo: RepoId) => Effect.Effect<void, GitError>
    readonly resolveConflict: (
      repo: RepoId,
      paths: ReadonlyArray<RepoPath>,
      side: "ours" | "theirs",
    ) => Effect.Effect<void, GitError>
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
    readonly removeWorktree: (repo: RepoId, path: string, force: boolean) => Effect.Effect<void, GitError>
    readonly pruneWorktrees: (repo: RepoId) => Effect.Effect<void, GitError>
    readonly fetch: (repo: RepoId) => Stream.Stream<Progress, GitError>
    readonly pull: (repo: RepoId) => Stream.Stream<Progress, GitError>
    readonly push: (repo: RepoId) => Stream.Stream<Progress, GitError>
    readonly forcePush: (repo: RepoId, expected: Oid) => Stream.Stream<Progress, GitError>
    readonly renameBranch: (repo: RepoId, from: string, to: string) => Effect.Effect<void, GitError>
    readonly merge: (repo: RepoId, ref: string) => Effect.Effect<void, GitError>
    readonly rebase: (repo: RepoId, onto: string) => Effect.Effect<void, GitError>
    readonly cherryPick: (repo: RepoId, oid: Oid) => Effect.Effect<void, GitError>
    readonly revert: (repo: RepoId, oid: Oid) => Effect.Effect<void, GitError>
    readonly reset: (repo: RepoId, oid: Oid, mode: "soft" | "mixed" | "hard") => Effect.Effect<void, GitError>
    readonly checkoutDetached: (repo: RepoId, oid: Oid) => Effect.Effect<void, GitError>
    readonly createTag: (repo: RepoId, name: string, oid: Oid, message: string) => Effect.Effect<void, GitError>
    readonly deleteTag: (repo: RepoId, name: string) => Effect.Effect<void, GitError>
    readonly stashPush: (repo: RepoId, message: string, includeUntracked: boolean) => Effect.Effect<void, GitError>
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
        const out = yield* git
          .text(resolve(path), ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"])
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

      const stepOperation = (step: "continue" | "skip" | "abort") =>
        Effect.fn("Repo.stepOperation")(function* (repo: RepoId) {
          yield* run(repo, yield* operationCommand(repo, step))
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

      const closeSession = (session: LogSession) => Scope.close(session.scope, Exit.void)

      const openLog = Effect.fn("Repo.openLog")(function* (repo: RepoId, search: string) {
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
        const revs = commit === "" ? logRevArgs(head) : ["--no-walk", commit]
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
          return { logId, total: session.total }
        }
        const existing = open.get(logId)
        if (existing !== undefined) return reuse(existing)

        const total = Number(
          (yield* git.text(repo, ["rev-list", "--count", ...filterArgs(query), ...revs, "--", ...query.paths], {
            okExitCodes: [128],
          })).trim() || 0,
        )
        const scope = yield* Scope.make()
        const pull = yield* Stream.toPull(git.stream(repo, logArgs(revs, query))).pipe(Scope.provide(scope))
        const session: LogSession = {
          total,
          store: new LogStore(hasGraph(query)),
          pull,
          scope,
          lock: Semaphore.makeUnsafe(1),
          done: total === 0,
        }
        const raced = open.get(logId)
        if (raced !== undefined) {
          yield* closeSession(session)
          return reuse(raced)
        }
        open.set(logId, session)
        for (const [id, old] of open) {
          if (open.size <= MAX_LOG_SESSIONS) break
          open.delete(id)
          yield* closeSession(old)
        }
        return { logId, total }
      })

      const logPage = Effect.fn("Repo.logPage")(function* (repo: RepoId, logId: string, start: number, count: number) {
        const session = sessions.get(repo)?.get(logId)
        if (session === undefined) return yield* new LogExpired()
        const end = start + count
        yield* session.lock.withPermits(1)(
          Effect.gen(function* () {
            while (!session.done && session.store.length < end) {
              const chunks = yield* session.pull.pipe(
                Pull.catchDone(() => {
                  session.done = true
                  return Effect.succeed([] as ReadonlyArray<Uint8Array>)
                }),
              )
              for (const chunk of chunks) session.store.push(chunk)
              if (session.done) session.store.flush()
            }
          }),
        )
        return session.store.page(start, count)
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

      const diff = Effect.fn("Repo.diff")(function* (repo: RepoId, target: DiffTarget, paths: ReadonlyArray<RepoPath>) {
        const bytes =
          target._tag === "Untracked"
            ? Buffer.concat(
                yield* Effect.forEach(paths.slice(0, MAX_UNTRACKED_DIFFS), (path) =>
                  git.run(repo, patchArgs(target, [path]), { okExitCodes: [1] }),
                ),
              )
            : yield* git.run(repo, patchArgs(target, paths))
        if (bytes.length > MAX_PATCH_BYTES) return { _tag: "TooLarge", bytes: bytes.length } satisfies FileDiff
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
        const source = action === "unstage" ? ["diff", "--cached"] : ["diff"]
        const text = decoder.decode(yield* git.run(repo, [...source, "--no-ext-diff", "--no-color", "--", path]))
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

      const removeWorktree = (repo: RepoId, path: string, force: boolean) =>
        run(repo, ["worktree", "remove", ...(force ? ["--force", "--force"] : []), path])

      const pushArgs = Effect.fn("Repo.pushArgs")(function* (repo: RepoId) {
        const { head, upstream } = yield* status(repo)
        if (upstream !== null || head._tag !== "Branch") return ["push", "--progress"]
        const remotes = parseRemotes(yield* git.run(repo, remotesArgs, { okExitCodes: [1] }))
        const remote = remotes.find((r) => r.name === "origin") ?? (remotes.length === 1 ? remotes[0] : undefined)
        if (remote === undefined) {
          return yield* new GitError({
            args: ["push"],
            exitCode: -1,
            stderr: remotes.length === 0 ? "This repository has no remotes." : "Pick a remote: there's no origin.",
          })
        }
        return ["push", "--progress", "--set-upstream", remote.name, `refs/heads/${head.name}`]
      })

      const forcePushArgs = Effect.fn("Repo.forcePushArgs")(function* (repo: RepoId, expected: Oid) {
        const { head, upstream } = yield* status(repo)
        if (head._tag !== "Branch" || upstream === null) {
          return yield* new GitError({
            args: ["push"],
            exitCode: -1,
            stderr: "Force push needs a branch with an upstream.",
          })
        }
        const slash = upstream.name.indexOf("/")
        const remote = upstream.name.slice(0, slash)
        const remoteBranch = upstream.name.slice(slash + 1)
        return [
          "push",
          "--progress",
          `--force-with-lease=refs/heads/${remoteBranch}:${expected}`,
          remote,
          `refs/heads/${head.name}:refs/heads/${remoteBranch}`,
        ]
      })

      const service: Repo["Service"] = {
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
        commitIndex: Effect.fn("Repo.commitIndex")(function* (repo, message, amend) {
          yield* run(
            repo,
            ["commit", "--cleanup=strip", "-F", "-", ...(amend ? ["--amend"] : [])],
            new TextEncoder().encode(message),
          )
          yield* fs.remove(yield* draftPath(repo), { force: true }).pipe(Effect.ignore)
        }),
        continueOperation: stepOperation("continue"),
        skipOperation: stepOperation("skip"),
        abortOperation: stepOperation("abort"),
        resolveConflict: Effect.fn("Repo.resolveConflict")(function* (repo, paths, side) {
          yield* withPaths(repo, ["checkout", `--${side}`], paths)
          yield* withPaths(repo, ["add"], paths)
        }),
        checkout: (repo, branch) => run(repo, ["switch", branch]),
        createBranch: (repo, name, startPoint, checkout) =>
          run(repo, checkout ? ["switch", "-c", name, startPoint] : ["branch", name, startPoint]),
        deleteBranch: Effect.fn("Repo.deleteBranch")(function* (repo, name, force, alsoRemoveWorktree) {
          if (!force) yield* ensureMerged(repo, name)
          if (alsoRemoveWorktree) {
            const worktrees = parseWorktrees(yield* git.run(repo, worktreeArgs))
            for (const worktree of worktrees) {
              if (worktree.isMain || worktree.head._tag !== "Branch" || worktree.head.name !== name) continue
              yield* removeWorktree(repo, worktree.path, true)
            }
          }
          yield* run(repo, ["branch", force ? "-D" : "-d", name])
        }),
        removeWorktree,
        pruneWorktrees: (repo) => run(repo, ["worktree", "prune"]),
        fetch: (repo) => git.progress(repo, ["fetch", "--all", "--prune", "--progress"]),
        pull: (repo) =>
          Stream.unwrap(
            Effect.as(
              Effect.acquireRelease(lockFor(repo).take(1), () => lockFor(repo).release(1)),
              git.progress(repo, ["pull", "--progress"]),
            ),
          ),
        push: (repo) => Stream.unwrap(pushArgs(repo).pipe(Effect.map((args) => git.progress(repo, args)))),
        forcePush: (repo, expected) =>
          Stream.unwrap(forcePushArgs(repo, expected).pipe(Effect.map((args) => git.progress(repo, args)))),
        renameBranch: (repo, from, to) => run(repo, ["branch", "-m", from, to]),
        merge: (repo, ref) => run(repo, ["merge", "--no-edit", ref]),
        rebase: (repo, onto) => run(repo, ["rebase", onto]),
        cherryPick: (repo, oid) => run(repo, ["cherry-pick", oid]),
        revert: (repo, oid) => run(repo, ["revert", "--no-edit", oid]),
        reset: (repo, oid, mode) => run(repo, ["reset", `--${mode}`, oid]),
        checkoutDetached: (repo, oid) => run(repo, ["switch", "--detach", oid]),
        createTag: (repo, name, oid, message) =>
          message.trim() === ""
            ? run(repo, ["tag", name, oid])
            : run(repo, ["tag", "-a", name, "-F", "-", oid], new TextEncoder().encode(message)),
        deleteTag: (repo, name) => run(repo, ["tag", "-d", name]),
        stashPush: (repo, message, includeUntracked) =>
          Effect.asVoid(
            git.run(
              repo,
              [
                "stash",
                "push",
                ...(includeUntracked ? ["--include-untracked"] : []),
                ...(message === "" ? [] : ["-m", message]),
              ],
              { write: true, patternPathspecs: true },
            ),
          ),
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
        stage: locked(service.stage),
        unstage: locked(service.unstage),
        discard: locked(service.discard),
        applyLines: locked(service.applyLines),
        commitIndex: locked(service.commitIndex),
        continueOperation: locked(service.continueOperation),
        skipOperation: locked(service.skipOperation),
        abortOperation: locked(service.abortOperation),
        resolveConflict: locked(service.resolveConflict),
        checkout: locked(service.checkout),
        createBranch: locked(service.createBranch),
        deleteBranch: locked(service.deleteBranch),
        removeWorktree: locked(service.removeWorktree),
        pruneWorktrees: locked(service.pruneWorktrees),
        renameBranch: locked(service.renameBranch),
        merge: locked(service.merge),
        rebase: locked(service.rebase),
        cherryPick: locked(service.cherryPick),
        revert: locked(service.revert),
        reset: locked(service.reset),
        checkoutDetached: locked(service.checkoutDetached),
        createTag: locked(service.createTag),
        deleteTag: locked(service.deleteTag),
        stashPush: locked(service.stashPush),
        addWorktree: locked(service.addWorktree),
        stashApply: locked(service.stashApply),
        stashDrop: locked(service.stashDrop),
      })
    }),
  ).pipe(Layer.provide(Git.layer))
}
