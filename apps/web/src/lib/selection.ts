import type { Oid } from "@gitui/contracts"

export type Selection = { readonly _tag: "WorkingCopy" } | { readonly _tag: "Commit"; readonly oid: Oid }
