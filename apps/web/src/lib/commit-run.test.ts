import { describe, expect, it } from "vite-plus/test"
import { appendLine, emptyOutput } from "./commit-run"

describe("commit output", () => {
  it("keeps each streamed line on its own line", () => {
    const output = appendLine(appendLine(emptyOutput, "lint passed"), "[main 1a2b3c4] fix: typo")
    expect(output).toEqual({ text: "lint passed\n[main 1a2b3c4] fix: typo\n", trimmed: false })
  })

  it("drops whole lines from the start once the limit is reached", () => {
    const output = ["one", "two", "three", "four"].reduce((all, line) => appendLine(all, line, 12), emptyOutput)
    expect(output).toEqual({ text: "three\nfour\n", trimmed: true })
  })

  it("keeps the tail of a single line longer than the limit", () => {
    expect(appendLine(emptyOutput, "abcdefghij", 6)).toEqual({ text: "fghij\n", trimmed: true })
  })
})
