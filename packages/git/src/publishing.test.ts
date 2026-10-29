import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { Oid, RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { fixtureEnv, makeRepo } from "./testRepo.ts"

const bare = () => {
  const path = mkdtempSync(join(tmpdir(), "gitui-publish-"))
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", path])
  const git = (...args: string[]) =>
    execFileSync("git", ["--git-dir", path, ...args], { encoding: "utf8", env: fixtureEnv() }).trimEnd()
  return { path, git }
}

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Publishing", (it) => {
  it.effect("checks the confirmed push context before publishing and exposes rewritten push URLs", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      const tip = fixture.commit("base")
      const origin = bare()
      const fork = bare()
      fixture.git("remote", "add", "origin", origin.path)
      fixture.git("remote", "add", "fork", fork.path)
      fixture.git("config", "remote.fork.pushurl", "publish:fork")
      fixture.git("config", `url.${fork.path}.insteadOf`, "publish:fork")
      fixture.git("config", "branch.main.pushRemote", "fork")
      fixture.git("config", "remote.pushDefault", "origin")
      fixture.git("config", "push.default", "nothing")
      const r = yield* Repo
      const id = fixture.root as RepoId
      const context = yield* r.pushContext(id, "main")
      expect(context.remotes.find((remote) => remote.name === "fork")?.pushUrls).toEqual([fork.path])
      const destination = { branch: "main", remote: "fork", remoteBranch: "review" }
      yield* Stream.runDrain(r.push(id, destination, false, context.fingerprint))
      expect(fork.git("rev-parse", "review")).toBe(tip)
      expect(origin.git("for-each-ref")).toBe("")
      yield* Stream.runDrain(r.push(id, destination, true, context.fingerprint))
      const established = yield* r.pushContext(id, "main")
      expect(established.fingerprint).not.toBe(context.fingerprint)
      expect(established.configuration).toBe(context.configuration)
      expect(established.upstream).toEqual({ remote: "fork", merge: ["refs/heads/review"] })
      fixture.commit("next")
      fixture.git("config", "remote.fork.pushurl", origin.path)
      const error = yield* Stream.runDrain(r.push(id, destination, false, established.fingerprint)).pipe(Effect.flip)
      expect(error.stderr).toContain("configuration changed")
      expect(origin.git("for-each-ref")).toBe("")
      expect(fork.git("rev-parse", "review")).toBe(tip)
    }),
  )

  it.effect("invalidates confirmed context for push settings, upstream, URL rewrites and checkout changes", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.commit("base")
      const origin = bare()
      fixture.git("remote", "add", "origin", origin.path)
      const r = yield* Repo
      const id = fixture.root as RepoId
      const changes = [
        () => fixture.git("config", "branch.main.pushRemote", "origin"),
        () => fixture.git("config", "remote.pushDefault", "origin"),
        () => fixture.git("config", "push.default", "upstream"),
        () => fixture.git("push", "-u", "origin", "main"),
        () => fixture.git("config", "remote.origin.url", bare().path),
        () => fixture.git("config", `url.${bare().path}.pushInsteadOf`, origin.path),
        () => fixture.git("switch", "-c", "other"),
      ]
      for (const change of changes) {
        const before = yield* r.pushContext(id, "main")
        change()
        const error = yield* Stream.runDrain(
          r.push(id, { branch: "main", remote: "origin", remoteBranch: "main" }, false, before.fingerprint),
        ).pipe(Effect.flip)
        expect(error.stderr).toContain("configuration changed")
      }
    }),
  )

  it.effect("rejects edits, renames and removal of inherited remotes before changing local configuration", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      const origin = bare()
      const other = bare()
      repo.git("remote", "add", "origin", origin.path)
      const included = join(repo.root, "remotes.conf")
      repo.write("remotes.conf", `[remote "origin"]\n  pushurl = ${origin.path}\n`)
      repo.git("config", "include.path", included)
      const config = readFileSync(join(repo.root, ".git/config"), "utf8")
      const r = yield* Repo
      const id = repo.root as RepoId
      for (const action of [
        r.editRemote(id, "origin", { name: "origin", urls: [other.path], pushUrls: [] }),
        r.editRemote(id, "origin", { name: "renamed", urls: [other.path], pushUrls: [] }),
        r.removeRemote(id, "origin"),
      ]) {
        const error = yield* action.pipe(Effect.flip)
        expect(error.stderr).toContain(included)
        expect(readFileSync(join(repo.root, ".git/config"), "utf8")).toBe(config)
      }
      expect(repo.git("remote", "get-url", "--push", "--all", "origin")).toBe(origin.path)
      expect(readFileSync(included, "utf8")).toBe(`[remote "origin"]\n  pushurl = ${origin.path}\n`)
    }),
  )

  it.effect("preserves canonical local upstream refs, including names ambiguous with remote branches", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const tip = repo.commit("base")
      repo.git("branch", "origin/main")
      repo.git("remote", "add", "origin", bare().path)
      repo.git("update-ref", "refs/remotes/origin/main", tip)
      const r = yield* Repo
      const id = repo.root as RepoId
      yield* r.setUpstream(id, "main", "refs/heads/origin/main")
      expect((yield* r.refs(id)).branches.find((branch) => branch.name === "main")?.upstream).toMatchObject({
        ref: "refs/heads/origin/main",
      })
      yield* r.setUpstream(id, "main", "refs/remotes/origin/main")
      expect((yield* r.refs(id)).branches.find((branch) => branch.name === "main")?.upstream).toMatchObject({
        ref: "refs/remotes/origin/main",
      })
    }),
  )

  it.effect("refuses a stale pull target after the checked-out branch or its upstream changes", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const base = repo.commit("base")
      repo.git("remote", "add", "origin", bare().path)
      repo.git("push", "-u", "origin", "main")
      repo.git("switch", "-c", "producer")
      repo.commit("remote change")
      repo.git("push", "origin", "producer:main")
      repo.git("switch", "-c", "other", "main")
      repo.git("branch", "--set-upstream-to=origin/main", "other")
      const r = yield* Repo
      const id = repo.root as RepoId
      const target = { branch: "main", upstream: "refs/remotes/origin/main" }
      const switched = yield* Stream.runDrain(r.pull(id, "ff-only", target)).pipe(Effect.flip)
      expect(switched.stderr).toContain("changed")
      expect(repo.git("rev-parse", "main")).toBe(base)
      expect(repo.git("rev-parse", "other")).toBe(base)
      repo.git("switch", "main")
      yield* r.setUpstream(id, "main", "refs/heads/other")
      const upstreamChanged = yield* Stream.runDrain(r.pull(id, "ff-only", target)).pipe(Effect.flip)
      expect(upstreamChanged.stderr).toContain("changed")
      expect(repo.git("rev-parse", "main")).toBe(base)
    }),
  )

  it.effect("adds and edits URLs, renames tracking configuration, and removes a remote", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      const origin = bare()
      const backup = bare()
      const r = yield* Repo
      const id = repo.root as RepoId
      yield* r.addRemote(id, { name: "team/origin", urls: [origin.path], pushUrls: [] })
      yield* Stream.runDrain(r.push(id, { branch: "main", remote: "team/origin", remoteBranch: "trunk" }, true))
      yield* r.editRemote(id, "team/origin", {
        name: "team/upstream",
        urls: [origin.path, backup.path],
        pushUrls: [backup.path],
      })
      expect((yield* r.refs(id)).remotes).toEqual([
        { name: "team/upstream", urls: [origin.path, backup.path], pushUrls: [backup.path] },
      ])
      expect(repo.git("rev-parse", "--abbrev-ref", "main@{upstream}")).toBe("team/upstream/trunk")
      yield* Stream.runDrain(r.push(id, { branch: "main", remote: "team/upstream", remoteBranch: "release" }, false))
      expect(backup.git("rev-parse", "refs/heads/release")).toBe(repo.git("rev-parse", "HEAD"))
      expect(origin.git("for-each-ref", "--format=%(refname)", "refs/heads")).toBe("refs/heads/trunk")
      yield* r.editRemote(id, "team/upstream", { name: "team/upstream", urls: [origin.path], pushUrls: [] })
      expect(repo.git("remote", "get-url", "--push", "team/upstream")).toBe(origin.path)
      yield* r.removeRemote(id, "team/upstream")
      expect(repo.git("remote")).toBe("")
      expect(origin.git("rev-parse", "trunk")).toBe(repo.git("rev-parse", "HEAD"))
    }),
  )

  it.effect("publishes only the selected branch despite push defaults, mirror and follow-tags configuration", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const tip = repo.commit("base")
      const origin = bare()
      const fork = bare()
      repo.git("remote", "add", "origin", origin.path)
      repo.git("remote", "add", "team=fork", fork.path)
      repo.git("config", "remote.team=fork.mirror", "true")
      repo.git("config", "push.followTags", "true")
      repo.git("config", "push.default", "matching")
      repo.git("branch", "extra")
      repo.git("tag", "-a", "v1", "-m", "release")
      const r = yield* Repo
      const id = repo.root as RepoId
      yield* Stream.runDrain(r.push(id, { branch: "main", remote: "team=fork", remoteBranch: "review/main" }, true))
      expect(fork.git("for-each-ref", "--format=%(refname)")).toBe("refs/heads/review/main")
      expect(fork.git("rev-parse", "review/main")).toBe(tip)
      expect(origin.git("for-each-ref")).toBe("")
      expect(repo.git("rev-parse", "--abbrev-ref", "main@{upstream}")).toBe("team=fork/review/main")
      const error = yield* Stream.runDrain(
        r.push(id, { branch: "main", remote: "team=fork", remoteBranch: "bad:refs/heads/main" }, false),
      ).pipe(Effect.flip)
      expect(error.exitCode).not.toBe(0)
      expect(fork.git("for-each-ref", "--format=%(refname)")).toBe("refs/heads/review/main")
    }),
  )

  it.effect("changes and clears upstream without publishing or checking out another branch", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const tip = repo.commit("base")
      const remote = bare()
      repo.git("remote", "add", "origin", remote.path)
      repo.git("update-ref", "refs/remotes/origin/trunk", tip)
      repo.git("branch", "feature")
      const r = yield* Repo
      const id = repo.root as RepoId
      yield* r.setUpstream(id, "feature", "refs/remotes/origin/trunk")
      expect(repo.git("rev-parse", "--abbrev-ref", "feature@{upstream}")).toBe("origin/trunk")
      yield* r.setUpstream(id, "feature", null)
      expect(repo.git("for-each-ref", "--format=%(upstream)", "refs/heads/feature")).toBe("")
      expect(repo.git("branch", "--show-current")).toBe("main")
      expect(remote.git("for-each-ref")).toBe("")
    }),
  )

  it.effect("pushes selected tags without branches or other tags and rejects an empty selection", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      const remote = bare()
      repo.git("remote", "add", "origin", remote.path)
      repo.git("tag", "v1")
      repo.git("tag", "-a", "v2", "-m", "release")
      repo.git("branch", "v1")
      const r = yield* Repo
      const id = repo.root as RepoId
      yield* Stream.runDrain(r.pushTags(id, "origin", ["v1"]))
      expect(remote.git("for-each-ref", "--format=%(refname)")).toBe("refs/tags/v1")
      yield* Stream.runDrain(r.pushTags(id, "origin", ["v1", "v2"]))
      expect(remote.git("rev-parse", "refs/tags/v2")).toBe(repo.git("rev-parse", "refs/tags/v2"))
      const error = yield* Stream.runDrain(r.pushTags(id, "origin", [])).pipe(Effect.flip)
      expect(error.stderr).toBe("Choose at least one tag to push.")
    }),
  )

  it.effect("deletes the actual remote branch with a lease, preserving local branches and same-named tags", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const seen = repo.commit("base") as Oid
      const remote = bare()
      repo.git("remote", "add", "team/origin", remote.path)
      repo.git("push", "team/origin", "main:topic/a")
      repo.git("tag", "topic/a")
      repo.git("push", "team/origin", "refs/tags/topic/a")
      const current = repo.commit("new") as Oid
      repo.git("push", "team/origin", "main:refs/heads/topic/a")
      const r = yield* Repo
      const id = repo.root as RepoId
      const error = yield* Stream.runDrain(r.deleteRemoteBranch(id, "team/origin", "topic/a", seen)).pipe(Effect.flip)
      expect(error.stderr).toContain("stale info")
      expect(remote.git("rev-parse", "refs/heads/topic/a")).toBe(current)
      yield* Stream.runDrain(r.deleteRemoteBranch(id, "team/origin", "topic/a", current))
      expect(remote.git("for-each-ref", "--format=%(refname)")).toBe("refs/tags/topic/a")
      expect(repo.git("rev-parse", "main")).toBe(current)
      expect(repo.git("for-each-ref", "refs/remotes/team/origin/topic/a")).toBe("")
    }),
  )

  for (const strategy of ["ff-only", "merge", "rebase"] as const) {
    it.effect(`pulls divergent history using ${strategy} despite conflicting configuration`, () =>
      Effect.gen(function* () {
        const repo = makeRepo()
        repo.commit("base")
        const remote = bare()
        repo.git("remote", "add", "origin", remote.path)
        repo.git("push", "-u", "origin", "main")
        repo.git("switch", "-c", "theirs")
        repo.write("theirs", "theirs\n")
        repo.git("add", ".")
        const theirs = repo.commit("theirs")
        repo.git("push", "origin", "theirs:main")
        repo.git("switch", "main")
        repo.write("ours", "ours\n")
        repo.git("add", ".")
        const ours = repo.commit("ours")
        repo.git("config", "pull.ff", "only")
        repo.git("config", "pull.rebase", strategy === "rebase" ? "false" : "true")
        const pull = Stream.runDrain(
          (yield* Repo).pull(repo.root as RepoId, strategy, {
            branch: "main",
            upstream: "refs/remotes/origin/main",
          }),
        )
        if (strategy === "ff-only") {
          const error = yield* pull.pipe(Effect.flip)
          expect(error.stderr).toContain("Not possible to fast-forward")
          expect(repo.git("rev-parse", "HEAD")).toBe(ours)
        } else {
          yield* pull
          expect(repo.git("show", "HEAD:theirs")).toBe("theirs")
          expect(repo.git("show", "HEAD:ours")).toBe("ours")
          expect(repo.git("show", "-s", "--format=%P", "HEAD").split(" ")).toEqual(
            strategy === "merge" ? [ours, theirs] : [theirs],
          )
        }
      }),
    )
  }
})
