import { createHash } from "node:crypto"
import { dirname, join, sep } from "node:path"
import {
  type ConflictDetail,
  type ConflictFile,
  type ConflictRef,
  GitError,
  Oid,
  type RepoId,
  type RepoPath,
} from "@gitui/contracts"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import type { PlatformError } from "effect/PlatformError"
import { type Git, nulList } from "./git.ts"
import { splitNul } from "./nul.ts"

const MAX_PREVIEW_BYTES = 1024 * 1024
const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()

interface IndexEntry {
  readonly mode: string
  readonly oid: string
}

type Unmerged = ReadonlyMap<string, ReadonlyMap<string, IndexEntry>>
type Stages = ReadonlyMap<string, IndexEntry>
type WorkingSnapshot =
  | {
      readonly _tag: "Editable"
      readonly file: Extract<ConflictFile, { _tag: "Text" }>
      readonly stamp: string
      readonly bom: boolean
      readonly lineEnding: "\n" | "\r\n" | null
    }
  | { readonly _tag: "ReadOnly"; readonly file: ConflictFile; readonly stamp: string }

const fileStamp = (bytes: Uint8Array, mode: number) =>
  createHash("sha256").update(`${mode}\0`).update(bytes).digest("hex")

const versionOf = (stages: Stages, stamp: string) =>
  createHash("sha256")
    .update(JSON.stringify([...stages]))
    .update(stamp)
    .digest("hex")

const editableIndex = (stages: Stages, files: ReadonlyArray<ConflictFile>) =>
  [...stages.values()].every(({ mode }) => mode === "100644" || mode === "100755") &&
  files.every((file) => file._tag === "Text" || file._tag === "Missing")

const preview = (bytes: Uint8Array): ConflictFile => {
  if (bytes.length > MAX_PREVIEW_BYTES) return { _tag: "TooLarge", bytes: bytes.length }
  if (bytes.includes(0)) return { _tag: "Binary", bytes: bytes.length }
  try {
    return { _tag: "Text", content: decoder.decode(bytes) }
  } catch {
    return { _tag: "Binary", bytes: bytes.length }
  }
}

const conflictError = (path: RepoPath, message: string) =>
  new GitError({ args: ["mergetool", "--", path], exitCode: -1, stderr: message })

const stagesFor = (entries: Unmerged, path: RepoPath) => {
  const stages = entries.get(path)
  if (stages === undefined)
    return Effect.fail(conflictError(path, `${path} is no longer conflicted. Refresh the file list.`))
  return Effect.succeed(stages)
}

const fileStagesFor = Effect.fn("Conflicts.fileStagesFor")(function* (entries: Unmerged, path: RepoPath) {
  const stages = yield* stagesFor(entries, path)
  if ([...stages.values()].some((entry) => entry.mode === "160000"))
    return yield* conflictError(
      path,
      "Resolve and commit this conflict in the submodule repository, then stage its checked-out commit here.",
    )
  return stages
})

