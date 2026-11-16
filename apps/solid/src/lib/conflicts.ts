import type { ConflictCode, ConflictFile, ConflictRef, Operation } from "@gitui/contracts"
import { lineCount } from "./conflict-blocks"
import { shortOid } from "./format"

export const describeConflict = (code: ConflictCode) => {
  switch (code) {
    case "UU":
      return "Changed in both"
    case "AA":
      return "Added in both"
    case "DD":
      return "Deleted in both"
    case "AU":
      return "Added in ours"
    case "UA":
      return "Added in theirs"
    case "DU":
      return "Deleted in ours, changed in theirs"
    case "UD":
      return "Changed in ours, deleted in theirs"
  }
}

const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export const describeFile = (file: ConflictFile) => {
  switch (file._tag) {
    case "Missing":
      return "Deleted"
    case "Submodule":
      return file.oid === null ? "Submodule, not initialized" : `Submodule at ${shortOid(file.oid)}`
    case "Binary":
      return `Binary, ${size(file.bytes)}`
    case "TooLarge":
      return `Too large to show, ${size(file.bytes)}`
    case "Text": {
      const lines = lineCount(file.content)
      return `Text, ${lines} ${lines === 1 ? "line" : "lines"}`
    }
  }
}

const branchOf = (ref: ConflictRef | null) => ref?.name?.replace(/[~^].*$/, "") ?? null

export const refLabel = (ref: ConflictRef) => branchOf(ref) ?? shortOid(ref.oid)

export interface SideRefs {
  readonly ours: ConflictRef | null
  readonly theirs: ConflictRef | null
}

export const operationTitle = (operation: Operation | null, refs: SideRefs) => {
  const ours = branchOf(refs.ours)
  const theirs = refs.theirs
  switch (operation) {
    case null:
      return "Conflicts"
    case "merge":
      return theirs === null ? "Merging" : `Merging ${refLabel(theirs)}${ours === null ? "" : ` into ${ours}`}`
    case "rebase":
      return theirs === null ? "Rebasing" : `Rebasing ${refLabel(theirs)}${ours === null ? "" : ` onto ${ours}`}`
    case "cherry-pick":
      return theirs === null ? "Cherry-picking" : `Cherry-picking “${theirs.subject}”`
    case "revert":
      return theirs === null ? "Reverting" : `Reverting “${theirs.subject}”`
    case "bisect":
      return "Bisecting"
  }
}
