import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const id = (root: string) => root as RepoId
const file = "a.txt" as RepoPath

const diverged = () => {
  const repo = makeRepo()
  repo.write("a.txt", "base\n")
  repo.git("add", ".")
  repo.commit("base")
  repo.git("switch", "-q", "-c", "topic")
  repo.write("a.txt", "topic\n")
  repo.git("commit", "-q", "-am", "topic change")
  const topic = repo.git("rev-parse", "HEAD")
  repo.git("switch", "-q", "main")
  repo.write("a.txt", "main\n")
  repo.git("commit", "-q", "-am", "main change")
  return { repo, topic }
}

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Repo operations", (it) => {
  it.effect("resolves a merge conflict with theirs and finishes the merge", () =>
    Effect.gen(function* () {
      const { repo } = diverged()
      expect(() => repo.git("merge", "-q", "topic")).toThrow()
      const r = yield* Repo
      expect((yield* r.status(id(repo.root))).operation).toBe("merge")

      yield* r.resolveConflict(id(repo.root), [file], "theirs")
      yield* r.continueOperation(id(repo.root))

      expect((yield* r.status(id(repo.root))).operation).toBe(null)
      expect(repo.git("rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toHaveLength(3)
      expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("topic\n")
    }),
  )

  it.effect("aborts a conflicted rebase back to where the branch was", () =>
    Effect.gen(function* () {
      const { repo, topic } = diverged()
      repo.git("switch", "-q", "topic")
      expect(() => repo.git("rebase", "-q", "main")).toThrow()
      const r = yield* Repo
      expect((yield* r.status(id(repo.root))).operation).toBe("rebase")

      yield* r.abortOperation(id(repo.root))

      expect((yield* r.status(id(repo.root))).operation).toBe(null)
      expect(repo.git("rev-parse", "HEAD")).toBe(topic)
    }),
  )

  it.effect("continues a rebase after keeping the upstream side, dropping the now-empty commit", () =>
    Effect.gen(function* () {
      const { repo } = diverged()
      repo.git("switch", "-q", "topic")
      expect(() => repo.git("rebase", "-q", "main")).toThrow()
      const r = yield* Repo

      yield* r.resolveConflict(id(repo.root), [file], "ours")
      yield* r.continueOperation(id(repo.root))

      expect((yield* r.status(id(repo.root))).operation).toBe(null)
      expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("main\n")
      expect(repo.git("rev-parse", "HEAD")).toBe(repo.git("rev-parse", "main"))
    }),
  )

  it.effect("resolves several conflicted files with one side at once", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "base\n")
      repo.write("b.txt", "base\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.git("switch", "-q", "-c", "topic")
      repo.write("a.txt", "topic a\n")
      repo.write("b.txt", "topic b\n")
      repo.git("commit", "-q", "-am", "topic change")
      repo.git("switch", "-q", "main")
      repo.write("a.txt", "main a\n")
      repo.write("b.txt", "main b\n")
      repo.git("commit", "-q", "-am", "main change")
      expect(() => repo.git("merge", "-q", "topic")).toThrow()
      const r = yield* Repo

      yield* r.resolveConflict(id(repo.root), ["a.txt" as RepoPath, "b.txt" as RepoPath], "theirs")

      expect((yield* r.status(id(repo.root))).entries.map((entry) => entry._tag)).toEqual(["Tracked", "Tracked"])
      expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("topic a\n")
      expect(readFileSync(join(repo.root, "b.txt"), "utf8")).toBe("topic b\n")
    }),
  )

  it.effect("refuses to continue when nothing is in progress", () =>
    Effect.gen(function* () {
      const { repo } = diverged()
      const error = yield* Effect.flip((yield* Repo).continueOperation(id(repo.root)))
      expect(error.stderr).toBe("Nothing is in progress.")
    }),
  )
})