export const makeConflicts = (git: Git["Service"], fs: FileSystem.FileSystem) => {
  const unmerged = Effect.fn("Conflicts.unmerged")(function* (repo: RepoId, paths: ReadonlyArray<RepoPath>) {
    const entries = new Map<string, Map<string, IndexEntry>>()
    const bytes = yield* git.run(repo, ["ls-files", "--unmerged", "-z", "--", ...paths])
    for (const row of splitNul(bytes)) {
      const tab = row.indexOf("\t")
      const [mode = "", oid = "", stage = ""] = row.slice(0, tab).split(" ")
      const path = row.slice(tab + 1)
      let stages = entries.get(path)
      if (stages === undefined) {
        stages = new Map()
        entries.set(path, stages)
      }
      stages.set(stage, { mode, oid })
    }
    return entries
  })

  const mergeTool = Effect.fn("Conflicts.mergeTool")(function* (repo: RepoId) {
    for (const key of ["merge.guitool", "merge.tool"]) {
      const name = (yield* git.text(repo, ["config", "--get", key], { okExitCodes: [1] })).trim()
      if (name !== "") return name
    }
    return null
  })

  const indexFile = Effect.fn("Conflicts.indexFile")(function* (repo: RepoId, entry: IndexEntry | undefined) {
    if (entry === undefined) return { _tag: "Missing" } satisfies ConflictFile
    if (entry.mode === "160000") return { _tag: "Submodule", oid: Oid.make(entry.oid) } satisfies ConflictFile
    const size = Number((yield* git.text(repo, ["cat-file", "-s", entry.oid])).trim())
    if (size > MAX_PREVIEW_BYTES) return { _tag: "TooLarge", bytes: size } satisfies ConflictFile
    return preview(yield* git.run(repo, ["cat-file", "blob", entry.oid]))
  })

  const checkedPath = Effect.fn("Conflicts.checkedPath")(function* (repo: RepoId, path: RepoPath) {
    const fullPath = join(repo, path)
    const root = yield* fs.realPath(repo)
    const parent = yield* fs.realPath(dirname(fullPath))
    if (parent !== root && !parent.startsWith(root + sep))
      return yield* conflictError(path, "The conflicted file's parent directory points outside the repository.")
    return fullPath
  })

  const regularFile = Effect.fn("Conflicts.regularFile")(function* (
    file: FileSystem.File,
    path: RepoPath,
  ): Effect.fn.Return<WorkingSnapshot, GitError | PlatformError> {
    const info = yield* file.stat
    if (info.type !== "File") return yield* conflictError(path, "The working copy is not a regular file.")
    const size = Number(info.size)
    if (size > MAX_PREVIEW_BYTES)
      return {
        _tag: "ReadOnly",
        file: { _tag: "TooLarge", bytes: size },
        stamp: JSON.stringify([size, info.mode, info.mtime]),
      }
    const buffer = new Uint8Array(MAX_PREVIEW_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const count = yield* file.read(buffer.subarray(length), { position: BigInt(length) })
      if (count === 0) break
      length += count
    }
    const bytes = buffer.subarray(0, length)
    const content = preview(bytes)
    const stamp = fileStamp(bytes, info.mode)
    if (content._tag !== "Text") return { _tag: "ReadOnly", file: content, stamp }
    return {
      _tag: "Editable",
      file: content,
      stamp,
      bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      lineEnding: content.content.includes("\r\n") ? (/(^|[^\r])\n/.test(content.content) ? null : "\r\n") : "\n",
    }
  })

  const workingFile = (repo: RepoId, path: RepoPath, submodule: boolean): Effect.Effect<WorkingSnapshot, GitError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const fullPath = yield* checkedPath(repo, path)
        const link = yield* fs.readLink(fullPath).pipe(Effect.option)
        if (Option.isSome(link))
          return {
            _tag: "ReadOnly",
            file: { _tag: "Text", content: link.value },
            stamp: `link:${link.value}`,
          } satisfies WorkingSnapshot
        if (submodule && (yield* fs.stat(fullPath)).type === "Directory") {
          const oid = (yield* fs.exists(join(fullPath, ".git")))
            ? Oid.make((yield* git.text(repo, ["-C", fullPath, "rev-parse", "--verify", "HEAD"])).trim())
            : null
          return {
            _tag: "ReadOnly",
            file: { _tag: "Submodule", oid },
            stamp: `submodule:${oid}`,
          } satisfies WorkingSnapshot
        }
        return yield* regularFile(yield* fs.open(fullPath, { noFollow: process.platform !== "win32" }), path)
      }),
    ).pipe(
      Effect.catchTag("PlatformError", (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed({ _tag: "ReadOnly", file: { _tag: "Missing" }, stamp: "missing" } satisfies WorkingSnapshot)
          : Effect.fail(conflictError(path, `Couldn't read ${path}: ${error.message}`)),
      ),
    )

  const refInfo = Effect.fn("Conflicts.refInfo")(function* (repo: RepoId, ref: string) {
    const oid = (yield* git.text(repo, ["rev-parse", "--verify", "-q", `${ref}^{commit}`], { okExitCodes: [1] })).trim()
    if (oid === "") return null
    const [subject, rawName] = yield* Effect.all(
      [
        git.text(repo, ["show", "--no-patch", "--format=%s", oid]),
        git.text(repo, ["name-rev", "--name-only", "--always", "--refs=refs/heads/*", oid]),
      ],
      { concurrency: 2 },
    )
    const name = rawName.trim()
    return {
      oid: Oid.make(oid),
      subject: subject.trimEnd(),
      name: oid.startsWith(name) ? null : name,
    } satisfies ConflictRef
  })

  const sideLabels = Effect.fn("Conflicts.sideLabels")(function* (repo: RepoId) {
    const ours = yield* refInfo(repo, "HEAD")
    for (const ref of ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) {
      const theirs = yield* refInfo(repo, ref)
      if (theirs !== null) return { ours, theirs }
    }
    return { ours, theirs: null }
  })

  return {
    detail: Effect.fn("Conflicts.detail")(function* (repo: RepoId, path: RepoPath) {
      const stages = yield* stagesFor(yield* unmerged(repo, [path]), path)
      const submodule = [...stages.values()].some((entry) => entry.mode === "160000")
      const [base, ours, theirs, working, tool, labels] = yield* Effect.all(
        [
          indexFile(repo, stages.get("1")),
          indexFile(repo, stages.get("2")),
          indexFile(repo, stages.get("3")),
          workingFile(repo, path, submodule),
          submodule ? Effect.succeed(null) : mergeTool(repo),
          sideLabels(repo),
        ],
        { concurrency: 5 },
      )
      return {
        path,
        base,
        ours,
        theirs,
        result: working.file,
        mergeTool: tool,
        version: versionOf(stages, working.stamp),
        editable: working._tag === "Editable" && editableIndex(stages, [base, ours, theirs]),
        labels,
      } satisfies ConflictDetail
    }),
    save: Effect.fn("Conflicts.save")(function* (
      repo: RepoId,
      path: RepoPath,
      content: string,
      expectedVersion: string,
      stage: boolean,
    ) {
      const stages = yield* fileStagesFor(yield* unmerged(repo, [path]), path)
      const sides = yield* Effect.forEach([...stages.values()], (entry) => indexFile(repo, entry), { concurrency: 3 })
      if (!editableIndex(stages, sides))
        return yield* conflictError(
          path,
          "This conflict cannot be edited as text. Keep a side or use an external merge tool.",
        )
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const fullPath = yield* checkedPath(repo, path)
          const link = yield* fs.readLink(fullPath).pipe(Effect.option)
          if (Option.isSome(link)) return yield* conflictError(path, "A symbolic link cannot be edited as a text file.")
          const file = yield* fs.open(fullPath, { flag: "r+", noFollow: process.platform !== "win32" })
          const working = yield* regularFile(file, path)
          if (versionOf(stages, working.stamp) !== expectedVersion)
            return yield* conflictError(
              path,
              "This file or its conflict sides changed since it was loaded. Reload it before saving; your draft has not been written.",
            )
          if (working._tag !== "Editable")
            return yield* conflictError(
              path,
              "This working file cannot be edited as text. Keep a side or use an external merge tool.",
            )
          const text = content.replace(/^\uFEFF/, "")
          const normalized = working.lineEnding === null ? text : text.replace(/\r?\n/g, working.lineEnding)
          const bytes = encoder.encode((working.bom ? "\uFEFF" : "") + normalized)
          if (bytes.length > MAX_PREVIEW_BYTES || bytes.includes(0))
            return yield* conflictError(
              path,
              "The merge result must be UTF-8 text without NUL bytes and no larger than 1 MiB.",
            )
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* file.seek(0n, "start")
              yield* file.writeAll(bytes)
              yield* file.truncate(bytes.length)
              if (stage)
                yield* git.run(repo, ["add", "--pathspec-from-file=-", "--pathspec-file-nul"], {
                  stdin: nulList([path]),
                  write: true,
                })
            }),
          )
          return versionOf(stages, fileStamp(bytes, (yield* file.stat).mode))
        }),
      ).pipe(
        Effect.catchTag("PlatformError", (error) =>
          Effect.fail(conflictError(path, `Couldn't save ${path}: ${error.message}`)),
        ),
      )
    }),
    resolve: Effect.fn("Conflicts.resolve")(function* (
      repo: RepoId,
      paths: ReadonlyArray<RepoPath>,
      side: "ours" | "theirs",
    ) {
      if (paths.length === 0) return
      const entries = yield* unmerged(repo, paths)
      const keep: Array<RepoPath> = []
      const remove: Array<RepoPath> = []
      for (const path of paths) {
        const stages = yield* fileStagesFor(entries, path)
        if (stages.has(side === "ours" ? "2" : "3")) keep.push(path)
        else remove.push(path)
      }
      if (keep.length > 0) {
        yield* git.run(repo, ["checkout", `--${side}`, "--pathspec-from-file=-", "--pathspec-file-nul"], {
          stdin: nulList(keep),
          write: true,
        })
        yield* git.run(repo, ["add", "--pathspec-from-file=-", "--pathspec-file-nul"], {
          stdin: nulList(keep),
          write: true,
        })
      }
      if (remove.length > 0)
        yield* git.run(repo, ["rm", "-f", "--pathspec-from-file=-", "--pathspec-file-nul"], {
          stdin: nulList(remove),
          write: true,
        })
    }),
    runTool: Effect.fn("Conflicts.runTool")(function* (repo: RepoId, path: RepoPath) {
      yield* fileStagesFor(yield* unmerged(repo, [path]), path)
      const tool = yield* mergeTool(repo)
      if (tool === null)
        return yield* conflictError(
          path,
          "Configure merge.guitool or merge.tool in Git before opening an external merge tool.",
        )
      yield* git.run(repo, ["mergetool", `--tool=${tool}`, "--no-prompt", "--", path], { write: true })
    }),
  }
}
