import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import {
  CommitDetail,
  CommitRow,
  DiffTarget,
  FileDiff,
  LogHandle,
  Oid,
  Refs,
  RepoEvent,
  RepoId,
  RepoInfo,
  RepoPath,
  RepoSummary,
  Status,
} from "./domain.ts"

export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  args: Schema.Array(Schema.String),
  exitCode: Schema.Int,
  stderr: Schema.String,
}) {}

export class RepoNotFound extends Schema.TaggedError<RepoNotFound>()("RepoNotFound", {
  path: Schema.String,
}) {}

export class LogExpired extends Schema.TaggedError<LogExpired>()("LogExpired", {}) {}

const repo = { repo: RepoId }
const paths = { repo: RepoId, paths: Schema.Array(RepoPath) }

export class GitRpcs extends RpcGroup.make(
  Rpc.make("ListRepos", { success: Schema.Array(RepoSummary) }),
  Rpc.make("OpenRepo", { payload: { path: Schema.String }, success: RepoInfo, error: RepoNotFound }),
  Rpc.make("WatchRepo", { payload: repo, success: RepoEvent, error: GitError, stream: true }),
  Rpc.make("GetStatus", { payload: repo, success: Status, error: GitError }),
  Rpc.make("GetRefs", { payload: repo, success: Refs, error: GitError }),
  Rpc.make("OpenLog", { payload: repo, success: LogHandle, error: GitError }),
  Rpc.make("GetLogPage", {
    payload: { repo: RepoId, logId: Schema.String, start: Schema.Int, count: Schema.Int },
    success: Schema.Array(CommitRow),
    error: Schema.Union([GitError, LogExpired]),
  }),
  Rpc.make("GetCommit", { payload: { repo: RepoId, oid: Oid }, success: CommitDetail, error: GitError }),
  Rpc.make("GetDiff", {
    payload: { repo: RepoId, target: DiffTarget, path: RepoPath, from: Schema.NullOr(RepoPath) },
    success: FileDiff,
    error: GitError,
  }),
  Rpc.make("Stage", { payload: paths, error: GitError }),
  Rpc.make("Unstage", { payload: paths, error: GitError }),
  Rpc.make("Discard", { payload: paths, error: GitError }),
  Rpc.make("Commit", {
    payload: { repo: RepoId, message: Schema.String, amend: Schema.Boolean },
    error: GitError,
  }),
  Rpc.make("Checkout", { payload: { repo: RepoId, branch: Schema.String }, error: GitError }),
  Rpc.make("CreateBranch", {
    payload: { repo: RepoId, name: Schema.String, startPoint: Oid, checkout: Schema.Boolean },
    error: GitError,
  }),
  Rpc.make("DeleteBranch", {
    payload: { repo: RepoId, name: Schema.String, force: Schema.Boolean, removeWorktree: Schema.Boolean },
    error: GitError,
  }),
  Rpc.make("RemoveWorktree", {
    payload: { repo: RepoId, path: Schema.String, force: Schema.Boolean },
    error: GitError,
  }),
  Rpc.make("PruneWorktrees", { payload: repo, error: GitError }),
  Rpc.make("Fetch", { payload: repo, error: GitError }),
  Rpc.make("Pull", { payload: repo, error: GitError }),
  Rpc.make("Push", { payload: repo, error: GitError }),
  Rpc.make("StashApply", { payload: { repo: RepoId, oid: Oid, drop: Schema.Boolean }, error: GitError }),
  Rpc.make("StashDrop", { payload: { repo: RepoId, oid: Oid }, error: GitError }),
) {}
