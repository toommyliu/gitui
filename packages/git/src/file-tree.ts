import { type FileContent, type FileRevision, GitError, Oid, type RepoId, type RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import { resolveRevision } from "./comparison.ts"
import type { Git } from "./git.ts"

export const PREVIEW_BYTES = 1024 * 1024
export const RESTORE_BYTES = 16 * PREVIEW_BYTES
export const fileError = (message: string) => new GitError({ args: ["file"], exitCode: -1, stderr: message })

export const decodeFileOutput = (bytes: Uint8Array) =>
  Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    catch: () =>
      fileError("Git returned a filename or metadata that isn't UTF-8. Inspect it using Git on the command line."),
  })

export const validateFilePath = (path: RepoPath) => {
  const parts = path.split("/")
  return path !== "" &&
    !path.includes("\0") &&
    (process.platform !== "win32" || !path.includes("\\")) &&
    !path.startsWith("/") &&
    (process.platform !== "win32" || !/^[A-Za-z]:/.test(path)) &&
    parts.every((part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git")
    ? Effect.void
    : Effect.fail(fileError("Use a literal file path within the repository, outside .git."))
}

export const treeFile = Effect.fn("File.tree")(function* (
  git: Git["Service"],
  repo: RepoId,
  revision: Oid,
  path: RepoPath,
) {
  yield* validateFilePath(path)
  const raw = yield* git.run(repo, ["ls-tree", "-z", "-l", revision, "--", path]).pipe(Effect.flatMap(decodeFileOutput))
  const row = raw.split("\0").find((row) => row.slice(row.indexOf("\t") + 1) === path)
  if (row === undefined) return null
  const [mode = "", type = "", oid = "", size = "0"] = row.slice(0, row.indexOf("\t")).trim().split(/\s+/)
  return { mode, type, oid: Oid.make(oid), bytes: size === "-" ? 0 : Number(size) }
})

const textContent = (bytes: Uint8Array): FileContent => {
  if (bytes.includes(0)) return { _tag: "Binary" }
  try {
    return { _tag: "Text", content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }
  } catch {
    return { _tag: "Binary" }
  }
}

export const fileRevision = Effect.fn("File.revision")(function* (
  git: Git["Service"],
  repo: RepoId,
  ref: string,
  path: RepoPath,
): Effect.fn.Return<FileRevision, GitError> {
  const revision = yield* resolveRevision(git, repo, ref)
  const entry = yield* treeFile(git, repo, revision, path)
  if (entry === null) return { revision, path, blob: null, mode: null, bytes: 0, content: { _tag: "Missing" } }
  let content: FileContent
  if (entry.mode === "160000") content = { _tag: "Submodule" }
  else if (entry.type !== "blob" || entry.bytes > PREVIEW_BYTES) content = { _tag: "TooLarge" }
  else {
    content = textContent(yield* git.run(repo, ["cat-file", "blob", entry.oid]))
    if (entry.mode === "120000") content = { _tag: "Symlink", target: content._tag === "Text" ? content.content : null }
  }
  return { revision, path, blob: entry.oid, mode: entry.mode, bytes: entry.bytes, content }
})
