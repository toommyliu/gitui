import { constants } from "node:fs"
import { createHash, randomBytes } from "node:crypto"
import { lstat, mkdir, open, readdir, readlink, rename, symlink, unlink } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { DiscardBackup, GitError, type DiscardRestore, type RepoId, type RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Git } from "./git.ts"

const MAX_BACKUPS = 100
const MAX_BYTES = 128 * 1024 * 1024
const MAX_FILE_BYTES = 32 * 1024 * 1024
const backupName = /^\d{13}-[0-9a-f]{24}\.json$/
const failure = (message: string) => new GitError({ args: ["discard-recovery"], exitCode: -1, stderr: message })
const io = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      error instanceof GitError
        ? error
        : failure("Discard recovery could not complete. Any saved backup remains available in Recovery."),
  }).pipe(Effect.uninterruptible)
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT"
const State = Schema.Union([
  Schema.TaggedStruct("Missing", {}),
  Schema.TaggedStruct("File", { content: Schema.String, mode: Schema.Int }),
  Schema.TaggedStruct("Symlink", { content: Schema.String }),
])
type State = typeof State.Type
const Snapshot = Schema.Struct({ path: Schema.String, state: State })
type Snapshot = typeof Snapshot.Type
const Saved = Schema.Struct({
  entry: DiscardBackup,
  before: Schema.Array(Snapshot),
  after: Schema.NullOr(Schema.String),
})
type Saved = typeof Saved.Type
const decode = Schema.decodeUnknownSync(Saved)
const fingerprint = (snapshots: ReadonlyArray<Snapshot>) =>
  createHash("sha256").update(JSON.stringify(snapshots)).digest("hex")

const validatePath = (path: string) => {
  if (
    isAbsolute(path) ||
    path.includes("\0") ||
    path.split("/").some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === ".git")
  )
    throw failure("Choose individual files inside this worktree to discard or restore.")
}

const checkParents = async (repo: string, path: string, create = false) => {
  validatePath(path)
  let parent = repo
  for (const part of path.split("/").slice(0, -1)) {
    parent = join(parent, part)
    if (create)
      await mkdir(parent, { mode: 0o755 }).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      })
    const stat = await lstat(parent).catch((error: unknown) => {
      if (missing(error)) return null
      throw error
    })
    if (stat === null) continue
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw failure("A parent directory changed. Move it aside before restoring these files.")
  }
}

const capture = async (repo: string, paths: ReadonlyArray<string>): Promise<Array<Snapshot>> => {
  const snapshots: Array<Snapshot> = []
  let bytes = 0
  for (const path of paths) {
    await checkParents(repo, path)
    const file = join(repo, path)
    const stat = await lstat(file).catch((error: unknown) => {
      if (missing(error)) return null
      throw error
    })
    let state: State
    if (stat === null) state = { _tag: "Missing" }
    else if (stat.isSymbolicLink())
      state = { _tag: "Symlink", content: (await readlink(file, { encoding: "buffer" })).toString("base64") }
    else if (stat.isFile()) {
      if (stat.size > MAX_FILE_BYTES || (bytes += stat.size) > MAX_FILE_BYTES)
        throw failure("These files exceed the 32 MiB discard backup limit. Discard fewer or smaller files.")
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const content = await handle.readFile()
        if (content.length > MAX_FILE_BYTES) throw failure("This file exceeds the discard backup limit.")
        state = { _tag: "File", content: content.toString("base64"), mode: stat.mode & 0o777 }
      } finally {
        await handle.close()
      }
    } else
      throw failure(
        "Discard recovery supports files and symlinks. Directories and submodules must be handled separately.",
      )
    snapshots.push({ path, state })
  }
  return snapshots
}

const syncDirectory = async (directory: string) => {
  if (process.platform === "win32") return
  const handle = await open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const atomicSave = async (directory: string, saved: Saved) => {
  const temp = join(directory, `${saved.entry.id}-${randomBytes(8).toString("hex")}.tmp`)
  try {
    const handle = await open(temp, "wx", 0o600)
    try {
      await handle.writeFile(JSON.stringify(saved))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, join(directory, `${saved.entry.id}.json`))
    await syncDirectory(directory)
  } finally {
    await unlink(temp).catch((error: unknown) => {
      if (!missing(error)) throw error
    })
  }
}

const readSaved = async (directory: string, name: string) => {
  if (!backupName.test(name)) throw failure("Invalid discard backup ID.")
  const handle = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_BYTES) throw failure("Invalid discard backup.")
    const saved = decode(JSON.parse(await handle.readFile("utf8")))
    if (
      `${saved.entry.id}.json` !== name ||
      saved.before.length === 0 ||
      saved.before.length !== saved.entry.paths.length ||
      saved.before.some((item, i) => item.path !== saved.entry.paths[i])
    )
      throw failure("Invalid discard backup.")
    for (const item of saved.before) validatePath(item.path)
    return saved
  } finally {
    await handle.close()
  }
}

