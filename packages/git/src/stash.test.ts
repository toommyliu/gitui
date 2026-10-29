import { existsSync, readFileSync } from "node:fs"
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
