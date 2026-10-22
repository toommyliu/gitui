import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import {
  allRefsVisible,
  CommandEntry,
  CommitDetail,
  CommitRow,
  DiffTarget,
  DirectoryListing,
  FileDiff,
  LineAction,
  LineSelection,
  LogHandle,
  MergeCheck,
  Oid,
  Progress,
  Refs,
  RefVisibility,
  RepoEvent,
  RepoId,
  RepoInfo,
  RepoPath,
  Status,
  WorktreeDetail,
  WorktreeSummary,
} from "./domain.ts"

export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  args: Schema.Array(Schema.String),
  exitCode: Schema.Int,
  stderr: Schema.String,
}) {
  get summary(): string {
    const raw = this.stderr.split("\n").filter((line) => line.trim() !== "" && !line.trimStart().startsWith("hint:"))
    const lines = raw.map((line) => line.trim())
    const problems = lines.flatMap((line, index) => {
      const match = /^(?:fatal|error): (.*)$/.exec(line)
      if (match === null) return []
      const problem = match[1]!
      if (!problem.endsWith(":")) return [problem]
      const after = raw.slice(index + 1)
      const end = after.findIndex((next) => !/^\s/.test(next))
      const items = after.slice(0, end === -1 ? after.length : end).map((item) => item.trim())
      if (items.length === 0) return [problem]
      const listed =
        items.length > 3 ? `${items.slice(0, 3).join(", ")} and ${items.length - 3} more` : items.join(", ")
      return [`${problem} ${listed}`]
    })
    const shown = (problems.length > 0 ? problems : lines).slice(0, 2).join("\n")
    if (shown === "") return `git ${this.args[0] ?? ""} exited with ${this.exitCode}`
    return shown.charAt(0).toUpperCase() + shown.slice(1)
  }
}

export class RepoNotFound extends Schema.TaggedError<RepoNotFound>()("RepoNotFound", {
  path: Schema.String,
}) {}

export class DirectoryNotFound extends Schema.TaggedError<DirectoryNotFound>()("DirectoryNotFound", {
  path: Schema.String,
}) {}

export class LogExpired extends Schema.TaggedError<LogExpired>()("LogExpired", {}) {}

const repo = { repo: RepoId }
const paths = { repo: RepoId, paths: Schema.Array(RepoPath) }

