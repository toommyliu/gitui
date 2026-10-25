import type { ConflictFile } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { conflictMarkers, describeConflict, keepLabels, sideChange, sideNames } from "./conflicts"

const text = (content: string): ConflictFile => ({ _tag: "Text", content })
const missing: ConflictFile = { _tag: "Missing" }

describe("naming the sides of a conflict", () => {
  it("calls the upstream side ours during a rebase", () => {
    expect(describeConflict("DU", sideNames("rebase"))).toBe("Deleted in upstream, changed in my commit")
  })

  it("describes a file the incoming branch deleted during a merge", () => {
    expect(describeConflict("UD", sideNames("merge"))).toBe("Changed in mine, deleted in theirs")
  })

  it("falls back to ours and theirs with no operation in progress", () => {
    expect(describeConflict("UA", sideNames(null))).toBe("Added in theirs")
  })

  it("offers both sides of a conflict left by applying a stash", () => {
    expect(keepLabels(null)).toEqual({ ours: "Keep ours", theirs: "Take theirs" })
  })

  it("keeps my commit as theirs during a rebase", () => {
    expect(keepLabels("rebase")).toEqual({ ours: "Keep upstream", theirs: "Keep my commit" })
  })
})

describe("counting conflict markers", () => {
  it("counts each conflict once, including diff3 output", () => {
    const content = [
      "a",
      "<<<<<<< HEAD",
      "mine",
      "||||||| base",
      "base",
      "=======",
      "theirs",
      ">>>>>>> topic",
      "<<<<<<< HEAD",
      "=======",
      ">>>>>>> topic",
    ].join("\n")
    expect(conflictMarkers(content)).toBe(2)
  })

  it("counts markers made longer by conflict-marker-size", () => {
    const content = ["<<<<<<<<<< HEAD", "mine", "==========", "theirs", ">>>>>>>>>> topic", ""].join("\n")
    expect(conflictMarkers(content)).toBe(1)
  })

  it("ignores angle brackets that don't start a line", () => {
    expect(conflictMarkers('const marker = "<<<<<<< HEAD"\nx <<<<<<<<= 1\n')).toBe(0)
  })

  it("ignores runs of angle brackets that run into other text", () => {
    expect(conflictMarkers("<<<<<<<<<<html>\n")).toBe(0)
  })

  it("counts markers in files with Windows line endings", () => {
    expect(conflictMarkers("<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> topic\r\n")).toBe(1)
  })
})

describe("comparing a side with the base", () => {
  it("reports what each side did to the file", () => {
    expect(sideChange(text("a"), missing)).toBe("deleted")
    expect(sideChange(missing, text("a"))).toBe("added")
    expect(sideChange(missing, missing)).toBe("absent")
    expect(sideChange(text("a"), text("a"))).toBe("unchanged")
    expect(sideChange(text("a"), text("b"))).toBe("changed")
    expect(sideChange(text("a"), { _tag: "Binary", bytes: 10 })).toBe("binary")
  })
})
