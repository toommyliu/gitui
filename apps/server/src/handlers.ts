import { GitError, GitRpcs } from "@gitui/contracts"
import { CommandLog, Repo, Worktrees } from "@gitui/git"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { filterRepos, listDirectory } from "./directory.ts"
import { watchRepo } from "./watch.ts"

export const handlers = GitRpcs.toLayer(
  Effect.gen(function* () {
    const repo = yield* Repo
    const commandLog = yield* CommandLog
    const worktrees = yield* Worktrees
    return GitRpcs.of({
      ListDirectory: ({ path }) => listDirectory(path),
      FilterRepos: ({ paths }) => Effect.sync(() => filterRepos(paths)),
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
      GetDiscardRecovery: ({ repo: id }) => repo.discardRecovery(id),
      RestoreDiscard: ({ repo: id, id: backup, overwriteVersion }) => repo.restoreDiscard(id, backup, overwriteVersion),
      GetRecovery: ({ repo: id }) => repo.recovery(id),
      RecoverCommit: ({ repo: id, oid, name }) => repo.recoverCommit(id, oid, name),
      UndoCommit: ({ repo: id, expected, branch }) => repo.undoCommit(id, expected, branch),
      OpenLog: ({ repo: id, query, refs }) => repo.openLog(id, query, refs),
      GetLogPage: ({ repo: id, logId, start, count }) => repo.logPage(id, logId, start, count),
      GetLogIndex: ({ repo: id, logId, oid }) => repo.logIndex(id, logId, oid),
      GetCommit: ({ repo: id, oid }) => repo.commit(id, oid),
      GetComparison: ({ repo: id, comparison }) => repo.comparison(id, comparison),
      GetDiff: ({ repo: id, target, paths, ignoreWhitespace, allowLarge }) =>
        repo.diff(id, target, paths, ignoreWhitespace, allowLarge),
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
      GetConflict: ({ repo: id, path }) => repo.conflict(id, path),
      SaveConflictResult: ({ repo: id, path, content, expectedVersion, stage }) =>
        repo.saveConflictResult(id, path, content, expectedVersion, stage),
      RunMergeTool: ({ repo: id, path }) => repo.runMergeTool(id, path),
      Checkout: ({ repo: id, branch }) => repo.checkout(id, branch),
      CreateBranch: ({ repo: id, name, startPoint, checkout }) => repo.createBranch(id, name, startPoint, checkout),
      DeleteBranch: ({ repo: id, name, force, removeWorktree }) => repo.deleteBranch(id, name, force, removeWorktree),
      RemoveWorktree: ({ repo: id, path, force, deleteBranch }) => repo.removeWorktree(id, path, force, deleteBranch),
      PruneWorktrees: ({ repo: id }) => repo.pruneWorktrees(id),
      Fetch: ({ repo: id }) => repo.fetch(id),
      Pull: ({ repo: id, strategy, target }) => repo.pull(id, strategy, target),
      Push: ({ repo: id, destination, setUpstream }) => repo.push(id, destination, setUpstream),
      ForcePush: ({ repo: id, destination, expected }) => repo.forcePush(id, destination, expected),
      AddRemote: ({ repo: id, remote }) => repo.addRemote(id, remote),
      EditRemote: ({ repo: id, name, remote }) => repo.editRemote(id, name, remote),
      RemoveRemote: ({ repo: id, name }) => repo.removeRemote(id, name),
      SetUpstream: ({ repo: id, branch, upstream }) => repo.setUpstream(id, branch, upstream),
      PushTags: ({ repo: id, remote, tags }) => repo.pushTags(id, remote, tags),
      RenameBranch: ({ repo: id, from, to }) => repo.renameBranch(id, from, to),
      Merge: ({ repo: id, ref }) => repo.merge(id, ref),
      Rebase: ({ repo: id, onto }) => repo.rebase(id, onto),
      GetRewritePlan: ({ repo: id, first }) => repo.rewritePlan(id, first),
      StartRewrite: ({ repo: id, request }) => repo.startRewrite(id, request),
      GetRebaseState: ({ repo: id }) => repo.rebaseState(id),
      SplitRebaseCommit: ({ repo: id }) => repo.splitRebaseCommit(id),
      CherryPick: ({ repo: id, oid }) => repo.cherryPick(id, oid),
      Revert: ({ repo: id, oid }) => repo.revert(id, oid),
      Reset: ({ repo: id, oid, mode }) => repo.reset(id, oid, mode),
      CheckoutDetached: ({ repo: id, oid }) => repo.checkoutDetached(id, oid),
      CreateTag: ({ repo: id, name, oid, message }) => repo.createTag(id, name, oid, message),
      DeleteTag: ({ repo: id, name }) => repo.deleteTag(id, name),
      DeleteRemoteBranch: ({ repo: id, remote, branch, expected }) =>
        repo.deleteRemoteBranch(id, remote, branch, expected),
      DeleteRemoteTrackingBranch: ({ repo: id, name }) => repo.deleteRemoteTrackingBranch(id, name),
      StashPush: ({ repo: id, message, includeUntracked }) => repo.stashPush(id, message, includeUntracked),
      AddWorktree: ({ repo: id, path, branch, startPoint }) => repo.addWorktree(id, path, branch, startPoint),
      StashApply: ({ repo: id, oid, drop }) => repo.stashApply(id, oid, drop),
      StashDrop: ({ repo: id, oid }) => repo.stashDrop(id, oid),
      GetWorktreeSummaries: ({ repo: id }) => worktrees.summaries(id),
      GetWorktree: ({ repo: id }) => worktrees.detail(id),
      GetWorktreeDiff: ({ repo: id, allowLarge }) => worktrees.diff(id, allowLarge),
      CheckWorktreeMerge: ({ repo: id, base }) => worktrees.checkMerge(id, base),
    })
  }),
)
