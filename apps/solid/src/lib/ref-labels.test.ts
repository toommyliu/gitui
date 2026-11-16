import { Oid, type Refs } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { refLabels } from "./ref-labels"

const a = Oid.make("a".repeat(40))
const b = Oid.make("b".repeat(40))

const refs = (overrides: Partial<Refs>): Refs => ({
  branches: [],
  remoteBranches: [],
  tags: [],
  stashes: [],
  worktrees: [],
  remotes: [],
  ...overrides,
})

describe("refLabels", () => {
  it("puts the checked-out branch first and marks it current", () => {
    const labels = refLabels(
      refs({
        branches: [
          { name: "feature", oid: a, upstream: null },
          { name: "main", oid: a, upstream: null },
        ],
      }),
      { _tag: "Branch", name: "main", oid: a },
    )
    expect(labels.get(a)).toEqual([
      { kind: "branch", name: "main", current: true },
      { kind: "branch", name: "feature", current: false },
    ])
  })

  it("folds a remote branch into the local one when both point at the same commit", () => {
    const labels = refLabels(
      refs({
        branches: [{ name: "main", oid: a, upstream: null }],
        remoteBranches: [
          { remote: "origin", name: "origin/main", oid: a },
          { remote: "origin", name: "origin/feature", oid: b },
        ],
        tags: [{ name: "v1.0.0", oid: b }],
      }),
      { _tag: "Branch", name: "main", oid: a },
    )
    expect(labels.get(a)).toEqual([{ kind: "branch", name: "main", current: true }])
    expect(labels.get(b)).toEqual([
      { kind: "remote", name: "origin/feature" },
      { kind: "tag", name: "v1.0.0" },
    ])
  })

  it("labels a detached HEAD", () => {
    expect(refLabels(refs({}), { _tag: "Detached", oid: b }).get(b)).toEqual([{ kind: "head", name: "HEAD" }])
  })
})
