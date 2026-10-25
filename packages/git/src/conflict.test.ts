import { execFileSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
} from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { fixtureEnv, makeRepo } from "./testRepo.ts"

const file = "a.txt" as RepoPath
const id = (root: string) => root as RepoId

const conflicted = (options: { base?: string; ours?: string; theirs?: string; path?: string } = {}) => {
  const repo = makeRepo()
  const path = options.path ?? file
  repo.write(path, options.base ?? "base\n")
  repo.git("add", ".")
  repo.commit("base")
  repo.git("switch", "-q", "-c", "topic")
  repo.write(path, options.theirs ?? "topic\n")
  repo.git("commit", "-q", "-am", "topic change")
  repo.git("switch", "-q", "main")
  repo.write(path, options.ours ?? "main\n")
  repo.git("commit", "-q", "-am", "main change")
  expect(() => repo.git("merge", "topic")).toThrow()
  repo.git("config", "merge.guitool", "")
  repo.git("config", "merge.tool", "")
  return repo
}

const conflictedSubmodule = () => {
  const repo = makeRepo()
  const source = makeRepo()
  const base = source.commit("base")
  source.git("switch", "-q", "-c", "topic")
  const theirs = source.commit("topic")
  source.git("switch", "-q", "main")
  const ours = source.commit("main")
  repo.git("-c", "protocol.file.allow=always", "submodule", "add", "-q", source.root, "nested")
  const nested = (...args: Array<string>) =>
    execFileSync("git", args, { cwd: join(repo.root, "nested"), env: fixtureEnv(), encoding: "utf8" }).trimEnd()
  nested("checkout", "-q", base)
  repo.git("add", ".")
  repo.commit("base")
  repo.git("switch", "-q", "-c", "topic")
  nested("checkout", "-q", theirs)
  repo.git("add", "nested")
  repo.commit("topic submodule")
  repo.git("switch", "-q", "main")
  nested("checkout", "-q", ours)
  repo.git("add", "nested")
  repo.commit("main submodule")
  expect(() => repo.git("merge", "topic")).toThrow()
  return { repo, nested, base, ours, theirs }
}

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Conflicts", (it) => {
  it.effect("reads and stages a submodule conflict after resolving it in the submodule", () =>
    Effect.gen(function* () {
      const { repo, nested, base, ours, theirs } = conflictedSubmodule()
      const path = "nested" as RepoPath
      const r = yield* Repo
      const before = yield* r.conflict(id(repo.root), path)
      expect(before).toMatchObject({
        base: { _tag: "Submodule", oid: base },
        ours: { _tag: "Submodule", oid: ours },
        theirs: { _tag: "Submodule", oid: theirs },
        result: { _tag: "Submodule", oid: ours },
        editable: false,
        mergeTool: null,
      })
      nested("merge", "--no-edit", theirs)
      const resolved = nested("rev-parse", "HEAD")
      const detail = yield* r.conflict(id(repo.root), path)
      expect(detail.result).toEqual({ _tag: "Submodule", oid: resolved })
      expect(detail.version).not.toBe(before.version)
      yield* r.stage(id(repo.root), [path])
      expect(repo.git("ls-files", "--unmerged")).toBe("")
      expect(repo.git("rev-parse", `:${path}`)).toBe(resolved)
      yield* r.continueOperation(id(repo.root))
      expect((yield* r.status(id(repo.root))).operation).toBe(null)
    }),
  )

  it.effect("does not mistake the parent HEAD for an uninitialized submodule's commit", () =>
    Effect.gen(function* () {
      const { repo, ours } = conflictedSubmodule()
      const path = "nested" as RepoPath
      rmSync(join(repo.root, path), { recursive: true, force: true })
      mkdirSync(join(repo.root, path))
      const detail = yield* (yield* Repo).conflict(id(repo.root), path)
      expect(detail.result).toEqual({ _tag: "Submodule", oid: null })
      expect(detail.ours).toEqual({ _tag: "Submodule", oid: ours })
      expect(detail.editable).toBe(false)
    }),
  )

  it.effect("reads the base, both index sides, and the current edited working file", () =>
    Effect.gen(function* () {
      const repo = conflicted({ path: "folder/a\t quoted\n.txt" })
      const path = "folder/a\t quoted\n.txt" as RepoPath
      repo.write(path, "manually merged\r\n")
      const detail = yield* (yield* Repo).conflict(id(repo.root), path)
      expect(detail).toMatchObject({
        path,
        base: { _tag: "Text", content: "base\n" },
        ours: { _tag: "Text", content: "main\n" },
        theirs: { _tag: "Text", content: "topic\n" },
        result: { _tag: "Text", content: "manually merged\r\n" },
        mergeTool: null,
        editable: true,
        labels: {
          ours: { name: "main", oid: repo.git("rev-parse", "main"), subject: "main change" },
          theirs: { name: "topic", oid: repo.git("rev-parse", "topic"), subject: "topic change" },
        },
      })
    }),
  )

  it.effect("represents an add/add conflict without a base", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      repo.git("switch", "-q", "-c", "topic")
      repo.write(file, "topic\n")
      repo.git("add", ".")
      repo.commit("topic addition")
      repo.git("switch", "-q", "main")
      repo.write(file, "main\n")
      repo.git("add", ".")
      repo.commit("main addition")
      expect(() => repo.git("merge", "topic")).toThrow()
      const detail = yield* (yield* Repo).conflict(id(repo.root), file)
      expect(detail.base).toEqual({ _tag: "Missing" })
      expect(detail.ours).toEqual({ _tag: "Text", content: "main\n" })
      expect(detail.theirs).toEqual({ _tag: "Text", content: "topic\n" })
      expect(detail.labels.ours?.oid).toBe(repo.git("rev-parse", "main"))
      expect(detail.labels.theirs?.oid).toBe(repo.git("rev-parse", "topic"))
    }),
  )

  it.effect("keeps upstream and replayed commit contents distinct during a rebase", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      repo.git("merge", "--abort")
      repo.git("switch", "-q", "topic")
      expect(() => repo.git("rebase", "main")).toThrow()
      const detail = yield* (yield* Repo).conflict(id(repo.root), file)
      expect(detail.ours).toEqual({ _tag: "Text", content: "main\n" })
      expect(detail.theirs).toEqual({ _tag: "Text", content: "topic\n" })
      expect(detail.labels.ours?.oid).toBe(repo.git("rev-parse", "main"))
      expect(detail.labels.theirs?.oid).toBe(repo.git("rev-parse", "REBASE_HEAD"))
    }),
  )

  for (const side of ["ours", "theirs"] as const) {
    it.effect(`resolves a modify/delete conflict by choosing deletion on ${side}`, () =>
      Effect.gen(function* () {
        const repo = makeRepo()
        repo.write(file, "base\n")
        repo.git("add", ".")
        repo.commit("base")
        repo.git("switch", "-q", "-c", "topic")
        if (side === "theirs") repo.git("rm", file)
        else repo.write(file, "topic\n")
        repo.git("add", "-A")
        repo.commit("topic change")
        repo.git("switch", "-q", "main")
        if (side === "ours") repo.git("rm", file)
        else repo.write(file, "main\n")
        repo.git("add", "-A")
        repo.commit("main change")
        expect(() => repo.git("merge", "topic")).toThrow()
        const r = yield* Repo
        expect((yield* r.conflict(id(repo.root), file))[side]).toEqual({ _tag: "Missing" })
        yield* r.resolveConflict(id(repo.root), [file], side)
        expect(existsSync(join(repo.root, file))).toBe(false)
        expect(repo.git("ls-files", "--unmerged")).toBe("")
        yield* r.continueOperation(id(repo.root))
        expect((yield* r.status(id(repo.root))).operation).toBe(null)
      }),
    )
  }

  it.effect("reports binary contents and limits oversized previews", () =>
    Effect.gen(function* () {
      const repo = conflicted({ base: "base\0", ours: "main\0", theirs: "topic\0" })
      repo.write(file, "x".repeat(2 * 1024 * 1024))
      const detail = yield* (yield* Repo).conflict(id(repo.root), file)
      expect(detail.base).toEqual({ _tag: "Binary", bytes: 5 })
      expect(detail.ours).toEqual({ _tag: "Binary", bytes: 5 })
      expect(detail.theirs).toEqual({ _tag: "Binary", bytes: 6 })
      expect(detail.result).toEqual({ _tag: "TooLarge", bytes: 2 * 1024 * 1024 })
    }),
  )

  it.effect("shows a symlink target without reading the file it points to", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      repo.write("outside.txt", "not the symlink contents\n")
      rmSync(join(repo.root, file))
      symlinkSync("outside.txt", join(repo.root, file))
      const detail = yield* (yield* Repo).conflict(id(repo.root), file)
      expect(detail.editable).toBe(false)
      expect(detail.result).toEqual({
        _tag: "Text",
        content: "outside.txt",
      })
    }),
  )

  it.effect("refuses a path that is no longer conflicted", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      repo.git("add", file)
      const error = yield* Effect.flip((yield* Repo).conflict(id(repo.root), file))
      expect(error.stderr).toContain("no longer conflicted")
    }),
  )

  it.effect("does not read conflict results through a directory symlink outside the repository", () =>
    Effect.gen(function* () {
      const repo = conflicted({ path: "folder/a.txt" })
      const outside = makeRepo()
      outside.write(file, "outside contents\n")
      renameSync(join(repo.root, "folder"), join(repo.root, "original"))
      symlinkSync(outside.root, join(repo.root, "folder"))
      const error = yield* Effect.flip((yield* Repo).conflict(id(repo.root), "folder/a.txt" as RepoPath))
      expect(error.stderr).toContain("outside the repository")
    }),
  )

  it.effect("reports a manually deleted working file as missing", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      rmSync(join(repo.root, file))
      const detail = yield* (yield* Repo).conflict(id(repo.root), file)
      expect(detail.result).toEqual({ _tag: "Missing" })
      expect(detail.ours).toEqual({ _tag: "Text", content: "main\n" })
      expect(detail.theirs).toEqual({ _tag: "Text", content: "topic\n" })
    }),
  )

  it.effect("runs the configured GUI merge tool and stages its result", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      repo.git("config", "merge.tool", "nonexistent-fallback")
      repo.git("config", "merge.guitool", "fixture")
      repo.git("config", "mergetool.fixture.cmd", 'cat "$REMOTE" > "$MERGED"')
      repo.git("config", "mergetool.fixture.trustExitCode", "true")
      const r = yield* Repo
      expect((yield* r.conflict(id(repo.root), file)).mergeTool).toBe("fixture")
      yield* r.runMergeTool(id(repo.root), file)
      expect(readFileSync(join(repo.root, file), "utf8")).toBe("topic\n")
      expect(repo.git("ls-files", "--unmerged")).toBe("")
      expect(repo.git("show", `:${file}`)).toBe("topic")
    }),
  )

  it.effect("keeps a conflict unresolved when the external tool fails", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      repo.git("config", "merge.tool", "fixture")
      repo.git("config", "mergetool.fixture.cmd", "exit 1")
      repo.git("config", "mergetool.fixture.trustExitCode", "true")
      const r = yield* Repo
      const error = yield* Effect.flip(r.runMergeTool(id(repo.root), file))
      expect(error.args).toContain("mergetool")
      expect((yield* r.status(id(repo.root))).entries).toEqual([{ _tag: "Conflicted", path: file, code: "UU" }])
    }),
  )

  it.effect("explains that an external tool must be configured", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      const error = yield* Effect.flip((yield* Repo).runMergeTool(id(repo.root), file))
      expect(error.stderr).toContain("merge.guitool")
      expect(error.stderr).toContain("merge.tool")
      expect(repo.git("ls-files", "--unmerged")).toContain(file)
    }),
  )

  it.effect("leaves the conflict unresolved when an untrusted tool exits without editing", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      repo.git("config", "merge.tool", "fixture")
      repo.git("config", "mergetool.fixture.cmd", "true")
      repo.git("config", "mergetool.fixture.trustExitCode", "false")
      const before = readFileSync(join(repo.root, file), "utf8")
      const r = yield* Repo
      const error = yield* Effect.flip(r.runMergeTool(id(repo.root), file))
      expect(error.exitCode).not.toBe(0)
      expect(readFileSync(join(repo.root, file), "utf8")).toBe(before)
      expect((yield* r.status(id(repo.root))).entries).toEqual([{ _tag: "Conflicted", path: file, code: "UU" }])
    }),
  )

  it.effect("saves partial edits without staging, then saves and stages the finished file", () =>
    Effect.gen(function* () {
      const path = "folder/a\t quoted\n.txt" as RepoPath
      const repo = conflicted({ path })
      const r = yield* Repo
      const initial = yield* r.conflict(id(repo.root), path)
      const partial = "<<<<<<< HEAD\npartial\n=======\ntopic\n>>>>>>> topic\n"
      const version = yield* r.saveConflictResult(id(repo.root), path, partial, initial.version, false)
      expect(readFileSync(join(repo.root, path), "utf8")).toBe(partial)
      expect(repo.git("ls-files", "--unmerged")).not.toBe("")
      const saved = yield* r.conflict(id(repo.root), path)
      expect(saved.version).toBe(version)
      expect(saved.version).not.toBe(initial.version)
      yield* r.saveConflictResult(id(repo.root), path, "merged\n", version, true)
      expect(readFileSync(join(repo.root, path), "utf8")).toBe("merged\n")
      expect(repo.raw("show", `:${path}`).toString("utf8")).toBe("merged\n")
      expect(repo.git("ls-files", "--unmerged")).toBe("")
      expect((yield* r.status(id(repo.root))).operation).toBe("merge")
      yield* r.continueOperation(id(repo.root))
      expect((yield* r.status(id(repo.root))).operation).toBe(null)
    }),
  )

  it.effect("rejects stale disk contents even when the timestamp has not changed", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      const r = yield* Repo
      const before = yield* r.conflict(id(repo.root), file)
      const info = statSync(join(repo.root, file))
      repo.write(file, "another editor's work\n")
      utimesSync(join(repo.root, file), info.atime, info.mtime)
      const error = yield* Effect.flip(r.saveConflictResult(id(repo.root), file, "old draft\n", before.version, true))
      expect(error.stderr).toContain("changed since it was loaded")
      expect(readFileSync(join(repo.root, file), "utf8")).toBe("another editor's work\n")
      expect(repo.git("ls-files", "--unmerged")).not.toBe("")
    }),
  )

  it.effect("rejects stale conflict sides while the working file stays unchanged", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      const r = yield* Repo
      const before = yield* r.conflict(id(repo.root), file)
      const working = readFileSync(join(repo.root, file), "utf8")
      repo.write("replacement.txt", "a different side\n")
      const oid = repo.git("hash-object", "-w", "replacement.txt")
      execFileSync("git", ["update-index", "--index-info"], {
        cwd: repo.root,
        env: fixtureEnv(),
        input: `100644 ${oid} 2\t${file}\n`,
      })
      const error = yield* Effect.flip(r.saveConflictResult(id(repo.root), file, "old draft\n", before.version, false))
      expect(error.stderr).toContain("changed since it was loaded")
      expect(readFileSync(join(repo.root, file), "utf8")).toBe(working)
      expect(repo.raw("show", `:2:${file}`).toString("utf8")).toBe("a different side\n")
    }),
  )

  it.effect("preserves BOM, CRLF, no final newline, and executable mode when saving", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      repo.write(file, "\uFEFF<<<<<<< HEAD\r\nmain\r\n=======\r\ntopic\r\n>>>>>>> topic\r\n")
      chmodSync(join(repo.root, file), 0o755)
      const r = yield* Repo
      const before = yield* r.conflict(id(repo.root), file)
      yield* r.saveConflictResult(id(repo.root), file, "merged\nlast line", before.version, true)
      const expected = Buffer.from("\uFEFFmerged\r\nlast line", "utf8")
      expect(readFileSync(join(repo.root, file))).toEqual(expected)
      expect(repo.raw("show", `:${file}`)).toEqual(expected)
      expect(statSync(join(repo.root, file)).mode & 0o777).toBe(0o755)
      expect(repo.git("ls-files", "--stage", file)).toMatch(/^100755 /)
    }),
  )

  it.effect("rejects a mode change after loading", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      const r = yield* Repo
      const before = yield* r.conflict(id(repo.root), file)
      const working = readFileSync(join(repo.root, file), "utf8")
      chmodSync(join(repo.root, file), 0o755)
      const error = yield* Effect.flip(r.saveConflictResult(id(repo.root), file, "old draft\n", before.version, false))
      expect(error.stderr).toContain("changed since it was loaded")
      expect(readFileSync(join(repo.root, file), "utf8")).toBe(working)
      expect(statSync(join(repo.root, file)).mode & 0o777).toBe(0o755)
    }),
  )

  it.effect("does not overwrite a result that has already been staged elsewhere", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      const r = yield* Repo
      const before = yield* r.conflict(id(repo.root), file)
      repo.write(file, "external resolution\n")
      repo.git("add", file)
      const error = yield* Effect.flip(r.saveConflictResult(id(repo.root), file, "old draft\n", before.version, true))
      expect(error.stderr).toContain("no longer conflicted")
      expect(readFileSync(join(repo.root, file), "utf8")).toBe("external resolution\n")
      expect(repo.raw("show", `:${file}`).toString("utf8")).toBe("external resolution\n")
    }),
  )

  it.effect("does not write through a symbolic link introduced after loading", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      const outside = makeRepo()
      outside.write(file, "outside contents\n")
      const r = yield* Repo
      const before = yield* r.conflict(id(repo.root), file)
      rmSync(join(repo.root, file))
      symlinkSync(join(outside.root, file), join(repo.root, file))
      const error = yield* Effect.flip(r.saveConflictResult(id(repo.root), file, "old draft\n", before.version, true))
      expect(error.stderr).toContain("symbolic link")
      expect(readFileSync(join(outside.root, file), "utf8")).toBe("outside contents\n")
      expect(repo.git("ls-files", "--unmerged")).not.toBe("")
    }),
  )

  for (const content of ["not text\0", "x".repeat(1024 * 1024 + 1)]) {
    it.effect(`rejects ${content.includes("\0") ? "NUL bytes" : "oversized text"} without changing the file`, () =>
      Effect.gen(function* () {
        const repo = conflicted()
        const r = yield* Repo
        const before = yield* r.conflict(id(repo.root), file)
        const working = readFileSync(join(repo.root, file), "utf8")
        const error = yield* Effect.flip(r.saveConflictResult(id(repo.root), file, content, before.version, true))
        expect(error.stderr).toContain("no larger than 1 MiB")
        expect(readFileSync(join(repo.root, file), "utf8")).toBe(working)
        expect(repo.git("ls-files", "--unmerged")).not.toBe("")
      }),
    )
  }

  it.effect("serializes competing saves of the same loaded version", () =>
    Effect.gen(function* () {
      const repo = conflicted()
      const r = yield* Repo
      const before = yield* r.conflict(id(repo.root), file)
      const attempts = yield* Effect.all(
        [
          Effect.exit(r.saveConflictResult(id(repo.root), file, "first draft\n", before.version, false)),
          Effect.exit(r.saveConflictResult(id(repo.root), file, "second draft\n", before.version, false)),
        ],
        { concurrency: 2 },
      )
      expect(attempts.filter(Exit.isSuccess)).toHaveLength(1)
      expect(attempts.filter(Exit.isFailure)).toHaveLength(1)
      expect(["first draft\n", "second draft\n"]).toContain(readFileSync(join(repo.root, file), "utf8"))
      expect(repo.git("ls-files", "--unmerged")).not.toBe("")
    }),
  )
})
