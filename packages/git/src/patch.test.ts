import { readFileSync } from "node:fs"
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
})
