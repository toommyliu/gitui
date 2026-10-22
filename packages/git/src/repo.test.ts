import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { allRefsVisible, type Oid, type RefVisibility, type RepoId, type RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { fixtureEnv, makeRepo } from "./testRepo.ts"

const id = (root: string) => root as RepoId
const p = (path: string) => path as RepoPath
const listedWorktree = (porcelain: string, suffix: string) =>
  porcelain
    .split("\n")
    .find((line) => line.startsWith("worktree ") && line.endsWith(suffix))!
    .slice("worktree ".length)

layer(Repo.layer.pipe(Layer.provideMerge(CommandLog.layer), Layer.provide(NodeServices.layer)))("Repo", (it) => {
  it.effect("pages the log in order on demand and reports the full count once loaded", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.emptyCommits(300)
      const expected = repo.git("log", "--format=%H").split("\n")
      const r = yield* Repo

      const opened = r.openLog(id(repo.root), "")
      const { logId } = Option.getOrThrow(yield* Stream.runHead(opened))
      const first = yield* r.logPage(id(repo.root), logId, 0, 100)
      const last = yield* r.logPage(id(repo.root), logId, 250, 100)
      expect(first.map((row) => row.oid)).toEqual(expected.slice(0, 100))
      expect(last.map((row) => row.oid)).toEqual(expected.slice(250))
      expect(Option.getOrThrow(yield* Stream.runLast(opened))).toEqual({ logId, loaded: 300, done: true })
    }),
  )

  it.effect("stops reading a log once nothing is waiting on it, and reads on when a page is asked for", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.emptyCommits(20_000)
      const r = yield* Repo

      const opened = r.openLog(id(repo.root), "")
      const { logId } = Option.getOrThrow(yield* Stream.runHead(opened))
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 500)))
      const idle = Option.getOrThrow(yield* Stream.runHead(opened))
      expect(idle.done).toBe(false)
      expect(idle.loaded).toBeLessThan(20_000)

      const last = yield* r.logPage(id(repo.root), logId, 19_900, 100)
      expect(last.map((row) => row.subject)).toEqual(Array.from({ length: 100 }, (_, i) => `commit ${99 - i}`))
    }),
  )

  it.effect("finds a commit's row in a log that has not been read that far", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.emptyCommits(20_000)
      const oldest = repo.git("rev-list", "--max-parents=0", "HEAD") as Oid
      const r = yield* Repo

      const { logId } = Option.getOrThrow(yield* Stream.runHead(r.openLog(id(repo.root), "")))
      expect(yield* r.logIndex(id(repo.root), logId, oldest)).toBe(19_999)
      expect(yield* r.logIndex(id(repo.root), logId, "0".repeat(40) as Oid)).toBe(null)
    }),
  )

  it.effect("fails a log whose git command fails, and runs git again when it is reopened", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      const r = yield* Repo

      const opened = r.openLog(id(repo.root), "path:../outside")
      const first = yield* Effect.flip(Stream.runCollect(opened))
      const second = yield* Effect.flip(Stream.runCollect(opened))
      const [entries = []] = yield* (yield* CommandLog).entries(repo.root).pipe(Stream.take(1), Stream.runCollect)

      expect(first._tag === "GitError" && first.summary.split(" at ")[0]).toBe(
        "../outside: '../outside' is outside repository",
      )
      expect(second._tag).toBe("GitError")
      expect(entries.filter((entry) => entry.args[entry.prefixLength] === "log").map((entry) => entry.outcome)).toEqual(
        [
          { _tag: "Exited", code: 128, accepted: false },
          { _tag: "Exited", code: 128, accepted: false },
        ],
      )
    }),
  )

  it.effect("keeps a commit message draft per worktree until the next commit clears it", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "base\n")
      repo.git("add", ".")
      repo.commit("base")
      const other = `${repo.root}-other`
      repo.git("worktree", "add", "-q", "-b", "other", other)
      const r = yield* Repo

      yield* r.writeDraft(id(repo.root), "fix: half-written message\n\nwith a body")
      expect(yield* r.readDraft(id(repo.root))).toBe("fix: half-written message\n\nwith a body")
      expect(yield* r.readDraft(id(other))).toBe("")
      expect((yield* r.status(id(repo.root))).entries).toEqual([])

      repo.write("a.txt", "changed\n")
      repo.git("add", "a.txt")
      yield* r.commitIndex(id(repo.root), "fix: done", false)
      expect(yield* r.readDraft(id(repo.root))).toBe("")

      yield* r.writeDraft(id(other), "draft")
      yield* r.writeDraft(id(other), "")
      expect(existsSync(join(repo.git("rev-parse", "--absolute-git-dir"), "worktrees", "other", "GITUI_MSG"))).toBe(
        false,
      )
    }),
  )

  it.effect("keeps the draft for the next commit when amending", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "base\n")
      repo.git("add", ".")
      repo.commit("feat: add a")
      const r = yield* Repo

      yield* r.writeDraft(id(repo.root), "wip: next thing")
      repo.write("a.txt", "fixed\n")
      repo.git("add", "a.txt")
      yield* r.commitIndex(id(repo.root), "feat: add a\n\nwith a body", true)

      expect(repo.git("log", "--format=%B")).toBe("feat: add a\n\nwith a body")
      expect(repo.git("show", "HEAD:a.txt")).toBe("fixed")
      expect(yield* r.readDraft(id(repo.root))).toBe("wip: next thing")
    }),
  )

  it.effect("finds the shared git dir when a repo is opened from a subdirectory", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("deep/er/file.txt", "x\n")
      const info = yield* (yield* Repo).open(join(repo.root, "deep", "er"))
      expect(info.commonDir).toBe(join(info.id, ".git"))
      expect(info.gitDir).toBe(info.commonDir)
    }),
  )

  it.effect("commits exactly the index, leaving later working-tree edits uncommitted", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "base\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.write("a.txt", "staged\n")
      repo.git("add", "a.txt")
      repo.write("a.txt", "working\n")

      yield* (yield* Repo).commitIndex(id(repo.root), "save staged", false)
      expect(repo.git("show", "HEAD:a.txt")).toBe("staged")
      expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("working\n")
    }),
  )

  it.effect("stages a file named like a glob without staging its matches", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      for (const name of ["*.ts", "a.ts", "b.ts"]) repo.write(name, "x\n")
      yield* (yield* Repo).stage(id(repo.root), [p("*.ts")])
      expect(repo.git("diff", "--cached", "--name-only")).toBe("*.ts")
    }),
  )

  it.effect("discards tracked edits and deletes untracked files", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "base\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.write("a.txt", "edited\n")
      repo.write("new.txt", "new\n")
      yield* (yield* Repo).discard(id(repo.root), [p("a.txt"), p("new.txt")])
      expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("base\n")
      expect(existsSync(join(repo.root, "new.txt"))).toBe(false)
    }),
  )

  it.effect("combines diffs for several untracked files", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      repo.write("one.txt", "first\n")
      repo.write("dir/two.txt", "second\n")
      const diff = yield* (yield* Repo).diff(id(repo.root), { _tag: "Untracked" }, [p("one.txt"), p("dir/two.txt")])
      expect(diff._tag === "Patch" && diff.patch.match(/^\+\w+$/gm)).toEqual(["+first", "+second"])
    }),
  )

  it.effect("deletes a branch together with its dirty, locked worktree", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      const linked = `${repo.root}-agent`
      repo.git("worktree", "add", "-q", "-b", "agent", linked)
      repo.git("worktree", "lock", linked)
      repo.write(`../${linked.split("/").pop()}/dirty.txt`, "uncommitted\n")

      yield* (yield* Repo).deleteBranch(id(repo.root), "agent", false, true)
      expect(existsSync(linked)).toBe(false)
      expect(repo.git("branch", "--list", "agent")).toBe("")
    }),
  )

  it.effect("refuses to delete an unmerged branch without touching its worktree", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      const linked = `${repo.root}-wip`
      repo.git("worktree", "add", "-q", "-b", "wip", linked)
      execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "unmerged"], { cwd: linked, env: fixtureEnv() })
      repo.write(`../${linked.split("/").pop()}/dirty.txt`, "keep me\n")

      const result = yield* Effect.flip((yield* Repo).deleteBranch(id(repo.root), "wip", false, true))
      expect(result.stderr).toBe("wip has 1 commit that HEAD doesn't contain. Nothing was deleted.")
      expect(readFileSync(join(linked, "dirty.txt"), "utf8")).toBe("keep me\n")
      expect(repo.git("branch", "--list", "wip")).toBe("+ wip")
    }),
  )

  it.effect("removes a clean worktree with ignored files and leaves nothing behind", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write(".gitignore", "node_modules/\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.git("worktree", "add", "-q", "-b", "clean", `${repo.root}-clean`)
      const path = listedWorktree(repo.git("worktree", "list", "--porcelain"), "-clean")
      mkdirSync(join(path, "node_modules", "pkg"), { recursive: true })
      writeFileSync(join(path, "node_modules", "pkg", "index.js"), "module.exports = 1\n")

      yield* (yield* Repo).removeWorktree(id(repo.root), path, false)
      expect(existsSync(path)).toBe(false)
      expect(repo.git("worktree", "list", "--porcelain")).not.toContain(path)
      const leftovers = () => readdirSync(dirname(path)).filter((name) => name.startsWith(`.${basename(path)}.`))
      for (let i = 0; i < 100 && leftovers().length > 0; i++) {
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)))
      }
      expect(leftovers()).toEqual([])
    }),
  )

  it.effect("keeps a worktree with untracked files unless the removal is forced", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      repo.git("worktree", "add", "-q", "-b", "notes", `${repo.root}-notes`)
      const path = listedWorktree(repo.git("worktree", "list", "--porcelain"), "-notes")
      writeFileSync(join(path, "notes.txt"), "keep me\n")
      const r = yield* Repo

      const error = yield* Effect.flip(r.removeWorktree(id(repo.root), path, false))
      expect(error.summary).toBe(`'${path}' contains modified or untracked files, use --force to delete it`)
      expect(readFileSync(join(path, "notes.txt"), "utf8")).toBe("keep me\n")
      yield* r.removeWorktree(id(repo.root), path, true)
      expect(existsSync(path)).toBe(false)
    }),
  )

  it.effect("keeps a locked worktree unless the removal is forced", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      repo.git("worktree", "add", "-q", "-b", "agent", `${repo.root}-locked`)
      const path = listedWorktree(repo.git("worktree", "list", "--porcelain"), "-locked")
      repo.git("worktree", "lock", "--reason", "agent running", path)
      const r = yield* Repo

      const error = yield* Effect.flip(r.removeWorktree(id(repo.root), path, false))
      expect(error.summary).toBe("Cannot remove a locked working tree, lock reason: agent running")
      expect(existsSync(join(path, ".git"))).toBe(true)
      yield* r.removeWorktree(id(repo.root), path, true)
      expect(existsSync(path)).toBe(false)
    }),
  )

  it.effect("keeps a worktree with a checked-out submodule unless the removal is forced", () =>
    Effect.gen(function* () {
      const library = makeRepo()
      library.commit("library")
      const repo = makeRepo()
      repo.commit("base")
      repo.git("-c", "protocol.file.allow=always", "submodule", "add", "-q", library.root, "lib")
      repo.git("commit", "-q", "-m", "add lib")
      repo.git("worktree", "add", "-q", "-b", "sub", `${repo.root}-sub`)
      const path = listedWorktree(repo.git("worktree", "list", "--porcelain"), "-sub")
      execFileSync("git", ["-c", "protocol.file.allow=always", "submodule", "update", "-q", "--init"], {
        cwd: path,
        env: fixtureEnv(),
      })
      const r = yield* Repo

      const error = yield* Effect.flip(r.removeWorktree(id(repo.root), path, false))
      expect(error.summary).toBe("Working trees containing submodules cannot be moved or removed")
      expect(existsSync(join(path, "lib", ".git"))).toBe(true)
      yield* r.removeWorktree(id(repo.root), path, true)
      expect(existsSync(path)).toBe(false)
    }),
  )

  it.effect("reads branches with upstream state, remote branches and peeled tags", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const base = repo.commit("base")
      repo.git("remote", "add", "origin", "git@example.com:a/b.git")
      repo.git("update-ref", "refs/remotes/origin/main", base)
      repo.git("update-ref", "refs/remotes/origin/feature/x", base)
      repo.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
      repo.git("branch", "--set-upstream-to=origin/main")
      const tip = repo.commit("ahead")
      repo.git("tag", "-a", "v1", "-m", "release", base)
      repo.git("branch", "stale", base)
      repo.git("update-ref", "refs/remotes/origin/stale", base)
      repo.git("branch", "--set-upstream-to=origin/stale", "stale")
      repo.git("update-ref", "-d", "refs/remotes/origin/stale")

      const { branches, remoteBranches, tags, remotes } = yield* (yield* Repo).refs(id(repo.root))
      expect({ branches, remoteBranches, tags, remotes }).toEqual({
        branches: [
          { name: "main", oid: tip, upstream: { _tag: "Tracking", name: "origin/main", ahead: 1, behind: 0 } },
          { name: "stale", oid: base, upstream: { _tag: "Gone", name: "origin/stale" } },
        ],
        remoteBranches: [
          { remote: "origin", name: "origin/feature/x", oid: base },
          { remote: "origin", name: "origin/main", oid: base },
        ],
        tags: [{ name: "v1", oid: base }],
        remotes: [{ name: "origin", url: "git@example.com:a/b.git" }],
      })
    }),
  )

  it.effect("recounts ahead and behind whenever a branch or its upstream moves", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const base = repo.commit("base")
      repo.git("remote", "add", "origin", "git@example.com:a/b.git")
      repo.git("update-ref", "refs/remotes/origin/main", base)
      repo.git("branch", "--set-upstream-to=origin/main")
      const r = yield* Repo
      const counts = Effect.map(r.refs(id(repo.root)), ({ branches }) => {
        const upstream = branches.find((branch) => branch.name === "main")?.upstream
        return upstream?._tag === "Tracking" ? [upstream.ahead, upstream.behind] : upstream
      })

      expect(yield* counts).toEqual([0, 0])
      repo.commit("local")
      expect(yield* counts).toEqual([1, 0])
      repo.git(
        "update-ref",
        "refs/remotes/origin/main",
        repo.git("commit-tree", "HEAD^{tree}", "-p", base, "-m", "theirs"),
      )
      expect(yield* counts).toEqual([1, 1])
      repo.git("reset", "-q", "--hard", base)
      expect(yield* counts).toEqual([0, 1])
      repo.git("update-ref", "refs/remotes/origin/main", base)
      expect(yield* counts).toEqual([0, 0])
    }),
  )

  it.effect("logs each command with its kind, outcome and stderr", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      repo.write("a.txt", "a\n")
      const other = makeRepo()
      other.commit("base")
      const r = yield* Repo
      yield* r.stage(id(repo.root), [p("a.txt")])
      yield* r.checkout(id(other.root), "main")
      yield* Effect.flip(r.checkout(id(repo.root), "missing"))

      const [entries = []] = yield* (yield* CommandLog).entries(repo.root).pipe(Stream.take(1), Stream.runCollect)
      const mine = entries.map((entry) => ({
        command: entry.args.slice(entry.prefixLength).join(" "),
        kind: entry.kind,
        outcome: entry.outcome,
        failed: entry.stderr.includes("invalid reference: missing"),
      }))
      expect(mine).toEqual([
        {
          command: "add -A --pathspec-from-file=- --pathspec-file-nul",
          kind: "write",
          outcome: { _tag: "Exited", code: 0, accepted: true },
          failed: false,
        },
        {
          command: "switch missing",
          kind: "write",
          outcome: { _tag: "Exited", code: 128, accepted: false },
          failed: true,
        },
      ])
    }),
  )

  it.effect("returns a commit's files with rename and line stats", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("old.txt", "one\ntwo\nthree\nfour\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.git("mv", "old.txt", "new.txt")
      repo.write("new.txt", "one\ntwo\nthree\nfour\nfive\n")
      repo.write("img.bin", "\0\x01\x02")
      repo.git("add", ".")
      const oid = repo.commit("rename") as Oid
      const r = yield* Repo

      const detail = yield* r.commit(id(repo.root), oid)
      expect(detail.message).toBe("rename")
      expect(detail.files).toEqual([
        { path: "img.bin", from: null, change: "added", additions: null, deletions: null },
        { path: "new.txt", from: "old.txt", change: "renamed", additions: 1, deletions: 0 },
      ])
      const diff = yield* r.diff(id(repo.root), { _tag: "Commit", oid }, [p("old.txt"), p("new.txt")])
      expect(diff._tag === "Patch" && diff.patch.includes("rename from old.txt") && diff.patch.includes("+five")).toBe(
        true,
      )
      const whole = yield* r.diff(id(repo.root), { _tag: "Commit", oid }, [])
      expect(whole._tag === "Patch" && whole.patch.match(/^diff --git/gm)?.length).toBe(2)
    }),
  )

  it.effect("walks only the refs left visible", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.commit("base")
      for (const branch of ["feature/a", "feature/b", "solo"]) {
        repo.git("checkout", "-q", "-b", branch, "main")
        repo.commit(branch)
      }
      repo.git("checkout", "-q", "-b", "remote", "main")
      repo.git("update-ref", "refs/remotes/origin/team/x", repo.commit("origin/team/x"))
      repo.git("checkout", "-q", "-b", "tagged", "main")
      repo.git("tag", "v1", repo.commit("v1"))
      repo.git("checkout", "-q", "main")
      repo.git("branch", "-q", "-D", "remote", "tagged")
      const r = yield* Repo

      const subjects = (refs: Partial<RefVisibility>) =>
        Effect.gen(function* () {
          const handle = Option.getOrThrow(
            yield* Stream.runLast(r.openLog(id(repo.root), "", { ...allRefsVisible, ...refs })),
          )
          const rows = yield* r.logPage(id(repo.root), handle.logId, 0, 20)
          return rows.map((row) => row.subject).sort()
        })
      expect(yield* subjects({})).toEqual(["base", "feature/a", "feature/b", "origin/team/x", "solo", "v1"])
      expect(yield* subjects({ hiddenBranches: ["feature", "solo"] })).toEqual(["base", "origin/team/x", "v1"])
      expect(yield* subjects({ hiddenBranches: ["feature/a"] })).toEqual([
        "base",
        "feature/b",
        "origin/team/x",
        "solo",
        "v1",
      ])
      expect(yield* subjects({ branches: false, hiddenRemotes: ["origin/team"] })).toEqual(["base", "v1"])
      expect(yield* subjects({ remotes: false, tags: false })).toEqual(["base", "feature/a", "feature/b", "solo"])
    }),
  )

  it.effect("shows each stash as one commit on its base, without its index and untracked commits", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      const base = repo.commit("base")
      repo.write("tracked.txt", "change\n")
      repo.git("add", ".")
      repo.write("untracked.txt", "new\n")
      repo.git("stash", "push", "-q", "--include-untracked", "-m", "work")
      const stash = repo.git("rev-parse", "stash@{0}")
      const r = yield* Repo

      const rows = (stashes: boolean) =>
        Effect.gen(function* () {
          const handle = Option.getOrThrow(
            yield* Stream.runLast(r.openLog(id(repo.root), "", { ...allRefsVisible, stashes })),
          )
          const page = yield* r.logPage(id(repo.root), handle.logId, 0, 10)
          return page.map((row) => [row.oid, row.parents])
        })
      expect(yield* rows(true)).toEqual([
        [stash, [base]],
        [base, []],
      ])
      expect(yield* rows(false)).toEqual([[base, []]])
    }),
  )

  it.effect("drops whitespace-only lines from a commit diff when whitespace is ignored", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "one\ntwo\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.write("a.txt", "  one\nthree\n")
      repo.git("add", ".")
      const oid = repo.commit("reindent and change") as Oid
      const r = yield* Repo

      const patch = (ignoreWhitespace: boolean) =>
        Effect.gen(function* () {
          const diff = yield* r.diff(id(repo.root), { _tag: "Commit", oid }, [], ignoreWhitespace)
          return diff._tag === "Patch" ? diff.patch.split("\n").filter((line) => /^[-+][^-+]/.test(line)) : []
        })
      expect(yield* patch(false)).toEqual(["-one", "-two", "+  one", "+three"])
      expect(yield* patch(true)).toEqual(["-two", "+three"])
    }),
  )

  it.effect("diffs a stash with untracked files against its first parent only", () =>
    Effect.gen(function* () {
      const repo = makeRepo()
      repo.write("a.txt", "one\n")
      repo.git("add", ".")
      repo.commit("base")
      repo.write("a.txt", "two\n")
      repo.write("new.txt", "new\n")
      repo.git("stash", "push", "-q", "--include-untracked")
      const oid = repo.git("rev-parse", "stash@{0}") as Oid

      const diff = yield* (yield* Repo).diff(id(repo.root), { _tag: "Commit", oid }, [p("a.txt")])
      expect(diff._tag === "Patch" && diff.patch.match(/^diff --git/gm)?.length).toBe(1)
    }),
  )
})
