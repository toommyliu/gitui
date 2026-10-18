import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { Oid, RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { fixtureEnv, makeRepo } from "./testRepo.ts"

const id = (root: string) => root as RepoId

const withRemote = () => {
  const repo = makeRepo()
  repo.write("a.txt", "a\n")
  repo.git("add", ".")
  repo.commit("base")
  const remote = mkdtempSync(join(tmpdir(), "gitui-remote-"))
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote])
  repo.git("remote", "add", "origin", remote)
  repo.git("push", "-q", "-u", "origin", "main")
  return { repo, remote }
}

const other = (remote: string) => {
  const dir = mkdtempSync(join(tmpdir(), "gitui-other-"))
  execFileSync("git", ["clone", "-q", remote, dir], { env: fixtureEnv() })
  return (...args: Array<string>) =>
    execFileSync("git", args, { cwd: dir, env: fixtureEnv(), encoding: "utf8" }).trimEnd()
}

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))(
  "Repo branch operations",
  (it) => {
    it.effect("pushes a new branch and sets its upstream", () =>
      Effect.gen(function* () {
        const { repo, remote } = withRemote()
        repo.git("switch", "-q", "-c", "feature")
        const tip = repo.commit("feature work")
        yield* (yield* Repo).push(id(repo.root))
        expect(repo.git("rev-parse", "--abbrev-ref", "feature@{upstream}")).toBe("origin/feature")
        expect(execFileSync("git", ["--git-dir", remote, "rev-parse", "feature"], { encoding: "utf8" }).trim()).toBe(
          tip,
        )
      }),
    )

    it.effect("refuses a force push when the remote moved past the commit you saw, even after fetching", () =>
      Effect.gen(function* () {
        const { repo, remote } = withRemote()
        const seen = repo.git("rev-parse", "origin/main") as Oid
        const theirs = other(remote)
        theirs("commit", "-q", "--allow-empty", "-m", "someone else")
        theirs("push", "-q", "origin", "main")
        repo.git("commit", "-q", "--amend", "--allow-empty", "-m", "rewritten")
        repo.git("fetch", "-q", "origin")

        const r = yield* Repo
        const error = yield* Effect.flip(r.forcePush(id(repo.root), seen))
        expect(error.stderr).toContain("stale info")
        const current = repo.git("rev-parse", "origin/main") as Oid
        yield* r.forcePush(id(repo.root), current)
        expect(
          execFileSync("git", ["--git-dir", remote, "log", "-1", "--format=%s", "main"], { encoding: "utf8" }).trim(),
        ).toBe("rewritten")
      }),
    )

    it.effect("adds a worktree on a new branch", () =>
      Effect.gen(function* () {
        const repo = makeRepo()
        const base = repo.commit("base") as Oid
        const path = `${repo.root}-wt`
        yield* (yield* Repo).addWorktree(id(repo.root), path, "wt-branch", base)
        expect(existsSync(join(path, ".git"))).toBe(true)
        expect(execFileSync("git", ["-C", path, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe(
          "wt-branch",
        )
      }),
    )

    it.effect("resets hard, cherry-picks and tags", () =>
      Effect.gen(function* () {
        const repo = makeRepo()
        repo.write("a.txt", "one\n")
        repo.git("add", ".")
        const base = repo.commit("base") as Oid
        repo.git("switch", "-q", "-c", "side")
        repo.write("b.txt", "picked\n")
        repo.git("add", ".")
        const side = repo.commit("add b") as Oid
        repo.git("switch", "-q", "main")
        repo.write("a.txt", "two\n")
        repo.git("commit", "-q", "-am", "edit a")
        const r = yield* Repo

        yield* r.reset(id(repo.root), base, "hard")
        expect(repo.git("rev-parse", "HEAD")).toBe(base)
        expect(repo.git("status", "--porcelain")).toBe("")

        yield* r.cherryPick(id(repo.root), side)
        expect(repo.git("log", "-1", "--format=%s")).toBe("add b")
        expect(repo.git("show", "HEAD:b.txt")).toBe("picked")

        yield* r.createTag(id(repo.root), "v1", base, "first release")
        expect(repo.git("cat-file", "-t", "v1")).toBe("tag")
        expect(repo.git("tag", "-l", "--format=%(contents:subject)", "v1")).toBe("first release")
        yield* r.deleteTag(id(repo.root), "v1")
        expect(repo.git("tag", "-l")).toBe("")
      }),
    )

    it.effect("summarizes a failure with git's own message and no hints", () =>
      Effect.gen(function* () {
        const repo = makeRepo()
        repo.commit("base")
        repo.git("branch", "topic")
        const r = yield* Repo

        const rename = yield* Effect.flip(r.renameBranch(id(repo.root), "topic", "main"))
        expect(rename.summary).toBe("A branch named 'main' already exists")

        const worktree = yield* Effect.flip(
          r.addWorktree(id(repo.root), join(repo.root, "..", "bad"), "topic/has space", null),
        )
        expect(worktree.stderr).toContain("hint:")
        expect(worktree.summary).toBe("'topic/has space' is not a valid branch name")
      }),
    )

    it.effect("stashes untracked files when asked", () =>
      Effect.gen(function* () {
        const repo = makeRepo()
        repo.commit("base")
        repo.write("new.txt", "new\n")
        yield* (yield* Repo).stashPush(id(repo.root), "wip", true)
        expect(existsSync(join(repo.root, "new.txt"))).toBe(false)
        expect(repo.git("stash", "list", "--format=%gs")).toBe("On main: wip")
      }),
    )
  },
)
