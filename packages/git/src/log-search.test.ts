import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const search = (root: string, query: string) =>
  Effect.gen(function* () {
    const r = yield* Repo
    const handle = Option.getOrThrow(yield* Stream.runLast(r.openLog(root as RepoId, query)))
    const rows = yield* r.logPage(root as RepoId, handle.logId, 0, 100)
    return { total: handle.loaded, rows }
  })

const subjects = (result: { rows: ReadonlyArray<{ subject: string }> }) => result.rows.map((row) => row.subject)

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Repo log search", (it) => {
  it.effect("matches every word of the message in any case, and narrows by author", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("Fix parser bug")
      repo.git("commit", "-q", "--allow-empty", "--author=Bob <bob@example.com>", "-m", "fix render")
      repo.commit("add feature")

      const fix = yield* search(repo.root, "fix")
      expect(subjects(fix)).toEqual(["fix render", "Fix parser bug"])
      expect(fix.total).toBe(2)
      expect(subjects(yield* search(repo.root, "FIX parser"))).toEqual(["Fix parser bug"])
      expect(subjects(yield* search(repo.root, "fix author:bob"))).toEqual(["fix render"])
      expect(subjects(yield* search(repo.root, '"parser bug"'))).toEqual(["Fix parser bug"])
    }),
  )

  it.effect("follows one file's history with parents rewritten to the commits that touched it", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("my file.txt", "one\n")
      repo.git("add", ".")
      repo.commit("create")
      repo.write("other.txt", "x\n")
      repo.git("add", ".")
      repo.commit("unrelated")
      repo.write("my file.txt", "two\n")
      repo.git("add", ".")
      repo.commit("edit")

      const history = yield* search(repo.root, 'path:"my file.txt"')
      expect(subjects(history)).toEqual(["edit", "create"])
      expect(history.rows[0]!.parents).toEqual([history.rows[1]!.oid])
      expect(history.rows[1]!.parents).toEqual([])
    }),
  )

  it.effect("jumps to a commit by its abbreviated sha", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const first = repo.commit("first")
      repo.commit("second")

      const found = yield* search(repo.root, first.slice(0, 8))
      expect(found.total).toBe(1)
      expect(found.rows.map((row) => row.oid)).toEqual([first])
    }),
  )

  it.effect("keeps several searches pageable at once", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("alpha")
      repo.commit("beta")
      const r = yield* Repo
      const all = Option.getOrThrow(yield* Stream.runHead(r.openLog(repo.root as RepoId, "")))
      const beta = Option.getOrThrow(yield* Stream.runHead(r.openLog(repo.root as RepoId, "beta")))

      const allRows = yield* r.logPage(repo.root as RepoId, all.logId, 0, 10)
      const betaRows = yield* r.logPage(repo.root as RepoId, beta.logId, 0, 10)
      expect(allRows.map((row) => row.subject)).toEqual(["beta", "alpha"])
      expect(betaRows.map((row) => row.subject)).toEqual(["beta"])
    }),
  )
})
