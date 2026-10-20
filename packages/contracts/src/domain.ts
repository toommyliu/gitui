import * as Schema from "effect/Schema"

export const RepoId = Schema.String.pipe(Schema.brand("RepoId"))
export type RepoId = typeof RepoId.Type

export const Oid = Schema.String.pipe(Schema.brand("Oid"))
export type Oid = typeof Oid.Type

export const RepoPath = Schema.String.pipe(Schema.brand("RepoPath"))
export type RepoPath = typeof RepoPath.Type

export const DirectoryEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  isRepo: Schema.Boolean,
})
export type DirectoryEntry = typeof DirectoryEntry.Type

export const DirectoryListing = Schema.Struct({
  path: Schema.String,
  isRepo: Schema.Boolean,
  entries: Schema.Array(DirectoryEntry),
})
export type DirectoryListing = typeof DirectoryListing.Type

export const RepoInfo = Schema.Struct({
  id: RepoId,
  name: Schema.String,
  gitDir: Schema.String,
  commonDir: Schema.String,
})
export type RepoInfo = typeof RepoInfo.Type

export const Head = Schema.Union([
  Schema.TaggedStruct("Branch", { name: Schema.String, oid: Oid }),
  Schema.TaggedStruct("Unborn", { name: Schema.String }),
  Schema.TaggedStruct("Detached", { oid: Oid }),
])
export type Head = typeof Head.Type

export const Operation = Schema.Literals(["merge", "rebase", "cherry-pick", "revert", "bisect"])
export type Operation = typeof Operation.Type

export const Change = Schema.Literals(["modified", "added", "deleted", "renamed", "copied", "typechange"])
export type Change = typeof Change.Type

export const ConflictCode = Schema.Literals(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])
export type ConflictCode = typeof ConflictCode.Type

export const StatusEntry = Schema.Union([
  Schema.TaggedStruct("Tracked", {
    path: RepoPath,
    from: Schema.NullOr(RepoPath),
    staged: Schema.NullOr(Change),
    unstaged: Schema.NullOr(Change),
    submodule: Schema.Boolean,
  }),
  Schema.TaggedStruct("Conflicted", { path: RepoPath, code: ConflictCode }),
  Schema.TaggedStruct("Untracked", { path: RepoPath }),
])
export type StatusEntry = typeof StatusEntry.Type

export const Tracking = Schema.Struct({
  name: Schema.String,
  ahead: Schema.Int,
  behind: Schema.Int,
})
export type Tracking = typeof Tracking.Type

export const Status = Schema.Struct({
  head: Head,
  upstream: Schema.NullOr(Tracking),
  operation: Schema.NullOr(Operation),
  entries: Schema.Array(StatusEntry),
})
export type Status = typeof Status.Type

export const Upstream = Schema.Union([
  Schema.TaggedStruct("Tracking", { name: Schema.String, ahead: Schema.Int, behind: Schema.Int }),
  Schema.TaggedStruct("Gone", { name: Schema.String }),
])
export type Upstream = typeof Upstream.Type

export const Branch = Schema.Struct({
  name: Schema.String,
  oid: Oid,
  upstream: Schema.NullOr(Upstream),
})
export type Branch = typeof Branch.Type

export const RemoteBranch = Schema.Struct({
  remote: Schema.String,
  name: Schema.String,
  oid: Oid,
})
export type RemoteBranch = typeof RemoteBranch.Type

export const Tag = Schema.Struct({ name: Schema.String, oid: Oid })
export type Tag = typeof Tag.Type

export const Stash = Schema.Struct({
  oid: Oid,
  message: Schema.String,
  time: Schema.Int,
})
export type Stash = typeof Stash.Type

export const WorktreeHead = Schema.Union([
  Schema.TaggedStruct("Branch", { name: Schema.String, oid: Oid }),
  Schema.TaggedStruct("Detached", { oid: Oid }),
  Schema.TaggedStruct("Bare", {}),
])
export type WorktreeHead = typeof WorktreeHead.Type

export const Worktree = Schema.Struct({
  path: Schema.String,
  head: WorktreeHead,
  isMain: Schema.Boolean,
  locked: Schema.NullOr(Schema.String),
  prunable: Schema.NullOr(Schema.String),
})
export type Worktree = typeof Worktree.Type

export const Remote = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
})
export type Remote = typeof Remote.Type

export const Refs = Schema.Struct({
  branches: Schema.Array(Branch),
  remoteBranches: Schema.Array(RemoteBranch),
  tags: Schema.Array(Tag),
  stashes: Schema.Array(Stash),
  worktrees: Schema.Array(Worktree),
  remotes: Schema.Array(Remote),
})
export type Refs = typeof Refs.Type

export const GraphRow = Schema.Struct({
  lane: Schema.Int,
  color: Schema.Int,
  up: Schema.Array(Schema.Int),
  down: Schema.Array(Schema.Int),
})
export type GraphRow = typeof GraphRow.Type

