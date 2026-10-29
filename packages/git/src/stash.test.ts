import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { Oid, RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const setup = () => {
  const repo = makeRepo()
  repo.write("selected", "base\n")
  repo.write("other", "base\n")
  repo.git("add", ".")
  repo.commit("base")
  return repo
}
const id = (root: string) => root as RepoId
const paths = (...paths: Array<string>) => paths as Array<RepoPath>
const disk = (repo: ReturnType<typeof makeRepo>, path: string) => readFileSync(join(repo.root, path), "utf8")

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Repo.stashPush", (it) => {
  it.effect("rejects restoration over an unselected indexed parent without expanding stash scope", () =>
    Effect.gen(function* () {
      const r = yield* Repo
      for (const includeUntracked of [false, true]) {
        const repo = setup()
        repo.write("dir/file", "original child\n")
        repo.git("add", "dir/file")
        repo.commit("nested file")
        repo.git("rm", "dir/file")
        repo.write("dir", "staged parent\n")
        repo.git("add", "dir")
        repo.write("dir", "unstaged parent\n")
        const index = repo.git("write-tree")
        const before = repo.raw("status", "--porcelain", "-z")
        const error = yield* Effect.flip(r.stashPush(id(repo.root), "", includeUntracked, paths("dir/file")))
        expect(error.stderr).toContain("unselected tracked files")
        expect(repo.raw("show", ":dir").toString()).toBe("staged parent\n")
        expect(disk(repo, "dir")).toBe("unstaged parent\n")
        expect(repo.git("write-tree")).toBe(index)
        expect(repo.raw("status", "--porcelain", "-z")).toEqual(before)
        expect(repo.git("stash", "list")).toBe("")
        yield* r.stashPush(id(repo.root), "both selected", includeUntracked, paths("dir/file", "dir"))
        expect(disk(repo, "dir/file")).toBe("original child\n")
        expect(repo.raw("show", "stash:dir").toString()).toBe("unstaged parent\n")
        expect(repo.raw("show", "stash^2:dir").toString()).toBe("staged parent\n")
        yield* r.stashApply(id(repo.root), repo.git("rev-parse", "refs/stash") as Oid, true)
        expect(disk(repo, "dir")).toBe("unstaged parent\n")
        expect(repo.git("stash", "list")).toBe("")
      }
    }),
  )

  it.effect("preserves differently cased directory obstructions using filesystem equivalence", () =>
    Effect.gen(function* () {
      const r = yield* Repo
      for (const keepIndex of [false, true]) {
        for (const ignored of [false, true]) {
          for (const ignoreCase of [false, true]) {
            const repo = setup()
            const aliases = existsSync(join(repo.root, "SELECTED"))
            repo.git("config", "core.ignoreCase", String(ignoreCase))
            rmSync(join(repo.root, "selected"))
            repo.write("SELECTED/new", "unsaved alias\n")
            if (ignored) repo.write(".git/info/exclude", "SELECTED/\n")
            const index = repo.git("write-tree")
            const before = repo.raw("status", "--porcelain", "-z")
            const stash = r.stashPush(id(repo.root), "case-aware", false, paths("selected"), keepIndex)
            if (aliases) {
              const error = yield* Effect.flip(stash)
              expect(error.stderr).toContain("would be overwritten")
              expect(repo.raw("status", "--porcelain", "-z")).toEqual(before)
              expect(repo.git("stash", "list")).toBe("")
            } else {
              yield* stash
              expect(repo.git("stash", "list")).toContain("case-aware")
            }
            expect(disk(repo, "SELECTED/new")).toBe("unsaved alias\n")
            expect(repo.git("write-tree")).toBe(index)
          }
        }
      }
    }),
  )

  it.effect("rejects unsaved files inside a directory replacing a tracked file before cleanup", () =>
    Effect.gen(function* () {
      const r = yield* Repo
      for (const keepIndex of [false, true]) {
        for (const ignored of [false, true]) {
          const repo = setup()
          rmSync(join(repo.root, "selected"))
          repo.write("selected/new", "unsaved content\n")
          if (ignored) repo.write(".git/info/exclude", "selected/\n")
          const index = repo.git("write-tree")
          const before = repo.raw("status", "--porcelain", "-z")
          const error = yield* Effect.flip(r.stashPush(id(repo.root), "", ignored, paths("selected"), keepIndex))
          expect(error.stderr).toContain("would be overwritten")
          expect(disk(repo, "selected/new")).toBe("unsaved content\n")
          expect(repo.git("write-tree")).toBe(index)
          expect(repo.raw("status", "--porcelain", "-z")).toEqual(before)
          expect(repo.git("stash", "list")).toBe("")
        }
      }
    }),
  )

  it.effect("preserves ignored content recreated at a staged deletion", () =>
    Effect.gen(function* () {
      const r = yield* Repo
      for (const includeUntracked of [false, true]) {
        const repo = setup()
        repo.git("rm", "selected")
        repo.write("selected", "ignored content\n")
        repo.write(".git/info/exclude", "/selected\n")
        const index = repo.git("write-tree")
        const error = yield* Effect.flip(r.stashPush(id(repo.root), "", includeUntracked, paths("selected")))
        expect(error.stderr).toContain("would be overwritten")
        expect(disk(repo, "selected")).toBe("ignored content\n")
        expect(repo.git("write-tree")).toBe(index)
        expect(repo.git("stash", "list")).toBe("")
      }
    }),
  )

  it.effect("preserves an untracked file obstructing a selected path's parent directory", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("folder/file", "tracked content\n")
      repo.git("add", "folder/file")
      repo.commit("nested file")
      rmSync(join(repo.root, "folder"), { recursive: true })
      repo.write("folder", "unsaved parent\n")
      const index = repo.git("write-tree")
      const error = yield* Effect.flip((yield* Repo).stashPush(id(repo.root), "", true, paths("folder/file")))
      expect(error.stderr).toContain("would be overwritten")
      expect(disk(repo, "folder")).toBe("unsaved parent\n")
      expect(repo.git("write-tree")).toBe(index)
      expect(repo.git("stash", "list")).toBe("")
    }),
  )

  it.effect("saves a copy of staged-only changes while keeping them staged in either scope", () =>
    Effect.gen(function* () {
      const r = yield* Repo
      for (const scope of [paths("selected"), null]) {
        const repo = setup()
        repo.write("selected", "staged only\n")
        repo.git("add", "selected")
        const index = repo.git("write-tree")
        yield* r.stashPush(id(repo.root), "staged copy", false, scope, true)
        expect(repo.git("stash", "list")).toContain("staged copy")
        expect(repo.raw("show", "stash:selected").toString()).toBe("staged only\n")
        expect(repo.raw("show", "stash^2:selected").toString()).toBe("staged only\n")
        expect(repo.git("write-tree")).toBe(index)
        expect(disk(repo, "selected")).toBe("staged only\n")
        expect(repo.git("diff")).toBe("")
      }
    }),
  )

  it.effect("creates no keep-index stash when the selected file is unchanged", () =>
    Effect.gen(function* () {
      const repo = setup()
      yield* (yield* Repo).stashPush(id(repo.root), "unchanged", false, paths("selected"), true)
      expect(repo.git("stash", "list")).toBe("")
      expect(repo.git("status", "--porcelain")).toBe("")
    }),
  )

  it.effect("stashes only selected tracked and untracked literal paths and applies/drops the stash", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("selected", "staged\n")
      repo.git("add", "selected")
      repo.write("selected", "staged\nunstaged\n")
      repo.write("other", "unrelated staged\n")
      repo.git("add", "other")
      repo.write("other", "unrelated staged\nunrelated unstaged\n")
      const special = ":(glob)* [x]\nfile.txt"
      repo.write(special, "new\n")
      repo.write("unselected.txt", "keep\n")
      const r = yield* Repo
      yield* r.stashPush(id(repo.root), "selected files", true, paths("selected", special))
      expect(disk(repo, "selected")).toBe("base\n")
      expect(repo.raw("show", ":selected").toString()).toBe("base\n")
      expect(disk(repo, "other")).toBe("unrelated staged\nunrelated unstaged\n")
      expect(repo.raw("show", ":other").toString()).toBe("unrelated staged\n")
      expect(existsSync(join(repo.root, special))).toBe(false)
      expect(disk(repo, "unselected.txt")).toBe("keep\n")
      expect(repo.git("diff", "--name-only", "stash^", "stash")).toBe("selected")
      expect(repo.git("diff", "--name-only", "stash^", "stash^2")).toBe("selected")
      const oid = repo.git("rev-parse", "refs/stash") as Oid
      yield* r.stashApply(id(repo.root), oid, false)
      expect(disk(repo, "selected")).toBe("staged\nunstaged\n")
      expect(disk(repo, special)).toBe("new\n")
      yield* r.stashDrop(id(repo.root), oid)
      expect(repo.git("stash", "list")).toBe("")
    }),
  )

  it.effect("stashes unstaged changes while keeping staged content and unselected paths intact", () =>
    Effect.gen(function* () {
      const repo = setup()
      const base = Array.from({ length: 12 }, (_, i) => `line ${i + 1}\n`).join("")
      const staged = base.replace("line 2\n", "staged\n")
      const unstaged = staged.replace("line 10\n", "unstaged\n")
      repo.write("selected", base)
      repo.git("add", "selected")
      repo.commit("multiline base")
      repo.write("selected", staged)
      repo.git("add", "selected")
      repo.write("selected", unstaged)
      repo.write("other", "keep\n")
      repo.write("new", "untracked\n")
      const r = yield* Repo
      yield* r.stashPush(id(repo.root), "keep index", true, paths("selected", "new"), true)
      expect(disk(repo, "selected")).toBe(staged)
      expect(repo.raw("show", ":selected").toString()).toBe(staged)
      expect(disk(repo, "other")).toBe("keep\n")
      expect(existsSync(join(repo.root, "new"))).toBe(false)
      expect(repo.git("rev-parse", "stash^1")).toBe(repo.git("rev-parse", "HEAD"))
      repo.commit("staged work")
      yield* r.stashApply(id(repo.root), repo.git("rev-parse", "refs/stash") as Oid, true)
      expect(disk(repo, "selected")).toBe(unstaged)
      expect(disk(repo, "new")).toBe("untracked\n")
      expect(repo.git("stash", "list")).toBe("")
    }),
  )

  it.effect("leaves untracked files alone when excluded and rejects empty scope", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("selected", "edit\n")
      repo.write("new", "keep\n")
      const r = yield* Repo
      const error = yield* Effect.flip(r.stashPush(id(repo.root), "", true, []))
      expect(error.stderr).toContain("Select at least one file")
      expect(disk(repo, "selected")).toBe("edit\n")
      expect(repo.git("stash", "list")).toBe("")
      yield* r.stashPush(id(repo.root), "", false, paths("selected"))
      expect(disk(repo, "selected")).toBe("base\n")
      expect(disk(repo, "new")).toBe("keep\n")
    }),
  )

  it.effect("stashes a rename and restores its destination without touching other work", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.git("mv", "selected", "renamed")
      repo.write("renamed", "renamed edit\n")
      repo.write("other", "keep\n")
      const r = yield* Repo
      yield* r.stashPush(id(repo.root), "rename", false, paths("selected", "renamed"))
      expect(disk(repo, "selected")).toBe("base\n")
      expect(existsSync(join(repo.root, "renamed"))).toBe(false)
      expect(disk(repo, "other")).toBe("keep\n")
      yield* r.stashApply(id(repo.root), repo.git("rev-parse", "refs/stash") as Oid, true)
      expect(disk(repo, "renamed")).toBe("renamed edit\n")
      expect(existsSync(join(repo.root, "selected"))).toBe(false)
      expect(disk(repo, "other")).toBe("keep\n")
    }),
  )

  it.effect("preserves whole-repository stashing and keep-index without a file scope", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("selected", "staged\n")
      repo.git("add", "selected")
      repo.write("other", "unstaged\n")
      repo.write("new", "untracked\n")
      const r = yield* Repo
      yield* r.stashPush(id(repo.root), "all unstaged", true, null, true)
      expect(disk(repo, "selected")).toBe("staged\n")
      expect(repo.raw("show", ":selected").toString()).toBe("staged\n")
      expect(disk(repo, "other")).toBe("base\n")
      expect(existsSync(join(repo.root, "new"))).toBe(false)
      yield* r.stashPush(id(repo.root), "remaining staged", false)
      expect(disk(repo, "selected")).toBe("base\n")
      expect(repo.git("diff", "--cached")).toBe("")
      expect(repo.git("stash", "list").split("\n")).toHaveLength(2)
    }),
  )
})
