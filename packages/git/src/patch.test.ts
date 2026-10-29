import { chmodSync, existsSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { LineSelection, RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const lines = (n: number, edit: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join("\n") + "\n"

const setup = () => {
  const repo = makeRepo()
  repo.write("f.txt", lines(12))
  repo.git("add", ".")
  repo.commit("base")
  return repo
}

const id = (root: string) => root as RepoId
const file = "f.txt" as RepoPath
const pick = (side: LineSelection["side"], line: number, text: string): LineSelection => ({ side, line, text })

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Repo.applyLines", (it) => {
  it.effect("stages one of two separate changes and leaves the working tree alone", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("f.txt", lines(12, { 2: "two", 10: "ten" }))
      yield* (yield* Repo).applyLines(id(repo.root), "stage", file, [
        pick("old", 10, "line 10"),
        pick("new", 10, "ten"),
      ])
      expect(repo.git("show", ":f.txt") + "\n").toBe(lines(12, { 10: "ten" }))
      expect(readFileSync(join(repo.root, "f.txt"), "utf8")).toBe(lines(12, { 2: "two", 10: "ten" }))
    }),
  )

  it.effect("unstages one change from a fully staged file", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("f.txt", lines(12, { 2: "two", 10: "ten" }))
      repo.git("add", "f.txt")
      yield* (yield* Repo).applyLines(id(repo.root), "unstage", file, [pick("old", 2, "line 2"), pick("new", 2, "two")])
      expect(repo.git("show", ":f.txt") + "\n").toBe(lines(12, { 10: "ten" }))
    }),
  )

  it.effect("discards one change from the working tree and keeps the index", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("f.txt", lines(12, { 2: "two", 10: "ten" }))
      yield* (yield* Repo).applyLines(id(repo.root), "discard", file, [pick("old", 2, "line 2"), pick("new", 2, "two")])
      expect(readFileSync(join(repo.root, "f.txt"), "utf8")).toBe(lines(12, { 10: "ten" }))
      expect(repo.git("show", ":f.txt") + "\n").toBe(lines(12))
    }),
  )

  it.effect("stages part of a replacement block", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("f.txt", lines(12, { 5: "five", 6: "six" }))
      yield* (yield* Repo).applyLines(id(repo.root), "stage", file, [pick("old", 5, "line 5"), pick("new", 5, "five")])
      expect(repo.git("show", ":f.txt") + "\n").toBe(lines(12, { 5: "five" }))
    }),
  )

  it.effect("stages the second pair of a replacement block", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("f.txt", lines(12, { 5: "five", 6: "six" }))
      yield* (yield* Repo).applyLines(id(repo.root), "stage", file, [pick("old", 6, "line 6"), pick("new", 6, "six")])
      expect(repo.git("show", ":f.txt") + "\n").toBe(lines(12, { 6: "six" }))
    }),
  )

  it.effect("unstages the first pair of a staged replacement block", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("f.txt", lines(12, { 5: "five", 6: "six" }))
      repo.git("add", "f.txt")
      yield* (yield* Repo).applyLines(id(repo.root), "unstage", file, [
        pick("old", 5, "line 5"),
        pick("new", 5, "five"),
      ])
      expect(repo.git("show", ":f.txt") + "\n").toBe(lines(12, { 6: "six" }))
    }),
  )

  it.effect("keeps trailing whitespace even when apply.whitespace=fix is configured", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.git("config", "apply.whitespace", "fix")
      repo.write("f.txt", lines(12, { 3: "three   " }))
      yield* (yield* Repo).applyLines(id(repo.root), "stage", file, [
        pick("old", 3, "line 3"),
        pick("new", 3, "three   "),
      ])
      expect(repo.git("cat-file", "-p", ":f.txt").split("\n")[2]).toBe("three   ")
    }),
  )

  it.effect("refuses a stale selection without touching the index", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("f.txt", lines(12, { 2: "edited again" }))
      const error = yield* Effect.flip(
        (yield* Repo).applyLines(id(repo.root), "stage", file, [pick("old", 2, "line 2"), pick("new", 2, "two")]),
      )
      expect(error.stderr).toBe("The file changed since you selected these lines.")
      expect(repo.git("show", ":f.txt") + "\n").toBe(lines(12))
    }),
  )
  it.effect("stages a new-file subset, then unstages part without changing disk content", () =>
    Effect.gen(function* () {
      const repo = setup()
      const path = "new [literal]*.txt" as RepoPath
      repo.write(path, "first\nsecond\nthird")
      const r = yield* Repo
      yield* r.applyLines(id(repo.root), "stage", path, [pick("new", 1, "first"), pick("new", 3, "third")])
      expect(repo.raw("show", `:${path}`).toString()).toBe("first\nthird")
      yield* r.applyLines(id(repo.root), "unstage", path, [pick("new", 1, "first")])
      expect(repo.raw("show", `:${path}`).toString()).toBe("third")
      expect(readFileSync(join(repo.root, path), "utf8")).toBe("first\nsecond\nthird")
      yield* r.applyLines(id(repo.root), "unstage", path, [pick("new", 1, "third")])
      expect(repo.git("ls-files", "--", path)).toBe("")
      expect(readFileSync(join(repo.root, path), "utf8")).toBe("first\nsecond\nthird")
    }),
  )

  it.effect("stages selected deletion lines and restores selected lines from a staged deletion", () =>
    Effect.gen(function* () {
      const repo = setup()
      rmSync(join(repo.root, file))
      const r = yield* Repo
      yield* r.applyLines(id(repo.root), "stage", file, [pick("old", 2, "line 2")])
      expect(repo.raw("show", ":f.txt").toString()).toBe(lines(12).replace("line 2\n", ""))
      expect(existsSync(join(repo.root, file))).toBe(false)
      repo.git("add", "-A")
      yield* r.applyLines(id(repo.root), "unstage", file, [pick("old", 2, "line 2")])
      expect(repo.raw("show", ":f.txt").toString()).toBe("line 2\n")
      expect(existsSync(join(repo.root, file))).toBe(false)
    }),
  )

  it.effect("unstages text edits in a rename while retaining the staged rename", () =>
    Effect.gen(function* () {
      const repo = setup()
      const path = 'new "name" [x].txt' as RepoPath
      repo.git("mv", file, path)
      repo.write(path, lines(12, { 2: "two", 10: "ten" }))
      repo.git("add", "-A")
      const r = yield* Repo
      yield* r.applyLines(id(repo.root), "unstage", path, [pick("old", 2, "line 2"), pick("new", 2, "two")])
      expect(repo.raw("show", `:${path}`).toString()).toBe(lines(12, { 10: "ten" }))
      expect(repo.git("ls-files", "--", file)).toBe("")
      expect(readFileSync(join(repo.root, path), "utf8")).toBe(lines(12, { 2: "two", 10: "ten" }))
      yield* r.applyLines(id(repo.root), "stage", path, [pick("old", 2, "line 2"), pick("new", 2, "two")])
      expect(repo.raw("show", `:${path}`).toString()).toBe(lines(12, { 2: "two", 10: "ten" }))
    }),
  )

  it.effect("uses index content when a file has both staged and unstaged edits", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write(file, lines(12, { 2: "staged" }))
      repo.git("add", file)
      repo.write(file, lines(12, { 2: "staged", 10: "unstaged" }))
      const r = yield* Repo
      yield* r.applyLines(id(repo.root), "stage", file, [pick("old", 10, "line 10"), pick("new", 10, "unstaged")])
      yield* r.applyLines(id(repo.root), "unstage", file, [pick("old", 2, "line 2"), pick("new", 2, "staged")])
      expect(repo.raw("show", ":f.txt").toString()).toBe(lines(12, { 10: "unstaged" }))
      expect(readFileSync(join(repo.root, file), "utf8")).toBe(lines(12, { 2: "staged", 10: "unstaged" }))
    }),
  )

  it.effect("preserves positions after an earlier staged insertion when unstaging", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write(file, "inserted\n" + lines(12, { 10: "ten" }))
      repo.git("add", file)
      yield* (yield* Repo).applyLines(id(repo.root), "unstage", file, [
        pick("old", 10, "line 10"),
        pick("new", 11, "ten"),
      ])
      expect(repo.raw("show", ":f.txt").toString()).toBe("inserted\n" + lines(12))
    }),
  )

  it.effect("rejects empty and stale new-file selections without creating index entries", () =>
    Effect.gen(function* () {
      const repo = setup()
      const r = yield* Repo
      repo.write("empty", "")
      repo.write("new", "changed")
      for (const [path, selected] of [
        ["empty", []],
        ["new", [pick("new", 1, "old")]],
      ] as const) {
        const error = yield* Effect.flip(r.applyLines(id(repo.root), "stage", path as RepoPath, selected))
        expect(error.stderr).toMatch(/selected|changed/)
      }
      expect(repo.git("diff", "--cached")).toBe("")
    }),
  )

  it.effect("rejects binary, mode changes, symlink and submodule selections", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write("binary", "a\0b")
      symlinkSync("f.txt", join(repo.root, "link"))
      chmodSync(join(repo.root, file), 0o755)
      repo.git("update-index", "--add", "--cacheinfo", `160000,${repo.git("rev-parse", "HEAD")},module`)
      const r = yield* Repo
      for (const [path, action] of [
        ["binary", "stage"],
        ["link", "stage"],
        [file, "stage"],
        ["module", "unstage"],
      ] as const) {
        const before = repo.raw("ls-files", "--stage")
        const error = yield* Effect.flip(
          r.applyLines(id(repo.root), action, path as RepoPath, [pick("new", 1, "f.txt")]),
        )
        expect(error.stderr).toContain("whole-file")
        expect(repo.raw("ls-files", "--stage")).toEqual(before)
      }
    }),
  )

  it.effect("handles no-newline deletions and full text deletions without recreating disk files", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write(file, "one\ntwo")
      repo.git("add", file)
      repo.commit("no newline")
      rmSync(join(repo.root, file))
      const r = yield* Repo
      yield* r.applyLines(id(repo.root), "stage", file, [pick("old", 2, "two")])
      expect(repo.raw("show", ":f.txt").toString()).toBe("one\n")
      yield* r.applyLines(id(repo.root), "stage", file, [pick("old", 1, "one")])
      expect(repo.git("ls-files", "--", file)).toBe("")
      yield* r.applyLines(id(repo.root), "unstage", file, [pick("old", 2, "two")])
      expect(repo.raw("show", ":f.txt").toString()).toBe("two")
      expect(existsSync(join(repo.root, file))).toBe(false)
    }),
  )

  it.effect("stages from and to empty tracked text files and handles newline-only content", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write(file, "")
      repo.git("add", file)
      repo.commit("empty")
      repo.write(file, "one\ntwo")
      const r = yield* Repo
      yield* r.applyLines(id(repo.root), "stage", file, [pick("new", 2, "two")])
      expect(repo.raw("show", ":f.txt").toString()).toBe("two")
      yield* r.applyLines(id(repo.root), "unstage", file, [pick("new", 1, "two")])
      expect(repo.raw("show", ":f.txt").toString()).toBe("")
      repo.write("blank", "\n\n")
      yield* r.applyLines(id(repo.root), "stage", "blank" as RepoPath, [pick("new", 2, "")])
      expect(repo.raw("show", ":blank").toString()).toBe("\n")
    }),
  )
  it.effect("preserves an unterminated original line when staging only an addition", () =>
    Effect.gen(function* () {
      const repo = setup()
      repo.write(file, "old")
      repo.git("add", file)
      repo.commit("unterminated")
      repo.write(file, "new\nnext\n")
      yield* (yield* Repo).applyLines(id(repo.root), "stage", file, [pick("new", 2, "next")])
      expect(repo.raw("show", ":f.txt").toString()).toBe("next\nold")
      expect(readFileSync(join(repo.root, file), "utf8")).toBe("new\nnext\n")
    }),
  )

  it.effect("rejects a regular-file to symlink type change in both directions", () =>
    Effect.gen(function* () {
      const repo = setup()
      rmSync(join(repo.root, file))
      symlinkSync("target", join(repo.root, file))
      const r = yield* Repo
      const staging = yield* Effect.flip(r.applyLines(id(repo.root), "stage", file, [pick("old", 2, "line 2")]))
      expect(staging.stderr).toContain("whole-file")
      expect(repo.raw("show", ":f.txt").toString()).toBe(lines(12))
      repo.git("add", file)
      const unstaging = yield* Effect.flip(r.applyLines(id(repo.root), "unstage", file, [pick("old", 2, "line 2")]))
      expect(unstaging.stderr).toContain("whole-file")
      expect(repo.git("ls-files", "--stage", file)).toMatch(/^120000 /)
    }),
  )
})
