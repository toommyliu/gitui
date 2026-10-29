import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import { type FileIdentity, type FileRestorePreview, Oid, type RepoId, type RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import { resolveRevision } from "./comparison.ts"
import type { Git } from "./git.ts"
import { fileError, RESTORE_BYTES, treeFile, validateFilePath } from "./file-tree.ts"

const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (error) => fileError(String(error)) })
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT"

const destinationState = async (repo: RepoId, path: RepoPath) => {
  const root = await realpath(repo)
  const parts = path.split("/")
  let parent = root
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part)
    const info = await lstat(parent).catch((error: unknown) => {
      if (missing(error)) return null
      throw error
    })
    if (info === null) continue
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("The destination's parent must be a directory, without symbolic links.")
  }
  const fullPath = join(root, path)
  const info = await lstat(fullPath).catch((error: unknown) => {
    if (missing(error)) return null
    throw error
  })
  if (info === null) return { fullPath, bytes: null, executable: false, stamp: "missing" }
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("The destination must be a regular file, not a symbolic link or directory.")
  if (info.size > RESTORE_BYTES)
    throw new Error(
      "The destination exceeds the 16 MiB safe restore limit. Restore this file using Git on the command line.",
    )
  const handle = await open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const bytes = await handle.readFile()
    if (bytes.length > RESTORE_BYTES)
      throw new Error("The destination grew beyond the safe restore limit. Check it before restoring.")
    const current = await handle.stat()
    if (current.ino !== info.ino || current.dev !== info.dev)
      throw new Error("The destination changed while checking it. Try again.")
    return {
      fullPath,
      bytes,
      executable: (info.mode & 0o111) !== 0,
      stamp: createHash("sha256").update(`${info.mode}:${info.ino}:${info.dev}\0`).update(bytes).digest("hex"),
    }
  } finally {
    await handle.close()
  }
}

export const makeFileRestore = (git: Git["Service"]) => {
  const snapshot = Effect.fn("File.restoreSnapshot")(function* (
    repo: RepoId,
    source: FileIdentity,
    destination: RepoPath,
  ) {
    yield* validateFilePath(destination)
    const revision = yield* resolveRevision(git, repo, source.revision)
    const entry = yield* treeFile(git, repo, revision, source.path)
    const unavailable =
      entry === null
        ? "The source file does not exist at this commit. Select the version before deletion."
        : entry.mode !== "100644" && entry.mode !== "100755"
          ? "Only regular files can be restored here. Restore symbolic links or submodules using Git on the command line."
          : entry.bytes > RESTORE_BYTES
            ? "This version exceeds the 16 MiB safe restore limit. Restore it using Git on the command line."
            : null
    if (unavailable !== null)
      return {
        entry,
        working: null,
        preview: {
          source: { revision, path: source.path },
          destination,
          version: "",
          overwrite: false,
          unavailable,
        } satisfies FileRestorePreview,
      }
    const working = yield* io(() => destinationState(repo, destination))
    const index = yield* git.run(repo, ["ls-files", "--stage", "-z", "--", destination])
    const head = (yield* git.text(repo, ["rev-parse", "--verify", "-q", "HEAD"], { okExitCodes: [1] })).trim()
    const base = head === "" ? null : yield* treeFile(git, repo, Oid.make(head), destination)
    const baseBytes =
      base !== null && base.type === "blob" && base.bytes <= RESTORE_BYTES
        ? yield* git.run(repo, ["cat-file", "blob", base.oid])
        : null
    const overwrite =
      working.bytes === null
        ? base !== null
        : baseBytes === null || !working.bytes.equals(baseBytes) || working.executable !== (base?.mode === "100755")
    const version = createHash("sha256")
      .update(JSON.stringify([revision, source.path, destination, working.stamp, head]))
      .update(index)
      .digest("hex")
    return {
      entry,
      working,
      preview: {
        source: { revision, path: source.path },
        destination,
        version,
        overwrite,
        unavailable,
      } satisfies FileRestorePreview,
    }
  })
  return {
    previewFileRestore: Effect.fn("File.previewRestore")(function* (
      repo: RepoId,
      source: FileIdentity,
      destination: RepoPath,
    ) {
      return (yield* snapshot(repo, source, destination)).preview
    }),
    restoreFile: Effect.fn("File.restore")(function* (
      repo: RepoId,
      source: FileIdentity,
      destination: RepoPath,
      expectedVersion: string,
      overwrite: boolean,
    ) {
      const { entry, working, preview } = yield* snapshot(repo, source, destination)
      if (preview.unavailable !== null || entry === null || working === null)
        return yield* fileError(preview.unavailable ?? "Source file is missing.")
      if (preview.version !== expectedVersion)
        return yield* fileError(
          "The destination or index changed since you reviewed the restore. Review it again before restoring.",
        )
      if (preview.overwrite && !overwrite)
        return yield* fileError("Restoring would overwrite local work. Confirm the overwrite before restoring.")
      const bytes = yield* git.run(repo, ["cat-file", "blob", entry.oid])
      yield* io(async () => {
        const parent = dirname(working.fullPath)
        await mkdir(parent, { recursive: true })
        await destinationState(repo, destination)
        const temporary = join(parent, `.gitui-restore-${randomUUID()}`)
        try {
          const handle = await open(temporary, "wx", entry.mode === "100755" ? 0o755 : 0o644)
          try {
            await handle.writeFile(bytes)
            await handle.chmod(entry.mode === "100755" ? 0o755 : 0o644)
          } finally {
            await handle.close()
          }
          const latest = await destinationState(repo, destination)
          if (latest.stamp !== working.stamp)
            throw new Error("The destination changed while preparing the restore. Review it again before restoring.")
          await rename(temporary, working.fullPath)
        } finally {
          await unlink(temporary).catch((error: unknown) => {
            if (!missing(error)) throw error
          })
        }
      })
    }),
  }
}
