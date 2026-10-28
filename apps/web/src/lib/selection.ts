import type { Comparison, Oid } from "@gitui/contracts"

export type Selection =
  | { readonly _tag: "WorkingCopy" }
  | { readonly _tag: "Comparison"; readonly comparison: Comparison }
  | { readonly _tag: "Commit"; readonly oid: Oid }
  | { readonly _tag: "Worktree"; readonly path: string }
