import { describe, expect, it } from "@effect/vitest"
import { ProgressSplitter, parseProgress } from "./progress.ts"

describe("ProgressSplitter", () => {
  it("reports every update but keeps only the last state of each overwritten line", () => {
    const splitter = new ProgressSplitter()
    const updates = [
      ...splitter.push("Receiving objects:  50% (1/2)\rReceiving obj"),
      ...splitter.push("ects: 100% (2/2), done.\r\nremote: Total 2\n"),
      ...splitter.push("error: rejected"),
      ...splitter.flush(),
    ]
    expect(updates).toEqual([
      "Receiving objects:  50% (1/2)",
      "Receiving objects: 100% (2/2), done.",
      "remote: Total 2",
      "error: rejected",
    ])
    expect(splitter.transcript).toBe("Receiving objects: 100% (2/2), done.\nremote: Total 2\nerror: rejected")
  })
})

describe("parseProgress", () => {
  it("takes the last percentage on the line", () => {
    expect(parseProgress("remote: Compressing objects:  37% (3/8)")).toEqual({
      line: "remote: Compressing objects:  37% (3/8)",
      percent: 37,
    })
    expect(parseProgress("From github.com:a/b").percent).toBe(null)
  })
})
