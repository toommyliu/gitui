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
  it("streams every line while retaining only the diagnostic tail", () => {
    const splitter = new ProgressSplitter(16)
    expect(splitter.push("old diagnostics\nlast error\n")).toEqual(["old diagnostics", "last error"])
    expect(splitter.transcript).toBe("stics\nlast error")
  })

  it("can stream stdout without retaining its transcript", () => {
    const splitter = new ProgressSplitter(0)
    expect(splitter.push("hook started\nhook passed\n")).toEqual(["hook started", "hook passed"])
    expect(splitter.transcript).toBe("")
  })

  it("omits oversized lines and resumes at the next line", () => {
    const splitter = new ProgressSplitter()
    splitter.push("x".repeat(1_000_000))
    expect(splitter.push("\nlast error\n")).toEqual(["[Output line omitted: too long]", "last error"])
    expect(splitter.transcript).toBe("[Output line omitted: too long]\nlast error")
  })

  it("redacts credentials before trimming the retained diagnostic tail", () => {
    const splitter = new ProgressSplitter(8, (line) => line.replaceAll("fake-password", "[redacted]"))
    splitter.push("fake-password\n")
    expect(splitter.transcript).toBe("edacted]")
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
