import type { ConflictDetail } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import {
  type Block,
  type Choice,
  choiceText,
  lineCount,
  normalizeNewlines,
  parseSegments,
  resultText,
  type Segment,
  toDisplay,
} from "./conflict-blocks"

const twoBlocks = [
  "# Merge demo",
  "",
  "<<<<<<< HEAD",
  "Theme: dark",
  "Sync interval: 10 minutes",
  "=======",
  "Theme: light",
  "Sync interval: 5 minutes",
  ">>>>>>> feature",
  "shared line",
  "<<<<<<< HEAD",
  "=======",
  "only theirs",
  ">>>>>>> feature",
  "",
].join("\n")

const blocks = (segments: ReadonlyArray<Segment>) => segments.filter((s): s is Block => s._tag === "Block")

const resolve = (content: string, choices: ReadonlyArray<[number, Choice]>) =>
  resultText(parseSegments(content), new Map(choices))

describe("splitting a conflicted file into blocks", () => {
  it("finds every block between the shared lines", () => {
    const segments = parseSegments(twoBlocks)
    expect(segments.map((s) => s._tag)).toEqual(["Plain", "Block", "Plain", "Block"])
    expect(segments[0]).toEqual({ _tag: "Plain", text: "# Merge demo\n\n" })
    expect(segments[2]).toEqual({ _tag: "Plain", text: "shared line\n" })
    const [first, second] = blocks(segments)
    expect(first).toMatchObject({
      ours: "Theme: dark\nSync interval: 10 minutes\n",
      theirs: "Theme: light\nSync interval: 5 minutes\n",
    })
    expect(second).toMatchObject({ ours: "", theirs: "only theirs\n" })
  })

  it("joins back to the exact file it came from while no block is resolved", () => {
    expect(resolve(twoBlocks, [])).toBe(twoBlocks)
  })

  it("leaves the base section that diff3 writes out of both sides", () => {
    const content = [
      "<<<<<<< HEAD",
      "Theme: dark",
      "||||||| f5319c3",
      "Theme: system",
      "=======",
      "Theme: light",
      ">>>>>>> feature",
      "",
    ].join("\n")
    expect(blocks(parseSegments(content))[0]).toMatchObject({ ours: "Theme: dark\n", theirs: "Theme: light\n" })
  })

  it("matches markers by the length conflict-marker-size sets", () => {
    const content = [
      "<<<<<<<<<< HEAD",
      "=======",
      "kept as text",
      "==========",
      "theirs",
      ">>>>>>> not the end",
      ">>>>>>>>>> topic",
      "",
    ].join("\n")
    const [block] = blocks(parseSegments(content))
    expect(block?.ours).toBe("=======\nkept as text\n")
    expect(block?.theirs).toBe("theirs\n>>>>>>> not the end\n")
  })

  it("keeps a recursive merge's inner markers inside the outer block", () => {
    const content = [
      "<<<<<<<<< HEAD",
      "<<<<<<< Temporary merge branch 1",
      "a",
      "=======",
      "b",
      ">>>>>>> Temporary merge branch 2",
      "=========",
      "c",
      ">>>>>>>>> topic",
      "",
    ].join("\n")
    const segments = parseSegments(content)
    expect(segments).toHaveLength(1)
    expect(blocks(segments)[0]?.theirs).toBe("c\n")
  })

  it("leaves a block with no end marker as plain text", () => {
    const content = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n"
    expect(parseSegments(content)).toEqual([{ _tag: "Plain", text: content }])
  })

  it("reads a file whose last line is the end marker with no newline", () => {
    const content = "<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> topic"
    expect(resolve(content, [])).toBe(content)
    expect(resolve(content, [[0, "theirs"]])).toBe("theirs\n")
  })

  it("has no segments for an empty file", () => {
    expect(parseSegments("")).toEqual([])
  })

  it("reads Windows line endings once they're normalized", () => {
    const content = normalizeNewlines("x\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> topic\r\n")
    expect(blocks(parseSegments(content))[0]?.ours).toBe("mine\n")
  })
})

describe("resolving blocks", () => {
  it("takes one side and leaves the other blocks alone", () => {
    expect(resolve(twoBlocks, [[1, "theirs"]])).toBe(
      [
        "# Merge demo",
        "",
        "Theme: light",
        "Sync interval: 5 minutes",
        "shared line",
        "<<<<<<< HEAD",
        "=======",
        "only theirs",
        ">>>>>>> feature",
        "",
      ].join("\n"),
    )
  })

  it("puts ours above theirs when keeping both", () => {
    expect(
      resolve(twoBlocks, [
        [1, "ours"],
        [3, "both"],
      ]),
    ).toBe(
      ["# Merge demo", "", "Theme: dark", "Sync interval: 10 minutes", "shared line", "only theirs", ""].join("\n"),
    )
  })
})

describe("preserving file endings when resolving Git's markers", () => {
  const markers = "<<<<<<< HEAD\nmine\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> topic\n"
  const versions = (ours: string, theirs: string): Pick<ConflictDetail, "ours" | "theirs"> => ({
    ours: { _tag: "Text", content: ours },
    theirs: { _tag: "Text", content: theirs },
  })

  it("keeps each side's missing final newline, including both", () => {
    const [block] = blocks(parseSegments(markers, versions("mine", "theirs")))
    if (block === undefined) throw new Error("expected a block")
    expect(choiceText(block, "ours")).toBe("mine")
    expect(choiceText(block, "theirs")).toBe("theirs")
    expect(choiceText(block, "both")).toBe("mine\ntheirs")
  })

  it("preserves different final-newline choices on the two sides", () => {
    const [block] = blocks(parseSegments(markers, versions("mine", "theirs\n")))
    if (block === undefined) throw new Error("expected a block")
    expect(choiceText(block, "ours")).toBe("mine")
    expect(choiceText(block, "theirs")).toBe("theirs\n")
    expect(choiceText(block, "both")).toBe("mine\ntheirs\n")
  })

  it("keeps the separator after a conflict that is not at the end of the file", () => {
    const segments = parseSegments(`${markers}shared`, versions("mine\nshared", "theirs\nshared"))
    expect(resultText(segments, new Map([[0, "ours"]]))).toBe("mine\nshared")
  })

  it("preserves CRLF content after newline normalization", () => {
    const [block] = blocks(parseSegments(`first\n${markers}`, versions("first\r\nmine", "first\r\ntheirs")))
    if (block === undefined) throw new Error("expected a block")
    expect(choiceText(block, "ours")).toBe("mine")
    expect(choiceText(block, "theirs")).toBe("theirs")
  })
})

describe("showing a segment as lines", () => {
  it("drops the newline that ends the segment", () => {
    expect(toDisplay("# Merge demo\n\n")).toBe("# Merge demo\n")
  })

  it("counts lines with or without a final newline", () => {
    expect(lineCount("")).toBe(0)
    expect(lineCount("a\nb")).toBe(2)
    expect(lineCount("a\nb\n")).toBe(2)
  })
})
