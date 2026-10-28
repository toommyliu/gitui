import { type Comparison, GitError, Oid, type RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import { parseFileChanges } from "./commit.ts"
import type { Git } from "./git.ts"

export const resolveRevision = Effect.fn("Comparison.resolveRevision")(function* (
  git: Git["Service"],
  repo: RepoId,
  ref: string,
  object: "commit" | "tree" = "commit",
) {
  if (ref.trim() === "" || ref.includes("\0"))
    return yield* new GitError({ args: [], exitCode: -1, stderr: "Enter a branch, tag or commit SHA." })
  const resolved = yield* git.text(repo, ["rev-parse", "--verify", "--end-of-options", `${ref}^{${object}}`])
  return Oid.make(resolved.trim())
})

export const makeComparison = (git: Git["Service"]) =>
  Effect.fn("Repo.comparison")(function* (repo: RepoId, comparison: Comparison) {
    const [base, head] = yield* Effect.all([
      resolveRevision(git, repo, comparison.base),
      resolveRevision(git, repo, comparison.head),
    ])
    let start = base
    if (comparison.mode === "merge-base") {
      start = Oid.make((yield* git.text(repo, ["merge-base", base, head])).trim())
    } else if (comparison.mode === "range") {
      const parents = (yield* git.text(repo, ["rev-list", "--parents", "-n", "1", base])).trim().split(" ")
      start = Oid.make(
        parents[1] ??
          (yield* git.text(repo, ["hash-object", "-t", "tree", "--stdin"], { stdin: new Uint8Array() })).trim(),
      )
    }
    const files = parseFileChanges(
      yield* git.run(repo, [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "-r",
        "-z",
        "-M",
        "--raw",
        "--numstat",
        start,
        head,
        "--",
      ]),
    )
    return { base, head, start, files }
  })
