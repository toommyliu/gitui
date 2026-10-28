import type { ConflictCode, ConflictFile, Operation } from "@gitui/contracts"

export interface Sides {
  readonly ours: string
  readonly theirs: string
}

const keeps: Record<Operation, Sides> = {
  merge: { ours: "Keep mine", theirs: "Take theirs" },
  rebase: { ours: "Keep upstream", theirs: "Keep my commit" },
  "cherry-pick": { ours: "Keep mine", theirs: "Take picked" },
  revert: { ours: "Keep mine", theirs: "Take revert" },
  bisect: { ours: "Keep mine", theirs: "Take theirs" },
}

export const operationNames: Record<Operation, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
  bisect: "Bisect",
}

export const keepLabels = (operation: Operation | null): Sides =>
  operation === null ? { ours: "Keep ours", theirs: "Take theirs" } : keeps[operation]

const names: Record<Operation, Sides> = {
  merge: { ours: "Mine", theirs: "Theirs" },
  rebase: { ours: "Upstream", theirs: "My commit" },
  "cherry-pick": { ours: "Mine", theirs: "Picked" },
  revert: { ours: "Mine", theirs: "Revert" },
  bisect: { ours: "Mine", theirs: "Theirs" },
}

export const sideNames = (operation: Operation | null): Sides =>
  operation === null ? { ours: "Ours", theirs: "Theirs" } : names[operation]

export const describeConflict = (code: ConflictCode, sides: Sides) => {
  const ours = sides.ours.toLowerCase()
  const theirs = sides.theirs.toLowerCase()
  switch (code) {
    case "UU":
      return "Changed in both"
    case "AA":
      return "Added in both"
    case "DD":
      return "Deleted in both"
    case "AU":
      return `Added in ${ours}`
    case "UA":
      return `Added in ${theirs}`
    case "DU":
      return `Deleted in ${ours}, changed in ${theirs}`
    case "UD":
      return `Changed in ${ours}, deleted in ${theirs}`
  }
}

export const conflictMarkers = (text: string) => text.match(/^<{7,}(?:\s|$)/gm)?.length ?? 0

export type SideChange = "added" | "deleted" | "changed" | "unchanged" | "absent" | "binary" | "too large"

export const sideChange = (base: ConflictFile, side: ConflictFile): SideChange => {
  switch (side._tag) {
    case "Binary":
      return "binary"
    case "TooLarge":
      return "too large"
    case "Missing":
      return base._tag === "Missing" ? "absent" : "deleted"
    case "Submodule":
      if (base._tag === "Missing") return "added"
      return base._tag === "Submodule" && base.oid === side.oid ? "unchanged" : "changed"
    case "Text":
      if (base._tag === "Missing") return "added"
      return base._tag === "Text" && base.content === side.content ? "unchanged" : "changed"
  }
}
