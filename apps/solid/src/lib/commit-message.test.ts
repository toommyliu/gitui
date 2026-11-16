import { describe, expect, it } from "vite-plus/test"
import { joinMessage, splitMessage } from "./commit-message"

describe("commit message fields", () => {
  it("splits the summary from the description after the blank line", () => {
    expect(splitMessage("Fix the thing\n\nIt was broken.\nNow it isn't.")).toEqual({
      summary: "Fix the thing",
      description: "It was broken.\nNow it isn't.",
    })
  })

  it("treats a description with no blank line before it as the description", () => {
    expect(splitMessage("Fix\nmore")).toEqual({ summary: "Fix", description: "more" })
  })

  it("round-trips what the user types, including leading newlines and spaces", () => {
    for (const [summary, description] of [
      ["Fix", ""],
      ["Fix", " "],
      ["Fix", "\nindented"],
      ["", "only a description"],
    ] as const) {
      expect(splitMessage(joinMessage(summary, description))).toEqual({ summary, description })
    }
  })
})
