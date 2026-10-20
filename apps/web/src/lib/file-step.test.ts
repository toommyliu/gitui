import { describe, expect, it } from "vite-plus/test"
import { fileStepTarget } from "./file-step"

const COMMIT = [180, 1420, 2660]
const WORKING_COPY = [0, 1240, 2480]

describe("stepping between files in a diff", () => {
  it("goes to the first file when the commit summary above it is in view", () => {
    expect(fileStepTarget(COMMIT, 0, 1)).toBe(0)
    expect(fileStepTarget(COMMIT, 100, 1)).toBe(0)
  })

  it("stays put going back from above the first file", () => {
    expect(fileStepTarget(COMMIT, 0, -1)).toBe(null)
  })

  it("goes to the second file when the first file starts at the top", () => {
    expect(fileStepTarget(WORKING_COPY, 0, 1)).toBe(1)
    expect(fileStepTarget(COMMIT, 180, 1)).toBe(1)
  })

  it("stays put going back from the start of the first file", () => {
    expect(fileStepTarget(WORKING_COPY, 0, -1)).toBe(null)
    expect(fileStepTarget(COMMIT, 180, -1)).toBe(null)
  })

  it("moves from the middle of a file to the next file or back to its own start", () => {
    expect(fileStepTarget(COMMIT, 900, 1)).toBe(1)
    expect(fileStepTarget(COMMIT, 900, -1)).toBe(0)
  })

  it("treats a file within a pixel of the top as the current file", () => {
    expect(fileStepTarget(COMMIT, 1419, 1)).toBe(2)
    expect(fileStepTarget(COMMIT, 1421, -1)).toBe(0)
  })

  it("stays put going forward from the last file", () => {
    expect(fileStepTarget(COMMIT, 2660, 1)).toBe(null)
    expect(fileStepTarget(COMMIT, 3000, 1)).toBe(null)
  })

  it("does nothing without files", () => {
    expect(fileStepTarget([], 0, 1)).toBe(null)
  })

  it("steps through the only file of a single-file diff", () => {
    expect(fileStepTarget([0], 0, 1)).toBe(null)
    expect(fileStepTarget([0], 400, -1)).toBe(0)
  })
})
