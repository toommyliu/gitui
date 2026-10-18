import type { LineSelection } from "@gitui/contracts"

type Line = { readonly kind: " " | "-" | "+"; readonly text: string; readonly noNewline: boolean }

interface Hunk {
  readonly oldStart: number
  readonly newStart: number
  readonly lines: ReadonlyArray<Line>
}

export interface FilePatch {
  readonly header: ReadonlyArray<string>
  readonly hunks: ReadonlyArray<Hunk>
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export const parseFilePatch = (text: string): FilePatch => {
  const rows = text.split("\n")
  if (rows.at(-1) === "") rows.pop()
  const header: Array<string> = []
  const hunks: Array<{ oldStart: number; newStart: number; lines: Array<Line> }> = []
  for (const row of rows) {
    const match = HUNK_HEADER.exec(row)
    if (match !== null) {
      hunks.push({ oldStart: Number(match[1]), newStart: Number(match[2]), lines: [] })
      continue
    }
    const hunk = hunks.at(-1)
    if (hunk === undefined) {
      header.push(row)
    } else if (row.startsWith("\\")) {
      const last = hunk.lines.pop()
      if (last !== undefined) hunk.lines.push({ ...last, noNewline: true })
    } else {
      const kind = row[0] === "+" || row[0] === "-" ? row[0] : " "
      hunk.lines.push({ kind, text: row.slice(1), noNewline: false })
    }
  }
  return { header, hunks }
}

export const selectionKey = (side: LineSelection["side"], line: number) => `${side}:${line}`

export type Direction = "forward" | "reverse"

type Marked = { readonly line: Line; readonly selected: boolean }
type Block = { readonly context: boolean; readonly lines: ReadonlyArray<Marked> }

const blocks = (marked: ReadonlyArray<Marked>): Array<Block> => {
  const out: Array<{ context: boolean; lines: Array<Marked> }> = []
  for (const item of marked) {
    const context = item.line.kind === " "
    const last = out.at(-1)
    if (context || last === undefined || last.context) out.push({ context, lines: [item] })
    else last.lines.push(item)
  }
  return out
}

const asContext = (line: Line): Line => ({ ...line, kind: " " })

const rebuild = (block: ReadonlyArray<Marked>, direction: Direction): Array<Line> => {
  const deletions = block.filter((m) => m.line.kind === "-")
  const additions = block.filter((m) => m.line.kind === "+")
  if (direction === "forward") {
    const last = deletions.findLastIndex((m) => m.selected)
    return [
      ...deletions.slice(0, last + 1).map((m) => (m.selected ? m.line : asContext(m.line))),
      ...additions.filter((m) => m.selected).map((m) => m.line),
      ...deletions.slice(last + 1).map((m) => asContext(m.line)),
    ]
  }
  const first = additions.findIndex((m) => m.selected)
  const split = first === -1 ? 0 : first
  return [
    ...additions.slice(0, split).map((m) => asContext(m.line)),
    ...deletions.filter((m) => m.selected).map((m) => m.line),
    ...additions.slice(split).map((m) => (m.selected ? m.line : asContext(m.line))),
  ]
}

export type Selected =
  | { readonly _tag: "Patch"; readonly patch: string }
  | { readonly _tag: "Stale"; readonly reason: string }
  | { readonly _tag: "Unsupported"; readonly reason: string }

const wholeFileOnly =
  /^(new file mode|deleted file mode|old mode|new mode|similarity index|rename from|copy from|Binary files)/

export const selectLines = (
  patch: FilePatch,
  selections: ReadonlyArray<LineSelection>,
  direction: Direction,
): Selected => {
  if (patch.header.some((row) => wholeFileOnly.test(row))) {
    return { _tag: "Unsupported", reason: "Stage this file as a whole: it is new, deleted, renamed or binary." }
  }
  const wanted = new Map(selections.map((s) => [selectionKey(s.side, s.line), s.text]))
  const found = new Set<string>()
  const out: Array<string> = []
  let delta = 0

  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    const marked: Array<Marked> = []
    for (const line of hunk.lines) {
      const key =
        line.kind === "-" ? selectionKey("old", oldLine) : line.kind === "+" ? selectionKey("new", newLine) : null
      if (line.kind !== "+") oldLine++
      if (line.kind !== "-") newLine++
      const text = key === null ? undefined : wanted.get(key)
      if (key !== null && text !== undefined) {
        if (text !== line.text) return { _tag: "Stale", reason: "The file changed since you selected these lines." }
        found.add(key)
      }
      marked.push({ line, selected: key !== null && text !== undefined })
    }
    if (!marked.some((m) => m.selected)) continue

    const kept = blocks(marked).flatMap((block) =>
      block.context ? [block.lines[0]!.line] : rebuild(block.lines, direction),
    )
    const oldCount = kept.filter((l) => l.kind !== "+").length
    const newCount = kept.filter((l) => l.kind !== "-").length
    const originalOldCount = hunk.lines.filter((l) => l.kind !== "+").length
    const oldStart = oldCount === 0 && originalOldCount > 0 ? hunk.oldStart - 1 : hunk.oldStart
    const newStart = Math.max(0, oldStart + delta + (oldCount === 0 ? 1 : 0) - (newCount === 0 ? 1 : 0))
    delta += newCount - oldCount
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)
    for (const line of kept) {
      out.push(`${line.kind}${line.text}`)
      if (line.noNewline) out.push("\\ No newline at end of file")
    }
  }

  if (found.size !== wanted.size) return { _tag: "Stale", reason: "Some selected lines are no longer in the diff." }
  if (out.length === 0) return { _tag: "Stale", reason: "Nothing selected is still changed." }
  return { _tag: "Patch", patch: [...patch.header, ...out, ""].join("\n") }
}
