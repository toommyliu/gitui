import type { LineSelection } from "@gitui/contracts"
import type { FileDiffMetadata, SelectedLineRange, SelectionSide } from "@pierre/diffs"

type Row =
  | { readonly kind: " "; readonly hunk: number; readonly old: number; readonly new: number }
  | { readonly kind: "-"; readonly hunk: number; readonly old: number; readonly text: string }
  | { readonly kind: "+"; readonly hunk: number; readonly new: number; readonly text: string }

const stripNewline = (text: string | undefined) => (text ?? "").replace(/\n$/, "")

const rows = (file: FileDiffMetadata): Array<Row> => {
  const out: Array<Row> = []
  file.hunks.forEach((hunk, index) => {
    let oldLine = hunk.deletionStart
    let newLine = hunk.additionStart
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let i = 0; i < content.lines; i++) out.push({ kind: " ", hunk: index, old: oldLine++, new: newLine++ })
        continue
      }
      for (let i = 0; i < content.deletions; i++) {
        const text = stripNewline(file.deletionLines[content.deletionLineIndex + i])
        out.push({ kind: "-", hunk: index, old: oldLine++, text })
      }
      for (let i = 0; i < content.additions; i++) {
        const text = stripNewline(file.additionLines[content.additionLineIndex + i])
        out.push({ kind: "+", hunk: index, new: newLine++, text })
      }
    }
  })
  return out
}

const rowAt = (all: ReadonlyArray<Row>, line: number, side: SelectionSide | undefined) =>
  all.findIndex((row) =>
    side === "deletions" ? row.kind !== "+" && row.old === line : row.kind !== "-" && row.new === line,
  )

const toSelection = (row: Row): Array<LineSelection> =>
  row.kind === "-"
    ? [{ side: "old", line: row.old, text: row.text }]
    : row.kind === "+"
      ? [{ side: "new", line: row.new, text: row.text }]
      : []

export const selectedChanges = (file: FileDiffMetadata, range: SelectedLineRange): Array<LineSelection> => {
  const all = rows(file)
  const a = rowAt(all, range.start, range.side)
  const b = rowAt(all, range.end, range.endSide ?? range.side)
  if (a === -1 || b === -1) return []
  return all.slice(Math.min(a, b), Math.max(a, b) + 1).flatMap(toSelection)
}

export const hunkChanges = (file: FileDiffMetadata, line: number, side: SelectionSide): Array<LineSelection> => {
  const all = rows(file)
  const hit = all[rowAt(all, line, side)]
  return hit === undefined ? [] : all.filter((row) => row.hunk === hit.hunk).flatMap(toSelection)
}
