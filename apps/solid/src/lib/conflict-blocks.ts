import type { ConflictDetail, ConflictFile } from "@gitui/contracts"

export interface Plain {
  readonly _tag: "Plain"
  readonly text: string
}

export interface Block {
  readonly _tag: "Block"
  readonly raw: string
  readonly ours: string
  readonly theirs: string
}

export type Segment = Plain | Block

export type Choice = "ours" | "theirs" | "both"

export type Choices = ReadonlyMap<number, Choice>

export const normalizeNewlines = (content: string) => content.replace(/\r\n/g, "\n")

const lineBody = (line: string) => line.replace(/\r?\n$/, "")

const marker = (char: string, size: number, labelled: boolean) =>
  new RegExp(`^\\${char}{${size}}${labelled ? "(?:[ \\t].*)?" : ""}$`)

const START = /^(<{7,})(?:[ \t].*)?$/

const parseBlock = (lines: ReadonlyArray<string>, start: number): { block: Block; end: number } | null => {
  const size = START.exec(lineBody(lines[start] ?? ""))?.[1]?.length
  if (size === undefined) return null
  const baseMarker = marker("|", size, true)
  const separator = marker("=", size, false)
  const closing = marker(">", size, true)
  const ours: Array<string> = []
  const theirs: Array<string> = []
  let section: "ours" | "base" | "theirs" = "ours"
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index] ?? ""
    const body = lineBody(line)
    if (section === "ours" && baseMarker.test(body)) section = "base"
    else if (section !== "theirs" && separator.test(body)) section = "theirs"
    else if (section === "theirs" && closing.test(body)) {
      const raw = lines.slice(start, index + 1).join("")
      return { block: { _tag: "Block", raw, ours: ours.join(""), theirs: theirs.join("") }, end: index }
    } else if (section === "ours") ours.push(line)
    else if (section === "theirs") theirs.push(line)
  }
  return null
}

const restoreFileEnding = (text: string, file: ConflictFile) => {
  if (file._tag !== "Text" || file.content.endsWith("\n") || !text.endsWith("\n")) return text
  const unterminated = text.slice(0, -1)
  return normalizeNewlines(file.content).endsWith(unterminated) ? unterminated : text
}

export const parseSegments = (
  content: string,
  sides?: Pick<ConflictDetail, "ours" | "theirs">,
): ReadonlyArray<Segment> => {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const segments: Array<Segment> = []
  let plain = ""
  const flush = () => {
    if (plain !== "") segments.push({ _tag: "Plain", text: plain })
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
      end === lines.length - 1 && sides !== undefined
        ? {
            ...block,
            ours: restoreFileEnding(block.ours, sides.ours),
            theirs: restoreFileEnding(block.theirs, sides.theirs),
          }
        : block,
    )
    index = end
  }
  flush()
  return segments
}

export const choiceText = (block: Block, choice: Choice) => {
  switch (choice) {
    case "ours":
      return block.ours
    case "theirs":
      return block.theirs
    case "both":
      return (
        block.ours + (block.ours !== "" && block.theirs !== "" && !block.ours.endsWith("\n") ? "\n" : "") + block.theirs
      )
  }
}

export const segmentText = (segment: Segment, choice: Choice | undefined) =>
  segment._tag === "Plain" ? segment.text : choice === undefined ? segment.raw : choiceText(segment, choice)

export const resultText = (segments: ReadonlyArray<Segment>, choices: Choices) =>
  segments.map((segment, index) => segmentText(segment, choices.get(index))).join("")

export const toDisplay = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text)

export const lineCount = (text: string) => (text === "" ? 0 : toDisplay(text).split("\n").length)
