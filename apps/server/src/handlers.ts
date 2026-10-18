import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { GitError, GitRpcs, type RepoSummary } from "@gitui/contracts"
import { CommandLog, Repo } from "@gitui/git"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { watchRepo } from "./watch.ts"

const discover = (roots: ReadonlyArray<string>): Array<RepoSummary> =>
  roots
    .flatMap((root) => {
      const entries = existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []
      return entries
        .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, ".git")))
        .map((entry) => ({ path: join(root, entry.name), name: entry.name }))
    })
    .sort((a, b) => a.name.localeCompare(b.name))

export const handlers = (repoRoots: ReadonlyArray<string>) =>
  GitRpcs.toLayer(
    Effect.gen(function* () {
      const repo = yield* Repo
      const commandLog = yield* CommandLog
      return GitRpcs.of({
        ListRepos: () => Effect.sync(() => discover(repoRoots)),
        CommandLog: () => commandLog.entries,
        OpenRepo: ({ path }) => repo.open(path),
        WatchRepo: ({ repo: id }) =>
          repo.open(id).pipe(
            Effect.mapError(() => new GitError({ args: [], exitCode: -1, stderr: `${id} is no longer a repository` })),
            Effect.map(watchRepo),
            Stream.unwrap,
          ),
        GetStatus: ({ repo: id }) => repo.status(id),
        GetRefs: ({ repo: id }) => repo.refs(id),
        OpenLog: ({ repo: id }) => repo.openLog(id),
        GetLogPage: ({ repo: id, logId, start, count }) => repo.logPage(id, logId, start, count),
        GetCommit: ({ repo: id, oid }) => repo.commit(id, oid),
        GetDiff: ({ repo: id, target, paths }) => repo.diff(id, target, paths),
        Stage: ({ repo: id, paths }) => repo.stage(id, paths),
        Unstage: ({ repo: id, paths }) => repo.unstage(id, paths),
        Discard: ({ repo: id, paths }) => repo.discard(id, paths),
        ApplyLines: ({ repo: id, action, path, lines }) => repo.applyLines(id, action, path, lines),
        Commit: ({ repo: id, message, amend }) => repo.commitIndex(id, message, amend),
        ContinueOperation: ({ repo: id }) => repo.continueOperation(id),
        SkipOperation: ({ repo: id }) => repo.skipOperation(id),
        AbortOperation: ({ repo: id }) => repo.abortOperation(id),
        ResolveConflict: ({ repo: id, path, side }) => repo.resolveConflict(id, path, side),
        Checkout: ({ repo: id, branch }) => repo.checkout(id, branch),
        CreateBranch: ({ repo: id, name, startPoint, checkout }) => repo.createBranch(id, name, startPoint, checkout),
        DeleteBranch: ({ repo: id, name, force, removeWorktree }) => repo.deleteBranch(id, name, force, removeWorktree),
        RemoveWorktree: ({ repo: id, path, force }) => repo.removeWorktree(id, path, force),
        PruneWorktrees: ({ repo: id }) => repo.pruneWorktrees(id),
        Fetch: ({ repo: id }) => repo.fetch(id),
        Pull: ({ repo: id }) => repo.pull(id),
        Push: ({ repo: id }) => repo.push(id),
        StashApply: ({ repo: id, oid, drop }) => repo.stashApply(id, oid, drop),
        StashDrop: ({ repo: id, oid }) => repo.stashDrop(id, oid),
      })
    }),
  )
