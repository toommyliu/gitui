import type { FileDiffMetadata, SelectionSide } from "@pierre/diffs"

export interface DiffLocation {
  readonly id: string
  readonly lineNumber: number
  readonly side: SelectionSide
}

export interface DiffMatch extends DiffLocation {
  readonly start: number
  readonly end: number
}

type SearchItem = { readonly id: string; readonly fileDiff: FileDiffMetadata }
type FileName = { readonly path: string; readonly from?: string | null }

export const matchesFileName = (path: string, query: string, from?: string | null): boolean => {
  const needle = query.trim().toLowerCase()
  return path.toLowerCase().includes(needle) || (from?.toLowerCase().includes(needle) ?? false)
}

export const filterFiles = <F extends FileName>(files: ReadonlyArray<F>, query: string): ReadonlyArray<F> =>
  query.trim() === "" ? files : files.filter((file) => matchesFileName(file.path, query, file.from))

export const diffMatches = (items: ReadonlyArray<SearchItem>, query: string): ReadonlyArray<DiffMatch> => {
  if (query === "") return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
  const matches: Array<DiffMatch> = []
  for (const { id, fileDiff } of items) {
    const scan = (text: string, lineNumber: number, side: SelectionSide) => {
      for (const match of text.replace(/\r?\n$/, "").matchAll(pattern)) {
        matches.push({ id, lineNumber, side, start: match.index, end: match.index + match[0].length })
      }
    }
    for (const hunk of fileDiff.hunks) {
      let oldLine = hunk.deletionStart
      let newLine = hunk.additionStart
      for (const content of hunk.hunkContent) {
        if (content.type === "context") {
          for (let i = 0; i < content.lines; i++) {
            scan(fileDiff.additionLines[content.additionLineIndex + i] ?? "", newLine++, "additions")
            oldLine++
          }
        } else {
          for (let i = 0; i < content.deletions; i++) {
            scan(fileDiff.deletionLines[content.deletionLineIndex + i] ?? "", oldLine++, "deletions")
          }
          for (let i = 0; i < content.additions; i++) {
            scan(fileDiff.additionLines[content.additionLineIndex + i] ?? "", newLine++, "additions")
          }
        }
      }
    }
  }
  return matches
}

export const hunkLocations = (items: ReadonlyArray<SearchItem>): ReadonlyArray<DiffLocation> =>
  items.flatMap(({ id, fileDiff }) =>
    fileDiff.hunks.map((hunk) =>
      hunk.additionCount > 0
        ? { id, lineNumber: hunk.additionStart, side: "additions" as const }
        : { id, lineNumber: hunk.deletionStart, side: "deletions" as const },
    ),
  )

export const stepMatch = (count: number, current: number | null, delta: 1 | -1): number | null =>
  count === 0 ? null : current === null ? (delta === 1 ? 0 : count - 1) : (current + delta + count) % count
