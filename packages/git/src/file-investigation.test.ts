import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { Oid, RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { afterEach } from "vite-plus/test"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const roots: string[] = []
const fixture = () => {
  const f = makeRepo()
  roots.push(f.root)
  return { ...f, id: RepoId.make(f.root) }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const path = RepoPath.make("current.txt")
const source = (revision: string, name: string = path) => ({ revision: Oid.make(revision), path: RepoPath.make(name) })

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))(
  "File investigation",
  (it) => {
    it.effect("follows renames and deletion with literal historical paths and blame commit navigation", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo,
          old = RepoPath.make("old\t名\nname.txt")
        f.write(old, "first\nunchanged\n")
        f.git("add", ".")
        const first = f.commit("Create")
        f.git("mv", "--", old, path)
        const renamed = f.commit("Rename")
        f.write(path, "second\nunchanged\n")
        f.git("add", ".")
        const edited = f.commit("Edit")
        f.git("rm", "--", path)
        const deleted = f.commit("Delete")
        const history = yield* r.fileHistory(f.id, "HEAD", path)
        expect(history.entries.map((e) => [e.oid, e.path, e.from, e.change])).toEqual([
          [deleted, path, null, "deleted"],
          [edited, path, null, "modified"],
          [renamed, path, old, "renamed"],
          [first, old, null, "added"],
        ])
        expect(history.entries[0]?.parent).toBe(edited)
        expect((yield* r.fileRevision(f.id, deleted, path)).content).toEqual({ _tag: "Missing" })
        expect((yield* r.fileRevision(f.id, first, old)).content).toEqual({
          _tag: "Text",
          content: "first\nunchanged\n",
        })
        expect((yield* r.fileRevision(f.id, edited, path)).content).toEqual({
          _tag: "Text",
          content: "second\nunchanged\n",
        })
        const blame = yield* r.fileBlame(f.id, edited, path)
        expect(blame._tag).toBe("Lines")
        if (blame._tag !== "Lines") return
        expect(blame.lines.map((line) => [line.oid, line.path, line.line, line.originalLine, line.content])).toEqual([
          [edited, path, 1, 1, "second"],
          [first, old, 2, 2, "unchanged"],
        ])
        expect((yield* r.commit(f.id, blame.lines[1]!.oid)).message).toBe("Create")
        expect(f.git("rev-parse", "HEAD")).toBe(deleted)
      }),
    )
    it.effect("includes a merge resolution after later changes and restores its exact contents", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo
        f.write(path, "base\n")
        f.git("add", ".")
        f.commit("Base")
        f.git("switch", "-qc", "side")
        f.write(path, "side\n")
        f.git("add", ".")
        f.commit("Side")
        f.git("switch", "-q", "main")
        f.write(path, "main\n")
        f.git("add", ".")
        f.commit("Main")
        expect(() => f.git("merge", "side")).toThrow()
        f.write(path, "merged resolution\n")
        f.git("add", ".")
        const merge = f.commit("Resolved merge")
        f.write(path, "later\n")
        f.git("add", ".")
        const head = f.commit("Later")
        const history = yield* r.fileHistory(f.id, head, path)
        expect(history.entries.map((entry) => entry.oid)).toContain(merge)
        expect((yield* r.fileRevision(f.id, merge, path)).content).toEqual({
          _tag: "Text",
          content: "merged resolution\n",
        })
        const blame = yield* r.fileBlame(f.id, merge, path)
        expect(blame._tag).toBe("Lines")
        if (blame._tag !== "Lines") return
        expect(blame.lines.map((line) => line.oid)).toEqual([merge])
        const preview = yield* r.previewFileRestore(f.id, source(merge), path)
        yield* r.restoreFile(f.id, preview.source, path, preview.version, false)
        expect(readFileSync(join(f.root, path), "utf8")).toBe("merged resolution\n")
        expect(f.git("show", `:${path}`)).toBe("later")
        expect(f.git("rev-parse", "HEAD")).toBe(head)
      }),
    )
    it.effect("treats magic, option-like, whitespace and colon filenames literally", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo
        const names = [
          ":(glob)*",
          "--option",
          "white\nspace\t.txt",
          "file:part.txt",
          "名.txt",
          'quote"name',
          "back\\slash",
          "C:file",
        ]
        for (const name of names) f.write(name, `${name}\n`)
        f.git("add", ".")
        const revision = f.commit("Literal files")
        expect(yield* r.trackedFiles(f.id)).toEqual(
          [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
        )
        for (const name of names) {
          const literal = RepoPath.make(name)
          expect((yield* r.fileHistory(f.id, revision, literal)).entries.map((e) => e.path)).toEqual([name])
          expect((yield* r.fileRevision(f.id, revision, literal)).content).toEqual({
            _tag: "Text",
            content: `${name}\n`,
          })
          const preview = yield* r.previewFileRestore(f.id, source(revision, name), literal)
          yield* r.restoreFile(f.id, preview.source, literal, preview.version, false)
          expect(readFileSync(join(f.root, name), "utf8")).toBe(`${name}\n`)
        }
      }),
    )
    it.effect("restores clean bytes and executable mode without moving HEAD or changing the index", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo
        f.write(path, "original\r\n")
        chmodSync(join(f.root, path), 0o755)
        f.git("add", ".")
        const original = f.commit("Original")
        f.write(path, "new\n")
        chmodSync(join(f.root, path), 0o644)
        f.git("add", ".")
        const head = f.commit("New")
        const index = f.raw("ls-files", "--stage", "-z"),
          preview = yield* r.previewFileRestore(f.id, source(original), path)
        expect(preview.overwrite).toBe(false)
        yield* r.restoreFile(f.id, preview.source, path, preview.version, false)
        expect(readFileSync(join(f.root, path), "utf8")).toBe("original\r\n")
        expect(statSync(join(f.root, path)).mode & 0o111).not.toBe(0)
        expect(f.raw("ls-files", "--stage", "-z")).toEqual(index)
        expect(f.git("rev-parse", "HEAD")).toBe(head)
      }),
    )
    it.effect("requires overwrite approval and preserves separately staged bytes", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo
        f.write(path, "original\n")
        f.git("add", ".")
        const original = f.commit("Original")
        f.write(path, "staged\n")
        f.git("add", ".")
        f.write(path, "local\n")
        const preview = yield* r.previewFileRestore(f.id, source(original), path)
        expect(preview.overwrite).toBe(true)
        expect((yield* Effect.result(r.restoreFile(f.id, preview.source, path, preview.version, false)))._tag).toBe(
          "Failure",
        )
        expect(readFileSync(join(f.root, path), "utf8")).toBe("local\n")
        yield* r.restoreFile(f.id, preview.source, path, preview.version, true)
        expect(readFileSync(join(f.root, path), "utf8")).toBe("original\n")
        expect(f.git("show", `:${path}`)).toBe("staged")
      }),
    )
    it.effect("rejects stale content and stale index even when overwrite was approved", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo
        f.write(path, "original\n")
        f.git("add", ".")
        const revision = f.commit("Original")
        const preview = yield* r.previewFileRestore(f.id, source(revision), path)
        f.write(path, "arrived later\n")
        expect((yield* Effect.result(r.restoreFile(f.id, preview.source, path, preview.version, true)))._tag).toBe(
          "Failure",
        )
        expect(readFileSync(join(f.root, path), "utf8")).toBe("arrived later\n")
        const again = yield* r.previewFileRestore(f.id, source(revision), path)
        f.git("add", ".")
        expect((yield* Effect.result(r.restoreFile(f.id, again.source, path, again.version, true)))._tag).toBe(
          "Failure",
        )
        expect(f.git("show", `:${path}`)).toBe("arrived later")
      }),
    )
    it.effect("restores deleted sources into a chosen path and protects untracked files", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo
        f.write("old.txt", "old\n")
        f.git("add", ".")
        const revision = f.commit("Old")
        f.git("rm", "old.txt")
        f.commit("Delete")
        const dest = RepoPath.make("nested/restored.txt")
        let preview = yield* r.previewFileRestore(f.id, source(revision, "old.txt"), dest)
        expect(preview.overwrite).toBe(false)
        yield* r.restoreFile(f.id, preview.source, dest, preview.version, false)
        expect(readFileSync(join(f.root, dest), "utf8")).toBe("old\n")
        expect(f.git("ls-files")).toBe("")
        f.write(dest, "untracked\n")
        preview = yield* r.previewFileRestore(f.id, source(revision, "old.txt"), dest)
        expect(preview.overwrite).toBe(true)
        expect((yield* Effect.result(r.restoreFile(f.id, preview.source, dest, preview.version, false)))._tag).toBe(
          "Failure",
        )
      }),
    )
    it.effect(
      "classifies special blobs safely and restores binary and large files byte for byte",
      () =>
        Effect.gen(function* () {
          const f = fixture(),
            r = yield* Repo
          const binary = Buffer.from([0, 255, 1, 2]),
            invalid = Buffer.from([255, 254]),
            large = Buffer.alloc(1024 * 1024 + 1, 65)
          writeFileSync(join(f.root, "binary"), binary)
          writeFileSync(join(f.root, "invalid"), invalid)
          writeFileSync(join(f.root, "large"), large)
          symlinkSync("../../outside", join(f.root, "link"))
          f.git("add", ".")
          const revision = f.commit("Special files")
          for (const [name, tag] of [
            ["binary", "Binary"],
            ["invalid", "Binary"],
            ["large", "TooLarge"],
            ["link", "Symlink"],
          ] as const) {
            expect((yield* r.fileRevision(f.id, revision, RepoPath.make(name))).content._tag).toBe(tag)
            expect((yield* r.fileBlame(f.id, revision, RepoPath.make(name)))._tag).toBe("Unavailable")
          }
          expect((yield* r.fileRevision(f.id, revision, RepoPath.make("link"))).content).toEqual({
            _tag: "Symlink",
            target: "../../outside",
          })
          for (const [name, bytes] of [
            ["binary", binary],
            ["large", large],
          ] as const) {
            const dest = RepoPath.make(`copy-${name}`),
              preview = yield* r.previewFileRestore(f.id, source(revision, name), dest)
            yield* r.restoreFile(f.id, preview.source, dest, preview.version, false)
            expect(readFileSync(join(f.root, dest))).toEqual(bytes)
          }
          const preview = yield* r.previewFileRestore(f.id, source(revision, "link"), RepoPath.make("copy-link"))
          expect(preview.unavailable).toContain("symbolic links")
          expect(
            (yield* Effect.result(r.restoreFile(f.id, preview.source, preview.destination, preview.version, true)))
              ._tag,
          ).toBe("Failure")
          expect(existsSync(join(f.root, "copy-link"))).toBe(false)
        }),
      15_000,
    )
    it.effect("refuses oversized restores and submodules", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo
        writeFileSync(join(f.root, "huge"), Buffer.alloc(16 * 1024 * 1024 + 1, 65))
        f.git("add", ".")
        const base = f.commit("Huge")
        f.git("update-index", "--add", "--cacheinfo", `160000,${base},module`)
        const revision = f.commit("Module")
        expect((yield* r.fileRevision(f.id, revision, RepoPath.make("module"))).content._tag).toBe("Submodule")
        for (const name of ["huge", "module"]) {
          const preview = yield* r.previewFileRestore(f.id, source(revision, name), RepoPath.make(`copy-${name}`))
          expect(preview.unavailable).not.toBeNull()
          expect(
            (yield* Effect.result(r.restoreFile(f.id, preview.source, preview.destination, preview.version, true)))
              ._tag,
          ).toBe("Failure")
        }
      }),
    )
    it.effect("protects relocated Git metadata during preview and stale restores", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo
        const metadataIndex = RepoPath.make("metadata/index")
        f.write(metadataIndex, "historical file, not an index\n")
        f.git("add", ".")
        const revision = f.commit("Historical metadata path")
        f.git("rm", metadataIndex)
        f.commit("Remove historical path")
        const preview = yield* r.previewFileRestore(f.id, source(revision, metadataIndex), metadataIndex)
        f.git("init", "--separate-git-dir", "metadata")
        const index = readFileSync(join(f.root, metadataIndex))
        expect((yield* Effect.result(r.previewFileRestore(f.id, preview.source, metadataIndex)))._tag).toBe("Failure")
        expect(
          (yield* Effect.result(r.restoreFile(f.id, preview.source, metadataIndex, preview.version, true)))._tag,
        ).toBe("Failure")
        expect(readFileSync(join(f.root, metadataIndex))).toEqual(index)
        expect(f.git("status", "--porcelain")).toBe("?? metadata/")
      }),
    )
    it.effect("protects the common Git directory inside a linked worktree", () =>
      Effect.gen(function* () {
        const f = fixture(),
          r = yield* Repo
        const metadataIndex = RepoPath.make("metadata/index")
        f.write(metadataIndex, "historical file, not an index\n")
        f.git("add", ".")
        const revision = f.commit("Historical metadata path")
        f.git("rm", metadataIndex)
        f.commit("Remove historical path")
        const linked = join(f.root, "linked")
        f.git("worktree", "add", "-qb", "linked", linked)
        f.git("init", "--separate-git-dir", join(linked, "metadata"))
        f.git("worktree", "repair", linked)
        const repo = RepoId.make(linked)
        const commonIndex = readFileSync(join(linked, metadataIndex))
        const linkedIndexPath = join(linked, "metadata/worktrees/linked/index")
        const linkedIndex = readFileSync(linkedIndexPath)
        for (const destination of [metadataIndex, RepoPath.make("metadata/worktrees/linked/index")]) {
          expect(
            (yield* Effect.result(r.previewFileRestore(repo, source(revision, metadataIndex), destination)))._tag,
          ).toBe("Failure")
          expect(
            (yield* Effect.result(r.restoreFile(repo, source(revision, metadataIndex), destination, "", true)))._tag,
          ).toBe("Failure")
        }
        expect(readFileSync(join(linked, metadataIndex))).toEqual(commonIndex)
        expect(readFileSync(linkedIndexPath)).toEqual(linkedIndex)
        expect(f.git("-C", linked, "status", "--porcelain")).toBe("?? metadata/")
      }),
    )
    it.effect("rejects invalid revisions, traversal and symlink destinations or parents", () =>
      Effect.gen(function* () {
        const f = fixture(),
          outside = fixture(),
          r = yield* Repo
        f.write(path, "safe\n")
        f.git("add", ".")
        const revision = f.commit("Safe")
        outside.write("victim", "untouched\n")
        symlinkSync(join(outside.root, "victim"), join(f.root, "link"))
        symlinkSync(outside.root, join(f.root, "dir"))
        mkdirSync(join(f.root, "directory"))
        for (const name of ["../victim", ".git/config", "/tmp/escape", "dir/victim", "link", "directory"]) {
          expect((yield* Effect.result(r.previewFileRestore(f.id, source(revision), RepoPath.make(name))))._tag).toBe(
            "Failure",
          )
        }
        for (const ref of ["no-such-ref", "--help", "HEAD:path", "HEAD\0oops"]) {
          expect((yield* Effect.result(r.fileRevision(f.id, ref, path)))._tag).toBe("Failure")
          expect((yield* Effect.result(r.fileHistory(f.id, ref, path)))._tag).toBe("Failure")
          expect((yield* Effect.result(r.fileBlame(f.id, ref, path)))._tag).toBe("Failure")
        }
        const dest = RepoPath.make("new.txt"),
          preview = yield* r.previewFileRestore(f.id, source(revision), dest)
        symlinkSync(join(outside.root, "victim"), join(f.root, dest))
        expect((yield* Effect.result(r.restoreFile(f.id, preview.source, dest, preview.version, true)))._tag).toBe(
          "Failure",
        )
        expect(readFileSync(join(outside.root, "victim"), "utf8")).toBe("untouched\n")
      }),
    )
  },
)
