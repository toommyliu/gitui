import * as Schema from "effect/Schema"
import { Change, Oid, RepoPath } from "./domain.ts"

export const FileIdentity = Schema.Struct({ revision: Oid, path: RepoPath })
export type FileIdentity = typeof FileIdentity.Type

export const FileContent = Schema.Union([
  Schema.TaggedStruct("Text", { content: Schema.String }),
  Schema.TaggedStruct("Binary", {}),
  Schema.TaggedStruct("TooLarge", {}),
  Schema.TaggedStruct("Symlink", { target: Schema.NullOr(Schema.String) }),
  Schema.TaggedStruct("Submodule", {}),
  Schema.TaggedStruct("Missing", {}),
])
export type FileContent = typeof FileContent.Type

export const FileRevision = Schema.Struct({
  ...FileIdentity.fields,
  blob: Schema.NullOr(Oid),
  mode: Schema.NullOr(Schema.String),
  bytes: Schema.Int,
  content: FileContent,
})
export type FileRevision = typeof FileRevision.Type

export const FileHistoryEntry = Schema.Struct({
  oid: Oid,
  parent: Schema.NullOr(Oid),
  path: RepoPath,
  from: Schema.NullOr(RepoPath),
  change: Change,
  author: Schema.String,
  time: Schema.Int,
  subject: Schema.String,
})
export type FileHistoryEntry = typeof FileHistoryEntry.Type

export const FileHistory = Schema.Struct({
  ...FileIdentity.fields,
  entries: Schema.Array(FileHistoryEntry),
  truncated: Schema.Boolean,
})
export type FileHistory = typeof FileHistory.Type

export const FileBlame = Schema.Union([
  Schema.TaggedStruct("Unavailable", { reason: Schema.String }),
  Schema.TaggedStruct("Lines", {
    lines: Schema.Array(Schema.Struct({
      oid: Oid,
      path: RepoPath,
      originalLine: Schema.Int,
      line: Schema.Int,
      content: Schema.String,
      author: Schema.String,
      time: Schema.Int,
      subject: Schema.String,
    })),
  }),
])
export type FileBlame = typeof FileBlame.Type

export const FileRestorePreview = Schema.Struct({
  source: FileIdentity,
  destination: RepoPath,
  version: Schema.String,
  overwrite: Schema.Boolean,
  unavailable: Schema.NullOr(Schema.String),
})
export type FileRestorePreview = typeof FileRestorePreview.Type
