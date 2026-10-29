import { type Change, type FileHistoryEntry, type FileHistory, Oid, type RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import { resolveRevision } from "./comparison.ts"
import type { Git } from "./git.ts"
import { decodeFileOutput, fileError, validateFilePath } from "./file-tree.ts"

const changes: Record<string, Change> = {
  A: "added",
  D: "deleted",
  M: "modified",
  T: "typechange",
  R: "renamed",
  C: "copied",
}

export const fileHistory = Effect.fn("File.history")(function* (
  git: Git["Service"],
  repo: RepoId,
  ref: string,
  path: RepoPath,
) {
  yield* validateFilePath(path)
  const revision = yield* resolveRevision(git, repo, ref)
  const raw = yield* git
    .run(repo, [
      "log",
      "--follow",
      "--format=%H%x00%P%x00%an%x00%at%x00%s",
      "-z",
      "--name-status",
      "-M",
      "-n",
      "501",
      revision,
      "--",
      path,
    ])
    .pipe(Effect.flatMap(decodeFileOutput))
  const tokens = raw.split("\0")
  const entries: FileHistoryEntry[] = []
  let i = 0
  let historicalPath = path
  while (i < tokens.length) {
    while (tokens[i] === "") i++
    if (i >= tokens.length) break
    const oid = tokens[i++]!
    const parents = tokens[i++] ?? ""
    const author = tokens[i++] ?? ""
    const time = Number(tokens[i++])
    const subject = tokens[i++] ?? ""
    if (!/^[0-9a-f]{40,64}$/.test(oid) || !Number.isFinite(time)) return yield* fileError("Couldn't read file history.")
    while (i < tokens.length) {
      const status = tokens[i]!.replace(/^\n/, "")
      if (!/^[AMDTRC][0-9]*$/.test(status)) break
      i++
      const first = RepoPath.make(tokens[i++] ?? "")
      const renamed = status[0] === "R" || status[0] === "C"
      const next = renamed ? RepoPath.make(tokens[i++] ?? "") : first
      if (next !== historicalPath) continue
      entries.push({
        oid: Oid.make(oid),
        parent: parents === "" ? null : Oid.make(parents.split(" ")[0]!),
        path: next,
        from: renamed ? first : null,
        change: changes[status[0]!] ?? "modified",
        author,
        time,
        subject,
      })
      if (renamed) historicalPath = first
    }
  }
  return { revision, path, entries: entries.slice(0, 500), truncated: entries.length > 500 } satisfies FileHistory
})