export const CommitRow = Schema.Struct({
  oid: Oid,
  parents: Schema.Array(Oid),
  subject: Schema.String,
  author: Schema.String,
  time: Schema.Int,
  graph: GraphRow,
})
export type CommitRow = typeof CommitRow.Type

export const LogHandle = Schema.Struct({
  logId: Schema.String,
  loaded: Schema.Int,
  done: Schema.Boolean,
})
export type LogHandle = typeof LogHandle.Type

export const Signature = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  time: Schema.Int,
})
export type Signature = typeof Signature.Type

export const FileChange = Schema.Struct({
  path: RepoPath,
  from: Schema.NullOr(RepoPath),
  change: Change,
  additions: Schema.NullOr(Schema.Int),
  deletions: Schema.NullOr(Schema.Int),
})
export type FileChange = typeof FileChange.Type

export const CommitDetail = Schema.Struct({
  oid: Oid,
  tree: Oid,
  parents: Schema.Array(Oid),
  author: Signature,
  committer: Signature,
  message: Schema.String,
  files: Schema.Array(FileChange),
})
export type CommitDetail = typeof CommitDetail.Type

export const DiffTarget = Schema.Union([
  Schema.TaggedStruct("Commit", { oid: Oid }),
  Schema.TaggedStruct("Staged", {}),
  Schema.TaggedStruct("Unstaged", {}),
  Schema.TaggedStruct("Untracked", {}),
])
export type DiffTarget = typeof DiffTarget.Type

export const FileDiff = Schema.Union([
  Schema.TaggedStruct("Patch", { patch: Schema.String }),
  Schema.TaggedStruct("TooLarge", { bytes: Schema.Int }),
  Schema.TaggedStruct("Empty", {}),
])
export type FileDiff = typeof FileDiff.Type

export const ChangeScope = Schema.Literals(["worktree", "index", "refs", "draft"])
export type ChangeScope = typeof ChangeScope.Type

export const RepoEvent = Schema.Struct({
  scopes: Schema.Array(ChangeScope),
})
export type RepoEvent = typeof RepoEvent.Type

export const CommandOutcome = Schema.Union([
  Schema.TaggedStruct("Exited", { code: Schema.Int, accepted: Schema.Boolean }),
  Schema.TaggedStruct("SpawnFailed", { message: Schema.String }),
  Schema.TaggedStruct("Streamed", {}),
  Schema.TaggedStruct("Cancelled", {}),
])
export type CommandOutcome = typeof CommandOutcome.Type

export const CommandEntry = Schema.Struct({
  id: Schema.Int,
  cwd: Schema.String,
  args: Schema.Array(Schema.String),
  prefixLength: Schema.Int,
  kind: Schema.Literals(["read", "write"]),
  startedAt: Schema.Finite,
  durationMs: Schema.Finite,
  outcome: CommandOutcome,
  stderr: Schema.String,
})
export type CommandEntry = typeof CommandEntry.Type

export const LineSelection = Schema.Struct({
  side: Schema.Literals(["old", "new"]),
  line: Schema.Int,
  text: Schema.String,
})
export type LineSelection = typeof LineSelection.Type

export const LineAction = Schema.Literals(["stage", "unstage", "discard"])
export type LineAction = typeof LineAction.Type

export const Progress = Schema.Struct({
  line: Schema.String,
  percent: Schema.NullOr(Schema.Int),
})
export type Progress = typeof Progress.Type

export const WorktreeSummary = Schema.Struct({
  path: Schema.String,
  changes: Schema.Int,
  commits: Schema.NullOr(Schema.Int),
  paths: Schema.Array(RepoPath),
})
export type WorktreeSummary = typeof WorktreeSummary.Type

export const BaseRef = Schema.Struct({ name: Schema.String, oid: Oid })
export type BaseRef = typeof BaseRef.Type

export const BranchCommit = Schema.Struct({
  oid: Oid,
  subject: Schema.String,
  time: Schema.Int,
  landed: Schema.NullOr(Oid),
})
export type BranchCommit = typeof BranchCommit.Type

export const WorktreeDetail = Schema.Struct({
  head: Head,
  base: Schema.NullOr(BaseRef),
  mergeBase: Schema.NullOr(Oid),
  behind: Schema.Int,
  unique: Schema.Int,
  commits: Schema.Array(BranchCommit),
  truncated: Schema.Boolean,
  entries: Schema.Array(StatusEntry),
  editedAt: Schema.NullOr(Schema.Int),
})
export type WorktreeDetail = typeof WorktreeDetail.Type

export const MergeCheck = Schema.Union([
  Schema.TaggedStruct("Clean", {}),
  Schema.TaggedStruct("Conflicts", { paths: Schema.Array(RepoPath) }),
])
export type MergeCheck = typeof MergeCheck.Type
