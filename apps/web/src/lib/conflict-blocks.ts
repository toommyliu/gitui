import type { ConflictDetail, ConflictFile } from "@gitui/contracts"
import { conflictMarkers } from "./conflicts"

export interface Plain {
  readonly _tag: "Plain"
  readonly original: string
  readonly text: string
}

export interface Block {
  readonly _tag: "Block"
  readonly raw: string
  readonly ours: string
  readonly base: string | null
  readonly theirs: string
  readonly labels: { readonly ours: string; readonly base: string | null; readonly theirs: string }
  readonly text: string
}

export type Segment = Plain | Block

export type Choice = "ours" | "theirs" | "both" | "base" | "reset"

export type BlockState = "unresolved" | "ours" | "theirs" | "both" | "base" | "edited"

export const normalizeNewlines = (content: string) => content.replace(/\r\n/g, "\n")

const lineBody = (line: string) => line.replace(/\r?\n$/, "")

const marker = (char: string, size: number, labelled: boolean) =>
  new RegExp(`^\\${char}{${size}}${labelled ? "(?:[ \\t](.*))?" : ""}$`)

const START = /^(<{7,})(?:[ \t](.*))?$/

const parseBlock = (lines: ReadonlyArray<string>, start: number): { block: Block; end: number } | null => {
  const opening = START.exec(lineBody(lines[start]!))
  if (opening === null) return null
  const size = opening[1]!.length
  const baseMarker = marker("|", size, true)
  const separator = marker("=", size, false)
  const closing = marker(">", size, true)
  const ours: Array<string> = []
  const theirs: Array<string> = []
  let base: Array<string> | null = null
  let baseLabel: string | null = null
  let section: "ours" | "base" | "theirs" = "ours"
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!
    const body = lineBody(line)
    if (section === "ours" && baseMarker.test(body)) {
      section = "base"
      base = []
      baseLabel = baseMarker.exec(body)![1] ?? ""
    } else if (section !== "theirs" && separator.test(body)) {
      section = "theirs"
    } else if (section === "theirs" && closing.test(body)) {
      const raw = lines.slice(start, index + 1).join("")
      return {
        block: {
          _tag: "Block",
          raw,
          ours: ours.join(""),
          base: base === null ? null : base.join(""),
          theirs: theirs.join(""),
          labels: { ours: opening[2] ?? "", base: baseLabel, theirs: closing.exec(body)![1] ?? "" },
          text: raw,
        },
        end: index,
      }
    } else if (section === "ours") ours.push(line)
    else if (section === "base") base!.push(line)
    else theirs.push(line)
  }
  return null
}

const restoreFileEnding = (text: string, file: ConflictFile | undefined) => {
  if (file?._tag !== "Text" || file.content.endsWith("\n") || !text.endsWith("\n")) return text
  const unterminated = text.slice(0, -1)
  return normalizeNewlines(file.content).endsWith(unterminated) ? unterminated : text
}

export const parseSegments = (
  content: string,
  sides?: Pick<ConflictDetail, "base" | "ours" | "theirs">,
): ReadonlyArray<Segment> => {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const segments: Array<Segment> = []
  let plain = ""
  const flush = () => {
    if (plain !== "") segments.push({ _tag: "Plain", original: plain, text: plain })
    plain = ""
  }
  for (let index = 0; index < lines.length; index++) {
    const parsed = parseBlock(lines, index)
    if (parsed === null) {
      plain += lines[index]
      continue
    }
    flush()
    const { block, end } = parsed
    segments.push(
      end === lines.length - 1
        ? {
            ...block,
            ours: restoreFileEnding(block.ours, sides?.ours),
            theirs: restoreFileEnding(block.theirs, sides?.theirs),
            base: block.base === null ? null : restoreFileEnding(block.base, sides?.base),
          }
        : block,
    )
    index = parsed.end
  }
  flush()
  return segments.length === 0 ? [{ _tag: "Plain", original: "", text: "" }] : segments
}

export const joinSegments = (segments: ReadonlyArray<Segment>) => segments.map((segment) => segment.text).join("")

export const choiceText = (block: Block, choice: Choice): string | null => {
  switch (choice) {
    case "ours":
      return block.ours
    case "theirs":
      return block.theirs
    case "both":
      return (
        block.ours + (block.ours !== "" && block.theirs !== "" && !block.ours.endsWith("\n") ? "\n" : "") + block.theirs
      )
    case "base":
      return block.base
    case "reset":
      return block.raw
  }
}

export const blockState = (block: Block): BlockState => {
  if (conflictMarkers(block.text) > 0) return "unresolved"
  if (block.text === block.ours) return "ours"
  if (block.text === block.theirs) return "theirs"
  if (block.text === choiceText(block, "both")) return "both"
  if (block.text === block.base) return "base"
  return "edited"
}

export const terminated = (segment: Segment) =>
  (segment.text === "" ? (segment._tag === "Plain" ? segment.original : segment.raw) : segment.text).endsWith("\n")

export const toDisplay = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text)

export const fromDisplay = (value: string, segment: Segment) =>
  value === "" ? "" : terminated(segment) ? `${value}\n` : value

export const lineCount = (text: string) => (text === "" ? 0 : toDisplay(text).split("\n").length)

export const withText = (segments: ReadonlyArray<Segment>, index: number, text: string): ReadonlyArray<Segment> =>
  segments.map((segment, i) => (i === index ? { ...segment, text } : segment))