export class GitRpcs extends RpcGroup.make(
  Rpc.make("ListDirectory", {
    payload: { path: Schema.String },
    success: DirectoryListing,
    error: DirectoryNotFound,
  }),
  Rpc.make("FilterRepos", { payload: { paths: Schema.Array(Schema.String) }, success: Schema.Array(Schema.String) }),
  Rpc.make("CommandLog", { payload: repo, success: Schema.Array(CommandEntry), stream: true }),
  Rpc.make("OpenRepo", { payload: { path: Schema.String }, success: RepoInfo, error: RepoNotFound }),
  Rpc.make("WatchRepo", { payload: repo, success: RepoEvent, error: GitError, stream: true }),
  Rpc.make("GetStatus", { payload: repo, success: Status, error: GitError }),
  Rpc.make("GetRefs", { payload: repo, success: Refs, error: GitError }),
  Rpc.make("OpenLog", {
    payload: {
      repo: RepoId,
      query: Schema.String,
      refs: RefVisibility.pipe(Schema.withDecodingDefaultKey(Effect.succeed(allRefsVisible))),
    },
    success: LogHandle,
    error: Schema.Union([GitError, LogExpired]),
    stream: true,
  }),
  Rpc.make("GetLogPage", {
    payload: { repo: RepoId, logId: Schema.String, start: Schema.Int, count: Schema.Int },
    success: Schema.Array(CommitRow),
    error: Schema.Union([GitError, LogExpired]),
  }),
  Rpc.make("GetLogIndex", {
    payload: { repo: RepoId, logId: Schema.String, oid: Oid },
    success: Schema.NullOr(Schema.Int),
    error: Schema.Union([GitError, LogExpired]),
  }),
  Rpc.make("GetCommit", { payload: { repo: RepoId, oid: Oid }, success: CommitDetail, error: GitError }),
  Rpc.make("GetDiff", {
    payload: {
      repo: RepoId,
      target: DiffTarget,
      paths: Schema.Array(RepoPath),
      ignoreWhitespace: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
    },
    success: FileDiff,
    error: GitError,
  }),
  Rpc.make("Stage", { payload: paths, error: GitError }),
  Rpc.make("Unstage", { payload: paths, error: GitError }),
  Rpc.make("Discard", { payload: paths, error: GitError }),
  Rpc.make("ApplyLines", {
    payload: {
      repo: RepoId,
      action: LineAction,
      path: RepoPath,
      lines: Schema.Array(LineSelection),
    },
    error: GitError,
  }),
  Rpc.make("GetDraft", { payload: repo, success: Schema.String, error: GitError }),
  Rpc.make("SetDraft", { payload: { repo: RepoId, message: Schema.String }, error: GitError }),
  Rpc.make("Commit", {
    payload: { repo: RepoId, message: Schema.String, amend: Schema.Boolean },
    error: GitError,
  }),
  Rpc.make("ContinueOperation", { payload: repo, error: GitError }),
  Rpc.make("SkipOperation", { payload: repo, error: GitError }),
  Rpc.make("AbortOperation", { payload: repo, error: GitError }),
  Rpc.make("ResolveConflict", {
    payload: { ...paths, side: Schema.Literals(["ours", "theirs"]) },
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
    payload: { repo: RepoId, path: Schema.String, force: Schema.Boolean, deleteBranch: Schema.Boolean },
    error: GitError,
  }),
  Rpc.make("PruneWorktrees", { payload: repo, error: GitError }),
  Rpc.make("Fetch", { payload: repo, success: Progress, error: GitError, stream: true }),
  Rpc.make("Pull", { payload: repo, success: Progress, error: GitError, stream: true }),
  Rpc.make("Push", { payload: repo, success: Progress, error: GitError, stream: true }),
  Rpc.make("ForcePush", {
    payload: { repo: RepoId, expected: Oid },
    success: Progress,
    error: GitError,
    stream: true,
  }),
  Rpc.make("RenameBranch", { payload: { repo: RepoId, from: Schema.String, to: Schema.String }, error: GitError }),
  Rpc.make("Merge", { payload: { repo: RepoId, ref: Schema.String }, error: GitError }),
  Rpc.make("Rebase", { payload: { repo: RepoId, onto: Schema.String }, error: GitError }),
  Rpc.make("CherryPick", { payload: { repo: RepoId, oid: Oid }, error: GitError }),
  Rpc.make("Revert", { payload: { repo: RepoId, oid: Oid }, error: GitError }),
  Rpc.make("Reset", {
    payload: { repo: RepoId, oid: Oid, mode: Schema.Literals(["soft", "mixed", "hard"]) },
    error: GitError,
  }),
  Rpc.make("CheckoutDetached", { payload: { repo: RepoId, oid: Oid }, error: GitError }),
  Rpc.make("CreateTag", {
    payload: { repo: RepoId, name: Schema.String, oid: Oid, message: Schema.String },
    error: GitError,
  }),
  Rpc.make("DeleteTag", { payload: { repo: RepoId, name: Schema.String }, error: GitError }),
  Rpc.make("DeleteRemoteBranch", { payload: { repo: RepoId, name: Schema.String }, error: GitError }),
  Rpc.make("StashPush", {
    payload: { repo: RepoId, message: Schema.String, includeUntracked: Schema.Boolean },
    error: GitError,
  }),
  Rpc.make("AddWorktree", {
    payload: { repo: RepoId, path: Schema.String, branch: Schema.String, startPoint: Schema.NullOr(Oid) },
    error: GitError,
  }),
  Rpc.make("StashApply", { payload: { repo: RepoId, oid: Oid, drop: Schema.Boolean }, error: GitError }),
  Rpc.make("StashDrop", { payload: { repo: RepoId, oid: Oid }, error: GitError }),
  Rpc.make("GetWorktreeSummaries", { payload: repo, success: Schema.Array(WorktreeSummary), error: GitError }),
  Rpc.make("GetWorktree", { payload: repo, success: WorktreeDetail, error: GitError }),
  Rpc.make("GetWorktreeDiff", { payload: repo, success: FileDiff, error: GitError }),
  Rpc.make("CheckWorktreeMerge", { payload: { repo: RepoId, base: Oid }, success: MergeCheck, error: GitError }),
) {}
