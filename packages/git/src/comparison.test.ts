import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const services = Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer))

const diverged = () => {
  const fixture = makeRepo()
  fixture.write("shared.txt", "base\n")
  fixture.git("add", ".")
  const base = fixture.commit("base")
  fixture.git("tag", "-a", "v1", "-m", "version one")
  fixture.git("checkout", "-q", "-b", "feature")
  fixture.write("feature.txt", "feature\n")
  fixture.git("add", ".")
  const first = fixture.commit("feature one")
  fixture.write("shared.txt", "base\nfeature\n")
  fixture.git("add", ".")
  const head = fixture.commit("feature two")
  fixture.git("checkout", "-q", "main")
  fixture.write("main.txt", "main\n")
  fixture.git("add", ".")
  fixture.commit("main advanced")
  return { ...fixture, base, first, head, id: fixture.root as RepoId }
}

layer(services)("Comparisons", (it) => {
  it.effect("reviews only feature changes by default and includes base-only changes with direct comparison", () =>
    Effect.gen(function* () {
      const fixture = diverged()
      const repo = yield* Repo
      const before = fixture.git("status", "--porcelain=v2")
      const review = yield* repo.comparison(fixture.id, { base: "main", head: "feature", mode: "merge-base" })
      expect(review.start).toBe(fixture.base)
      expect(review.files).toEqual([
        { path: "feature.txt", from: null, change: "added", additions: 1, deletions: 0 },
        { path: "shared.txt", from: null, change: "modified", additions: 1, deletions: 0 },
      ])
      const direct = yield* repo.comparison(fixture.id, { base: "main", head: "feature", mode: "direct" })
      expect(direct.files.map((file) => [file.path, file.change])).toEqual([
        ["feature.txt", "added"],
        ["main.txt", "deleted"],
        ["shared.txt", "modified"],
      ])
      const diff = yield* repo.diff(fixture.id, { _tag: "Comparison", base: review.start, head: review.head }, [])
      expect(diff._tag).toBe("Patch")
      if (diff._tag === "Patch") {
        expect(diff.patch).toContain("+feature\n")
        expect(diff.patch).not.toContain("main.txt")
      }
      expect(fixture.git("status", "--porcelain=v2")).toBe(before)
    }),
  )

  it.effect("accepts tags, revision expressions and SHAs, and includes the oldest commit in a graph range", () =>
    Effect.gen(function* () {
      const fixture = diverged()
      const repo = yield* Repo
      const tagged = yield* repo.comparison(fixture.id, { base: "v1", head: "feature~1", mode: "direct" })
      expect(tagged.files.map((file) => file.path)).toEqual(["feature.txt"])
      const range = yield* repo.comparison(fixture.id, { base: fixture.first, head: fixture.head, mode: "range" })
      expect(range.start).toBe(fixture.base)
      expect(range.files.map((file) => file.path)).toEqual(["feature.txt", "shared.txt"])
      const rootRange = yield* repo.comparison(fixture.id, { base: fixture.base, head: fixture.head, mode: "range" })
      expect(rootRange.files.map((file) => [file.path, file.change])).toEqual([
        ["feature.txt", "added"],
        ["shared.txt", "added"],
      ])
      const diff = yield* repo.diff(fixture.id, { _tag: "Comparison", base: rootRange.start, head: rootRange.head }, [])
      expect(diff._tag).toBe("Patch")
      if (diff._tag === "Patch") expect(diff.patch).toContain("+base\n+feature\n")
    }),
  )

  it.effect(
    "rejects missing refs, options and non-commit objects without returning an empty successful comparison",
    () =>
      Effect.gen(function* () {
        const fixture = diverged()
        const repo = yield* Repo
        for (const base of ["missing-branch", "--output=/tmp/gitui-comparison", "HEAD^{tree}", "", "HEAD\0x"]) {
          const result = yield* Effect.result(repo.comparison(fixture.id, { base, head: "HEAD", mode: "direct" }))
          expect(result._tag).toBe("Failure")
          const invalidHead = yield* Effect.result(
            repo.comparison(fixture.id, { base: "HEAD", head: base, mode: "direct" }),
          )
          expect(invalidHead._tag).toBe("Failure")
        }
      }),
  )

  it.effect("keeps resolved endpoints stable across ref moves and selects renamed paths literally", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.write("before.txt", "one\ntwo\nthree\n")
      fixture.git("add", ".")
      fixture.commit("base")
      fixture.git("checkout", "-q", "-b", "feature")
      fixture.git("mv", "before.txt", "after [literal].txt")
      fixture.commit("rename")
      const repo = yield* Repo
      const id = fixture.root as RepoId
      const detail = yield* repo.comparison(id, { base: "main", head: "feature", mode: "direct" })
      expect(detail.files).toEqual([
        { path: "after [literal].txt", from: "before.txt", change: "renamed", additions: 0, deletions: 0 },
      ])
      fixture.write("later.txt", "later\n")
      fixture.git("add", ".")
      fixture.commit("move feature ref")
      const file = detail.files[0]!
      const diff = yield* repo.diff(id, { _tag: "Comparison", base: detail.start, head: detail.head }, [
        file.from!,
        file.path,
      ])
      expect(diff._tag).toBe("Patch")
      if (diff._tag === "Patch") {
        expect(diff.patch).toContain("rename from before.txt\nrename to after [literal].txt\n")
        expect(diff.patch).not.toContain("later.txt")
      }
      const empty = yield* repo.comparison(id, { base: "HEAD", head: "HEAD", mode: "direct" })
      expect(empty.files).toEqual([])
      expect(yield* repo.diff(id, { _tag: "Comparison", base: empty.start, head: empty.head }, [])).toEqual({
        _tag: "Empty",
      })
    }),
  )

  it.effect("allows direct comparison of unrelated histories and reports merge-base failure", () =>
    Effect.gen(function* () {
      const fixture = diverged()
      fixture.git("checkout", "-q", "--orphan", "unrelated")
      fixture.git("rm", "-q", "-rf", ".")
      fixture.write("new-history.txt", "new\n")
      fixture.git("add", ".")
      fixture.commit("new root")
      const repo = yield* Repo
      expect(
        (yield* Effect.result(repo.comparison(fixture.id, { base: "main", head: "unrelated", mode: "merge-base" })))
          ._tag,
      ).toBe("Failure")
      const direct = yield* repo.comparison(fixture.id, { base: "main", head: "unrelated", mode: "direct" })
      expect(direct.files.map((file) => [file.path, file.change])).toEqual([
        ["main.txt", "deleted"],
        ["new-history.txt", "added"],
        ["shared.txt", "deleted"],
      ])
    }),
  )
})