const makeRoom = async (directory: string, size: number, protect?: string) => {
  if (size > MAX_BYTES) throw failure("These files exceed the discard backup storage limit.")
  const files = []
  for (const name of (await readdir(directory)).filter((name) => backupName.test(name)).sort()) {
    const stat = await lstat(join(directory, name))
    if (!stat.isFile() || stat.isSymbolicLink()) throw failure("Invalid discard backup storage. Discard was refused.")
    files.push({ name, size: stat.size })
  }
  let total = files.reduce((sum, file) => sum + file.size, 0)
  let count = files.length
  for (const file of files) {
    if (total + size <= MAX_BYTES && count < MAX_BACKUPS) break
    if (file.name === `${protect}.json`) continue
    await unlink(join(directory, file.name))
    total -= file.size
    count--
  }
  if (total + size > MAX_BYTES || count >= MAX_BACKUPS) throw failure("Discard backup storage is full.")
}

export const makeDiscardRecovery = (git: Git["Service"]) => {
  const directory = Effect.fn("DiscardRecovery.directory")(function* (repo: RepoId) {
    const gitDir = (yield* git.text(repo, ["rev-parse", "--absolute-git-dir"])).trim()
    const path = join(gitDir, "gitui-discard-backups")
    yield* io(async () => {
      await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      })
      const stat = await lstat(path)
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw failure("Discard backup storage is not a private directory. Discard was refused.")
      await syncDirectory(gitDir)
    })
    return path
  })

  const save = async (
    dir: string,
    before: ReadonlyArray<Snapshot>,
    kind: DiscardBackup["kind"],
    protect?: string,
  ): Promise<Saved> => {
    const entry: DiscardBackup = {
      id: `${Date.now()}-${randomBytes(12).toString("hex")}`,
      time: Date.now(),
      kind,
      paths: before.map((item) => item.path as RepoPath),
    }
    const saved: Saved = { entry, before, after: null }
    await makeRoom(dir, Buffer.byteLength(JSON.stringify(saved)) + 64, protect)
    await atomicSave(dir, saved)
    return saved
  }

  return {
    discardRecovery: Effect.fn("DiscardRecovery.list")(function* (repo: RepoId) {
      const dir = yield* directory(repo)
      return yield* io(async () => {
        const names = (await readdir(dir))
          .filter((name) => backupName.test(name))
          .sort()
          .reverse()
        const entries = []
        for (const name of names) {
          const saved = await readSaved(dir, name).catch((error: unknown) => {
            if (missing(error)) return null
            throw error
          })
          if (saved !== null) entries.push(saved.entry)
        }
        return entries
      })
    }),
    protect: Effect.fn("DiscardRecovery.protect")(function* (
      repo: RepoId,
      paths: ReadonlyArray<RepoPath>,
      kind: "files" | "lines",
      mutate: Effect.Effect<void, GitError>,
    ) {
      if (paths.length === 0) return null
      const dir = yield* directory(repo)
      const saved = yield* io(async () => save(dir, await capture(repo, [...new Set(paths)].sort()), kind))
      yield* io(async () => {
        if (fingerprint(await capture(repo, saved.entry.paths)) !== fingerprint(saved.before))
          throw failure("Files changed while saving the backup. Discard was refused; try again.")
      })
      yield* mutate
      yield* io(async () => atomicSave(dir, { ...saved, after: fingerprint(await capture(repo, saved.entry.paths)) }))
      return saved.entry
    }),
    restoreDiscard: Effect.fn("DiscardRecovery.restore")(function* (
      repo: RepoId,
      id: string,
      overwriteVersion: string | null,
    ) {
      const dir = yield* directory(repo)
      return yield* io(async (): Promise<DiscardRestore> => {
        const saved = await readSaved(dir, `${id}.json`)
        const current = await capture(repo, saved.entry.paths)
        const version = fingerprint(current)
        if (version === fingerprint(saved.before)) return { _tag: "Restored" }
        if (version !== saved.after && version !== overwriteVersion)
          return { _tag: "Conflict", paths: saved.entry.paths, version }
        const displaced = await save(dir, current, "restore", id)
        if (fingerprint(await capture(repo, saved.entry.paths)) !== version)
          throw failure("Files changed during recovery. Refresh and try again.")
        for (const item of saved.before) {
          await checkParents(repo, item.path, item.state._tag !== "Missing")
          const target = join(repo, item.path)
          if (item.state._tag === "Missing") {
            try {
              await unlink(target)
            } catch (error) {
              if (missing(error)) continue
              throw error
            }
          } else {
            const temp = join(dirname(target), `.gitui-restore-${randomBytes(12).toString("hex")}`)
            try {
              if (item.state._tag === "Symlink") await symlink(Buffer.from(item.state.content, "base64"), temp)
              else {
                const handle = await open(temp, "wx", item.state.mode)
                try {
                  await handle.writeFile(Buffer.from(item.state.content, "base64"))
                  await handle.chmod(item.state.mode)
                  await handle.sync()
                } finally {
                  await handle.close()
                }
              }
              await rename(temp, target)
            } finally {
              await unlink(temp).catch((error: unknown) => {
                if (!missing(error)) throw error
              })
            }
          }
          await syncDirectory(dirname(target))
        }
        await atomicSave(dir, { ...displaced, after: fingerprint(saved.before) })
        return { _tag: "Restored" }
      })
    }),
  }
}
