import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { DiffTarget, Oid, RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"
import { Worktrees } from "./worktree.ts"

const services = Layer.merge(Repo.layer, Worktrees.layer).pipe(
  Layer.provide(CommandLog.layer),
  Layer.provide(NodeServices.layer),
)

layer(services)("Large diffs", (it) => {
  it.effect("keeps the 4 MB limit by default and returns the complete patch only when requested", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.write("large.txt", "base\n")
      fixture.git("add", ".")
      const base = fixture.commit("base") as Oid
      const body = `${"large change with enough text to exceed the default display limit\n".repeat(70_000)}last line\n`
      fixture.write("large.txt", body)
      const repo = yield* Repo
      const id = fixture.root as RepoId
      const paths = ["large.txt" as RepoPath]
      const check = Effect.fn(function* (target: DiffTarget) {
        const limited = yield* repo.diff(id, target, paths)
        expect(limited._tag).toBe("TooLarge")
        const full = yield* repo.diff(id, target, paths, false, true)
        expect(full._tag).toBe("Patch")
        if (limited._tag !== "TooLarge" || full._tag !== "Patch") return
        expect(limited.bytes).toBeGreaterThan(4 * 1024 * 1024)
        expect(Buffer.byteLength(full.patch)).toBe(limited.bytes)
        expect(full.patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"))).toHaveLength(
          70_001,
        )
        expect(full.patch).toContain("+last line\n")
        expect(yield* repo.diff(id, target, paths)).toEqual(limited)
      })

      yield* check({ _tag: "Unstaged" })
      fixture.git("add", ".")
      yield* check({ _tag: "Staged" })
      const oid = fixture.commit("large change") as Oid
      yield* check({ _tag: "Commit", oid })
      yield* check({ _tag: "Comparison", base, head: oid })
      fixture.write("new.txt", body)
      const untracked = yield* repo.diff(id, { _tag: "Untracked" }, ["new.txt" as RepoPath])
      expect(untracked._tag).toBe("TooLarge")
      const full = yield* repo.diff(id, { _tag: "Untracked" }, ["new.txt" as RepoPath], false, true)
      expect(full._tag).toBe("Patch")
      if (full._tag === "Patch") expect(full.patch).toContain("+last line\n")
    }),
  )

  it.effect("does not hide a patch below 4 MB", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.write("small.txt", `${"x\n".repeat(1_000_000)}last line\n`)
      const diff = yield* (yield* Repo).diff(fixture.root as RepoId, { _tag: "Untracked" }, ["small.txt" as RepoPath])
      expect(diff._tag).toBe("Patch")
      if (diff._tag === "Patch") expect(diff.patch).toContain("+last line\n")
    }),
  )

  it.effect("allows a large worktree preview without changing later requests or the index", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.write("tracked.txt", "base\n")
      fixture.git("add", ".")
      fixture.commit("base")
      fixture.write("tracked.txt", `${"tracked change\n".repeat(160_000)}tracked end\n`)
      fixture.write("new.txt", `${"untracked change\n".repeat(160_000)}untracked end\n`)
      const worktrees = yield* Worktrees
      const id = fixture.root as RepoId
      const before = fixture.git("status", "--porcelain=v2")
      const limited = yield* worktrees.diff(id)
      expect(limited._tag).toBe("TooLarge")
      const full = yield* worktrees.diff(id, true)
      expect(full._tag).toBe("Patch")
      if (limited._tag === "TooLarge" && full._tag === "Patch") {
        expect(Buffer.byteLength(full.patch)).toBe(limited.bytes)
        expect(full.patch).toContain("+tracked end\n")
        expect(full.patch).toContain("+untracked end\n")
      }
      expect(yield* worktrees.diff(id)).toEqual(limited)
      expect(fixture.git("status", "--porcelain=v2")).toBe(before)
    }),
  )
})
