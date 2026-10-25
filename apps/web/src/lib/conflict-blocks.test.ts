import type { ConflictDetail } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import {
  type Block,
  blockState,
  choiceText,
  fromDisplay,
  joinSegments,
  lineCount,
  normalizeNewlines,
  parseSegments,
  type Segment,
  toDisplay,
  withText,
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

describe("splitting a conflicted file into blocks", () => {
  it("finds every block between the shared lines", () => {
    const segments = parseSegments(twoBlocks)
    expect(segments.map((s) => s._tag)).toEqual(["Plain", "Block", "Plain", "Block"])
    expect(segments[0]!.text).toBe("# Merge demo\n\n")
    expect(segments[2]!.text).toBe("shared line\n")
    const [first, second] = blocks(segments)
    expect(first).toMatchObject({
      ours: "Theme: dark\nSync interval: 10 minutes\n",
      theirs: "Theme: light\nSync interval: 5 minutes\n",
      base: null,
      labels: { ours: "HEAD", base: null, theirs: "feature" },
    })
    expect(second).toMatchObject({ ours: "", theirs: "only theirs\n" })
  })

  it("joins back to the exact file it came from", () => {
    expect(joinSegments(parseSegments(twoBlocks))).toBe(twoBlocks)
  })

  it("reads the base section that diff3 writes", () => {
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
    const [block] = blocks(parseSegments(content))
    expect(block).toMatchObject({
      ours: "Theme: dark\n",
      base: "Theme: system\n",
      theirs: "Theme: light\n",
      labels: { ours: "HEAD", base: "f5319c3", theirs: "feature" },
    })
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
    expect(block!.ours).toBe("=======\nkept as text\n")
    expect(block!.theirs).toBe("theirs\n>>>>>>> not the end\n")
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
    expect(blocks(segments)[0]!.theirs).toBe("c\n")
  })

  it("leaves a block with no end marker as plain text", () => {
    const content = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n"
    const segments = parseSegments(content)
    expect(segments).toEqual([{ _tag: "Plain", original: content, text: content }])
  })

  it("reads a file whose last line is the end marker with no newline", () => {
    const content = "<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> topic"
    const segments = parseSegments(content)
    expect(blocks(segments)[0]!.labels.theirs).toBe("topic")
    expect(joinSegments(segments)).toBe(content)
  })

  it("gives an empty file one empty segment to type into", () => {
    expect(parseSegments("")).toEqual([{ _tag: "Plain", original: "", text: "" }])
  })

  it("reads Windows line endings once they're normalized", () => {
    const content = normalizeNewlines("x\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> topic\r\n")
    expect(blocks(parseSegments(content))[0]!.ours).toBe("mine\n")
  })
})

describe("resolving a block", () => {
  const resolve = (content: string, index: number, choice: Parameters<typeof choiceText>[1]) => {
    const segments = parseSegments(content)
    const target = segments[index] as Block
    return joinSegments(withText(segments, index, choiceText(target, choice)!))
  }

  it("takes one side and leaves the other blocks alone", () => {
    expect(resolve(twoBlocks, 1, "theirs")).toBe(
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

  it("puts mine above theirs when keeping both", () => {
    expect(resolve(twoBlocks, 3, "both")).toBe(
      [
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
        "only theirs",
        "",
      ].join("\n"),
    )
  })

  it("has no base to take without diff3 markers", () => {
    expect(choiceText(blocks(parseSegments(twoBlocks))[0]!, "base")).toBeNull()
  })

  it("brings the markers back on reset", () => {
    const segments = parseSegments(twoBlocks)
    const taken = withText(segments, 1, "edited\n")
    const block = taken[1] as Block
    expect(joinSegments(withText(taken, 1, choiceText(block, "reset")!))).toBe(twoBlocks)
  })

  it("names what a block holds now", () => {
    const block = blocks(parseSegments(twoBlocks))[0]!
    expect(blockState(block)).toBe("unresolved")
    expect(blockState({ ...block, text: block.ours })).toBe("ours")
    expect(blockState({ ...block, text: block.theirs })).toBe("theirs")
    expect(blockState({ ...block, text: block.ours + block.theirs })).toBe("both")
    expect(blockState({ ...block, text: "Theme: auto\n" })).toBe("edited")
    expect(blockState({ ...block, text: `x\n${block.raw}` })).toBe("unresolved")
  })
})

describe("preserving file endings when resolving Git's markers", () => {
  const markers = "<<<<<<< HEAD\nmine\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> topic\n"
  const versions = (ours: string, base: string, theirs: string): Pick<ConflictDetail, "ours" | "base" | "theirs"> => ({
    ours: { _tag: "Text", content: ours },
    base: { _tag: "Text", content: base },
    theirs: { _tag: "Text", content: theirs },
  })

  it("keeps each side's missing final newline, including base and both", () => {
    const [block] = blocks(parseSegments(markers, versions("mine", "base", "theirs")))
    expect(choiceText(block!, "ours")).toBe("mine")
    expect(choiceText(block!, "theirs")).toBe("theirs")
    expect(choiceText(block!, "base")).toBe("base")
    expect(choiceText(block!, "both")).toBe("mine\ntheirs")
    expect(blockState({ ...block!, text: "mine\ntheirs" })).toBe("both")
    expect(fromDisplay("edited mine", { ...block!, text: "mine" })).toBe("edited mine")
  })

  it("preserves different final-newline choices on the two sides", () => {
    const [block] = blocks(parseSegments(markers, versions("mine", "base\n", "theirs\n")))
    expect(choiceText(block!, "ours")).toBe("mine")
    expect(choiceText(block!, "theirs")).toBe("theirs\n")
    expect(choiceText(block!, "base")).toBe("base\n")
    expect(choiceText(block!, "both")).toBe("mine\ntheirs\n")
  })

  it("keeps the separator after a conflict that is not at the end of the file", () => {
    const segments = parseSegments(`${markers}shared`, versions("mine\nshared", "base\nshared", "theirs\nshared"))
    const [block] = blocks(segments)
    expect(joinSegments(withText(segments, 0, choiceText(block!, "ours")!))).toBe("mine\nshared")
  })

  it("preserves CRLF content after newline normalization", () => {
    const [block] = blocks(
      parseSegments(`first\n${markers}`, versions("first\r\nmine", "first\r\nbase", "first\r\ntheirs")),
    )
    expect(choiceText(block!, "ours")).toBe("mine")
    expect(choiceText(block!, "theirs")).toBe("theirs")
  })
})

describe("showing a segment in a text box", () => {
  const [first, block] = parseSegments(twoBlocks)

  it("drops the newline that ends the segment and adds it back after editing", () => {
    expect(toDisplay(first!.text)).toBe("# Merge demo\n")
    expect(fromDisplay("# Merge demo\nadded", first!)).toBe("# Merge demo\nadded\n")
  })

  it("removes every line when the box is emptied", () => {
    expect(fromDisplay("", block!)).toBe("")
    expect(lineCount("")).toBe(0)
  })

  it("leaves the file's last line without a newline if it had none", () => {
    const last = parseSegments("a\nb")[0]!
    expect(fromDisplay("a\nc", last)).toBe("a\nc")
    expect(lineCount("a\nb")).toBe(2)
  })
})
