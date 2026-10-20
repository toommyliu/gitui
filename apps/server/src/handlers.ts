import { GitError, GitRpcs } from "@gitui/contracts"
import { CommandLog, Repo, Worktrees } from "@gitui/git"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { listDirectory } from "./directory.ts"
import { watchRepo } from "./watch.ts"

export const handlers = GitRpcs.toLayer(
  Effect.gen(function* () {
    const repo = yield* Repo
    const commandLog = yield* CommandLog
    const worktrees = yield* Worktrees
    return GitRpcs.of({
      ListDirectory: ({ path }) => listDirectory(path),
      CommandLog: ({ repo: id }) => commandLog.entries(id),
      OpenRepo: ({ path }) => repo.open(path),
      WatchRepo: ({ repo: id }) =>
        repo.open(id).pipe(
          Effect.mapError(() => new GitError({ args: [], exitCode: -1, stderr: `${id} is no longer a repository` })),
          Effect.map(watchRepo),
          Stream.unwrap,
        ),
      GetStatus: ({ repo: id }) => repo.status(id),
      GetRefs: ({ repo: id }) => repo.refs(id),
      OpenLog: ({ repo: id, query, remotes }) => repo.openLog(id, query, remotes),
      GetLogPage: ({ repo: id, logId, start, count }) => repo.logPage(id, logId, start, count),
      GetCommit: ({ repo: id, oid }) => repo.commit(id, oid),
      GetDiff: ({ repo: id, target, paths, ignoreWhitespace }) => repo.diff(id, target, paths, ignoreWhitespace),
      Stage: ({ repo: id, paths }) => repo.stage(id, paths),
      Unstage: ({ repo: id, paths }) => repo.unstage(id, paths),
      Discard: ({ repo: id, paths }) => repo.discard(id, paths),
      ApplyLines: ({ repo: id, action, path, lines }) => repo.applyLines(id, action, path, lines),
      GetDraft: ({ repo: id }) => repo.readDraft(id),
      SetDraft: ({ repo: id, message }) => repo.writeDraft(id, message),
      Commit: ({ repo: id, message, amend }) => repo.commitIndex(id, message, amend),
      ContinueOperation: ({ repo: id }) => repo.continueOperation(id),
      SkipOperation: ({ repo: id }) => repo.skipOperation(id),
      AbortOperation: ({ repo: id }) => repo.abortOperation(id),
      ResolveConflict: ({ repo: id, paths, side }) => repo.resolveConflict(id, paths, side),
      Checkout: ({ repo: id, branch }) => repo.checkout(id, branch),
      CreateBranch: ({ repo: id, name, startPoint, checkout }) => repo.createBranch(id, name, startPoint, checkout),
      DeleteBranch: ({ repo: id, name, force, removeWorktree }) => repo.deleteBranch(id, name, force, removeWorktree),
      RemoveWorktree: ({ repo: id, path, force }) => repo.removeWorktree(id, path, force),
      PruneWorktrees: ({ repo: id }) => repo.pruneWorktrees(id),
      Fetch: ({ repo: id }) => repo.fetch(id),
      Pull: ({ repo: id }) => repo.pull(id),
      Push: ({ repo: id }) => repo.push(id),
      ForcePush: ({ repo: id, expected }) => repo.forcePush(id, expected),
      RenameBranch: ({ repo: id, from, to }) => repo.renameBranch(id, from, to),
      Merge: ({ repo: id, ref }) => repo.merge(id, ref),
      Rebase: ({ repo: id, onto }) => repo.rebase(id, onto),
      CherryPick: ({ repo: id, oid }) => repo.cherryPick(id, oid),
      Revert: ({ repo: id, oid }) => repo.revert(id, oid),
      Reset: ({ repo: id, oid, mode }) => repo.reset(id, oid, mode),
      CheckoutDetached: ({ repo: id, oid }) => repo.checkoutDetached(id, oid),
      CreateTag: ({ repo: id, name, oid, message }) => repo.createTag(id, name, oid, message),
      DeleteTag: ({ repo: id, name }) => repo.deleteTag(id, name),
      StashPush: ({ repo: id, message, includeUntracked }) => repo.stashPush(id, message, includeUntracked),
      AddWorktree: ({ repo: id, path, branch, startPoint }) => repo.addWorktree(id, path, branch, startPoint),
      StashApply: ({ repo: id, oid, drop }) => repo.stashApply(id, oid, drop),
      StashDrop: ({ repo: id, oid }) => repo.stashDrop(id, oid),
      GetWorktreeSummaries: ({ repo: id }) => worktrees.summaries(id),
      GetWorktree: ({ repo: id }) => worktrees.detail(id),
      GetWorktreeDiff: ({ repo: id }) => worktrees.diff(id),
      CheckWorktreeMerge: ({ repo: id, base }) => worktrees.checkMerge(id, base),
    })
  }),
)
