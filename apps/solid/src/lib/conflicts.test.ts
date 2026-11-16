import { type ConflictRef, Oid } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { describeConflict, describeFile, operationTitle, refLabel } from "./conflicts"

const ref = (name: string | null, subject = "Use the light theme"): ConflictRef => ({
  name,
  oid: Oid.make("0123456789abcdef0123456789abcdef01234567"),
  subject,
})

describe("naming an operation", () => {
  it("names the branch being rebased and the branch it lands on", () => {
    expect(operationTitle("rebase", { ours: ref("main"), theirs: ref("feature~1") })).toBe("Rebasing feature onto main")
  })

  it("leaves out a side that no branch points at", () => {
    expect(operationTitle("rebase", { ours: ref(null), theirs: ref("feature") })).toBe("Rebasing feature")
  })

  it("names both branches of a merge", () => {
    expect(operationTitle("merge", { ours: ref("main"), theirs: ref("feature") })).toBe("Merging feature into main")
  })

  it("quotes the commit being cherry-picked", () => {
    expect(operationTitle("cherry-pick", { ours: ref("main"), theirs: ref(null, "Fix the parser") })).toBe(
      "Cherry-picking “Fix the parser”",
    )
  })

  it("falls back to the operation when the sides are unknown", () => {
    expect(operationTitle("merge", { ours: null, theirs: null })).toBe("Merging")
    expect(operationTitle(null, { ours: null, theirs: null })).toBe("Conflicts")
  })
})

describe("labelling a side", () => {
  it("shows the branch without its ancestry suffix", () => {
    expect(refLabel(ref("feature~2^2"))).toBe("feature")
  })

  it("shows a short hash when no branch points at the commit", () => {
    expect(refLabel(ref(null))).toBe("0123456")
  })
})

describe("describing a conflict", () => {
  it("says which side deleted the file", () => {
    expect(describeConflict("DU")).toBe("Deleted in ours, changed in theirs")
    expect(describeConflict("UD")).toBe("Changed in ours, deleted in theirs")
  })

  it("describes each side's file", () => {
    expect(describeFile({ _tag: "Binary", bytes: 2048 })).toBe("Binary, 2.0 KB")
    expect(describeFile({ _tag: "Missing" })).toBe("Deleted")
    expect(describeFile({ _tag: "Text", content: "a\nb\n" })).toBe("Text, 2 lines")
  })
})
