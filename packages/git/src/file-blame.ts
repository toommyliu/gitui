import { type FileBlame, type GitError, Oid, type RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import type { Git } from "./git.ts"
import { decodeFileOutput, fileError, fileRevision } from "./file-tree.ts"

const unquotePath = (path: string) => {
  if (!path.startsWith('"')) return path
  const bytes: number[] = []
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 }
  for (let i = 1; i < path.length - 1; i++) {
    if (path[i] !== "\\") {
      bytes.push(path.charCodeAt(i))
      continue
    }
    i++
    const octal = path.slice(i, i + 3)
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8))
      i += 2
    } else bytes.push(escapes[path[i]!] ?? path.charCodeAt(i))
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes))
}

export const fileBlame = Effect.fn("File.blame")(function* (
  git: Git["Service"],
  repo: RepoId,
  ref: string,
  path: RepoPath,
): Effect.fn.Return<FileBlame, GitError> {
  const file = yield* fileRevision(git, repo, ref, path)
  if (file.content._tag !== "Text")
    return {
      _tag: "Unavailable",
      reason: "Blame is available for UTF-8 text files up to 1 MiB. Select a text revision of this file.",
    }
  if (file.content.content.split("\n").length > 20000)
    return { _tag: "Unavailable", reason: "This file has more than 20,000 lines. Use git blame from the command line." }
  const raw = yield* git
    .run(repo, ["-c", "core.quotePath=true", "blame", "--line-porcelain", "--no-textconv", file.revision, "--", path])
    .pipe(Effect.flatMap(decodeFileOutput))
  const rows = raw.split("\n")
  const lines: Extract<FileBlame, { _tag: "Lines" }>["lines"][number][] = []
  let i = 0
  while (i < rows.length && rows[i] !== "") {
    const header = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(rows[i++]!)
    if (header === null) return yield* fileError("Couldn't read blame information.")
    let author = "",
      time = 0,
      subject = "",
      originalPath = path
    while (i < rows.length && !rows[i]!.startsWith("\t")) {
      const row = rows[i++]!
      if (row.startsWith("author ")) author = row.slice(7)
      else if (row.startsWith("author-time ")) time = Number(row.slice(12))
      else if (row.startsWith("summary ")) subject = row.slice(8)
      else if (row.startsWith("filename "))
        originalPath = yield* Effect.try({
          try: () => RepoPath.make(unquotePath(row.slice(9))),
          catch: () => fileError("The original filename is not UTF-8. Inspect blame using Git on the command line."),
        })
    }
    lines.push({
      oid: Oid.make(header[1]!),
      path: originalPath,
      originalLine: Number(header[2]),
      line: Number(header[3]),
      content: rows[i++]!.slice(1),
      author,
      time,
      subject,
    })
  }
  return { _tag: "Lines", lines }
})
