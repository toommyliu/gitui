import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import type { Oid, RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { describe, expect, it } from "vitest"
import { Repo } from "../src/repo.ts"
import { makeRepo } from "./fixture.ts"

const run = <A, E>(f: (repo: Repo["Service"]) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* f(yield* Repo)
    }).pipe(Effect.provide(Repo.layer.pipe(Layer.provide(NodeServices.layer)))),
  )

const id = (root: string) => root as RepoId
const p = (path: string) => path as RepoPath

describe("Repo", () => {
  it("pages the log in order across many commits", async () => {
    const repo = makeRepo()
    for (let i = 0; i < 300; i++) repo.commit(`commit ${i}`)
    const expected = repo.git("log", "--format=%H").split("\n")

    const pages = await run((r) =>
      Effect.gen(function* () {
        const handle = yield* r.openLog(id(repo.root))
        const first = yield* r.logPage(id(repo.root), handle.logId, 0, 100)
        const last = yield* r.logPage(id(repo.root), handle.logId, 250, 100)
        return { total: handle.total, first, last }
      }),
    )
    expect(pages.total).toBe(300)
    expect(pages.first.map((row) => row.oid)).toEqual(expected.slice(0, 100))
    expect(pages.last.map((row) => row.oid)).toEqual(expected.slice(250))
  })

  it("commits exactly the index, leaving later working-tree edits uncommitted", async () => {
    const repo = makeRepo()
    repo.write("a.txt", "base\n")
    repo.git("add", ".")
    repo.commit("base")
    repo.write("a.txt", "staged\n")
    repo.git("add", "a.txt")
    repo.write("a.txt", "working\n")

    await run((r) => r.commitIndex(id(repo.root), "save staged", false))
    expect(repo.git("show", "HEAD:a.txt")).toBe("staged")
    expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("working\n")
  })

  it("stages a file named like a glob without staging its matches", async () => {
    const repo = makeRepo()
    repo.commit("base")
    for (const name of ["*.ts", "a.ts", "b.ts"]) repo.write(name, "x\n")
    await run((r) => r.stage(id(repo.root), [p("*.ts")]))
    expect(repo.git("diff", "--cached", "--name-only")).toBe("*.ts")
  })

  it("discards tracked edits and deletes untracked files", async () => {
    const repo = makeRepo()
    repo.write("a.txt", "base\n")
    repo.git("add", ".")
    repo.commit("base")
    repo.write("a.txt", "edited\n")
    repo.write("new.txt", "new\n")
    await run((r) => r.discard(id(repo.root), [p("a.txt"), p("new.txt")]))
    expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("base\n")
    expect(existsSync(join(repo.root, "new.txt"))).toBe(false)
  })

  it("deletes a branch together with its dirty, locked worktree", async () => {
    const repo = makeRepo()
    repo.commit("base")
    const linked = `${repo.root}-agent`
    repo.git("worktree", "add", "-q", "-b", "agent", linked)
    repo.git("worktree", "lock", linked)
    repo.write("../" + linked.split("/").pop() + "/dirty.txt", "uncommitted\n")

    await run((r) => r.deleteBranch(id(repo.root), "agent", true, true))
    expect(existsSync(linked)).toBe(false)
    expect(repo.git("branch", "--list", "agent")).toBe("")
  })

  it("returns a commit's files with rename and line stats", async () => {
    const repo = makeRepo()
    repo.write("old.txt", "one\ntwo\nthree\nfour\n")
    repo.git("add", ".")
    repo.commit("base")
    repo.git("mv", "old.txt", "new.txt")
    repo.write("new.txt", "one\ntwo\nthree\nfour\nfive\n")
    repo.write("img.bin", "\0\x01\x02")
    repo.git("add", ".")
    const oid = repo.commit("rename") as Oid

    const detail = await run((r) => r.commit(id(repo.root), oid))
    expect(detail.message).toBe("rename")
    expect(detail.files).toEqual([
      { path: "img.bin", from: null, change: "added", additions: null, deletions: null },
      { path: "new.txt", from: "old.txt", change: "renamed", additions: 1, deletions: 0 },
    ])
    const diff = await run((r) => r.diff(id(repo.root), { _tag: "Commit", oid }, p("new.txt"), p("old.txt")))
    expect(diff._tag === "Patch" && diff.patch.includes("+five")).toBe(true)
  })
})
