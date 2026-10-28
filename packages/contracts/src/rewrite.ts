import * as Schema from "effect/Schema"
import { Oid } from "./domain.ts"

export const RewriteAction = Schema.Literals(["pick", "reword", "squash", "fixup", "edit", "drop"])
export type RewriteAction = typeof RewriteAction.Type

export const RewriteCommit = Schema.Struct({ oid: Oid, message: Schema.String, published: Schema.Boolean })
export type RewriteCommit = typeof RewriteCommit.Type

export const RewritePlan = Schema.Struct({
  branch: Schema.String,
  head: Oid,
  base: Schema.NullOr(Oid),
  commits: Schema.Array(RewriteCommit),
})
export type RewritePlan = typeof RewritePlan.Type

export const RewriteStep = Schema.Struct({ oid: Oid, action: RewriteAction, message: Schema.String })
export type RewriteStep = typeof RewriteStep.Type

export const RewriteRequest = Schema.Struct({
  branch: Schema.String,
  head: Oid,
  first: Oid,
  steps: Schema.Array(RewriteStep),
  allowPublished: Schema.Boolean,
})
export type RewriteRequest = typeof RewriteRequest.Type

export const RewriteResult = Schema.Struct({ backupRef: Schema.String, paused: Schema.Boolean })
export type RewriteResult = typeof RewriteResult.Type

export const RebaseState = Schema.Union([
  Schema.TaggedStruct("Inactive", {}),
  Schema.TaggedStruct("Rebase", {
    phase: Schema.Literals(["edit", "conflict", "other"]),
    commit: Schema.NullOr(Oid),
    split: Schema.Boolean,
    backupRef: Schema.NullOr(Schema.String),
  }),
])
export type RebaseState = typeof RebaseState.Type
