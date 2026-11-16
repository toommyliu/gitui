import type { Oid, RewriteAction, RewritePlan, RewriteStep } from "@gitui/contracts"

export const rewriteActions: Record<RewriteAction, { readonly label: string; readonly hint: string }> = {
  pick: { label: "Pick", hint: "Keep the commit as it is" },
  reword: { label: "Reword", hint: "Keep the changes, edit the message" },
  edit: { label: "Edit", hint: "Pause here to amend or split the commit" },
  squash: { label: "Squash", hint: "Meld into the commit above, keep both messages" },
  fixup: { label: "Fixup", hint: "Meld into the commit above, drop this message" },
  drop: { label: "Drop", hint: "Remove the commit and its changes" },
}

export const initialSteps = (plan: RewritePlan): Array<RewriteStep> =>
  plan.commits.map((commit) => ({ oid: commit.oid, action: "pick", message: commit.message }))

export const moveStep = (steps: ReadonlyArray<RewriteStep>, from: number, to: number): ReadonlyArray<RewriteStep> => {
  const step = steps[from]
  if (step === undefined || to < 0 || to >= steps.length || from === to) return steps
  const next = steps.filter((_, index) => index !== from)
  next.splice(to, 0, step)
  return next
}

export const stepProblems = (steps: ReadonlyArray<RewriteStep>): ReadonlyMap<Oid, string> => {
  const problems = new Map<Oid, string>()
  let kept = false
  for (const step of steps) {
    if (step.action === "drop") continue
    if ((step.action === "squash" || step.action === "fixup") && !kept)
      problems.set(step.oid, "Needs a kept commit above it to meld into")
    if (step.action === "reword" && step.message.trim() === "") problems.set(step.oid, "Enter a commit message")
    kept = true
  }
  return problems
}

export const isUnchanged = (plan: RewritePlan, steps: ReadonlyArray<RewriteStep>) =>
  steps.every((step, index) => step.action === "pick" && plan.commits[index]?.oid === step.oid)
