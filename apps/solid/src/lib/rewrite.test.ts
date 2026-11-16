import { Oid, type RewritePlan, type RewriteStep } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { initialSteps, isUnchanged, moveStep, stepProblems } from "./rewrite"

const oid = (name: string) => Oid.make(name.padEnd(40, "0"))

const plan: RewritePlan = {
  branch: "main",
  head: oid("c"),
  base: oid("0"),
  commits: [
    { oid: oid("a"), message: "First", published: false },
    { oid: oid("b"), message: "Second", published: false },
    { oid: oid("c"), message: "Third", published: false },
  ],
}

const step = (name: string, action: RewriteStep["action"], message = name): RewriteStep => ({
  oid: oid(name),
  action,
  message,
})

describe("moveStep", () => {
  it("moves a step to another position and keeps the rest in order", () => {
    const steps = initialSteps(plan)
    expect(moveStep(steps, 0, 2).map((entry) => entry.message)).toEqual(["Second", "Third", "First"])
    expect(moveStep(steps, 2, 1).map((entry) => entry.message)).toEqual(["First", "Third", "Second"])
  })

  it("leaves the plan alone when the target is outside it", () => {
    const steps = initialSteps(plan)
    expect(moveStep(steps, 0, -1)).toBe(steps)
    expect(moveStep(steps, 2, 3)).toBe(steps)
  })
})

describe("stepProblems", () => {
  it("rejects a squash or fixup with no kept commit above it", () => {
    const problems = stepProblems([step("a", "drop"), step("b", "fixup"), step("c", "squash")])
    expect([...problems.keys()]).toEqual([oid("b")])
  })

  it("accepts a squash under a kept commit", () => {
    expect(stepProblems([step("a", "pick"), step("b", "squash"), step("c", "fixup")]).size).toBe(0)
  })

  it("asks for a message when a reword is empty", () => {
    expect(stepProblems([step("a", "reword", "  \n")]).get(oid("a"))).toBe("Enter a commit message")
  })
})

describe("isUnchanged", () => {
  it("is true only while every commit is picked in its original order", () => {
    const steps = initialSteps(plan)
    expect(isUnchanged(plan, steps)).toBe(true)
    expect(isUnchanged(plan, moveStep(steps, 0, 1))).toBe(false)
    expect(isUnchanged(plan, [step("a", "drop"), ...steps.slice(1)])).toBe(false)
  })
})
