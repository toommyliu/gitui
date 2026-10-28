import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import {
  Oid,
  RepoId,
  RepoPath,
  type RewriteAction,
  type RewritePlan,
  type RewriteRequest,
  type RewriteStep,
} from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const request = (plan: RewritePlan, actions: ReadonlyArray<RewriteAction>): RewriteRequest => ({
  branch: plan.branch,
  head: plan.head,
  first: plan.commits[0]!.oid,
  steps: plan.commits.map((commit, index) => ({
    oid: commit.oid,
    message: commit.message,
    action: actions[index] ?? "pick",
  })),
  allowPublished: false,
})

const add = (fixture: ReturnType<typeof makeRepo>, path: string, content: string, message: string) => {
  fixture.write(path, content)
  fixture.git("add", "--", path)
  return Oid.make(fixture.commit(message))
}

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Commit editing", (it) => {
  for (const change of ["commit", "branch"] as const) {
    it.effect(`rejects an external ${change} made after the rewrite backup`, () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        fixture.commit("base")
        const first = add(fixture, "a", "a\n", "original")
        const repo = RepoId.make(fixture.root)
        const r = yield* Repo
        const edit = request(yield* r.rewritePlan(repo, first), ["reword"])
        const command =
          change === "commit"
            ? "printf 'external\\n' > late\ngit add late\ngit -c core.hooksPath=/dev/null commit -q -m 'external commit'"
            : "git -c core.hooksPath=/dev/null switch -q -c other"
        fixture.write(
          ".git/hooks/reference-transaction",
          `#!/bin/sh\ntest "$1" = committed || exit 0\nwhile read old new ref; do\ncase "$ref" in refs/gitui/rewrites/*)\n${command}\n;;\nesac\ndone\n`,
        )
        chmodSync(join(fixture.root, ".git/hooks/reference-transaction"), 0o755)
        const result = yield* Effect.result(
          r.startRewrite(repo, {
            ...edit,
            steps: edit.steps.map((step) => ({ ...step, message: "rewritten" })),
          }),
        )
        expect(result._tag).toBe("Failure")
        if (change === "commit") {
          expect(fixture.git("log", "--reverse", "--format=%s")).toBe("base\noriginal\nexternal commit")
          expect(readFileSync(join(fixture.root, "late"), "utf8")).toBe("external\n")
        } else {
          expect(fixture.git("symbolic-ref", "--short", "HEAD")).toBe("other")
          expect(fixture.git("rev-parse", "HEAD")).toBe(first)
          expect(fixture.git("rev-parse", "main")).toBe(first)
        }
        expect((yield* r.status(repo)).operation).toBeNull()
      }),
    )
  }

  it.effect("can retry a split after an index lock prevents the reset", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      add(fixture, "a", "base\n", "base")
      const first = add(fixture, "a", "a\n", "original")
      const repo = RepoId.make(fixture.root)
      const r = yield* Repo
      yield* r.startRewrite(repo, request(yield* r.rewritePlan(repo, first), ["edit"]))
      const lock = join(fixture.root, ".git/index.lock")
      writeFileSync(lock, "")
      try {
        expect((yield* Effect.result(r.splitRebaseCommit(repo)))._tag).toBe("Failure")
      } finally {
        unlinkSync(lock)
      }
      expect(fixture.git("rev-parse", "HEAD")).toBe(first)
      expect(yield* r.rebaseState(repo)).toMatchObject({ phase: "edit", split: false })
      yield* r.splitRebaseCommit(repo)
      expect(yield* r.rebaseState(repo)).toMatchObject({ phase: "edit", split: true })
      yield* r.abortOperation(repo)
    }),
  )

  it.effect("rewords an older commit, preserves literal messages and saves the original history", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.commit("base")
      const first = add(fixture, "a", "a\n", "add a")
      add(fixture, "b", "b\n", "add b")
      const original = fixture.git("rev-parse", "HEAD")
      const tree = fixture.git("rev-parse", "HEAD^{tree}")
      const repo = RepoId.make(fixture.root)
      const r = yield* Repo
      const plan = yield* r.rewritePlan(repo, first)
      const edit = request(plan, ["reword", "pick"])
      const message = 'Rename "a" with $(touch SHOULD_NOT_EXIST) and `commands`\n\nA literal body.'
      const result = yield* r.startRewrite(repo, {
        ...edit,
        steps: edit.steps.map((step, i) => (i === 0 ? { ...step, message } : step)),
      })
      expect(result.paused).toBe(false)
      expect(fixture.git("show", "-s", "--format=%B", "HEAD^")).toBe(message)
      expect(fixture.git("log", "-1", "--format=%s")).toBe("add b")
      expect(fixture.git("rev-parse", "HEAD^{tree}")).toBe(tree)
      expect(fixture.git("rev-parse", result.backupRef)).toBe(original)
      expect(existsSync(join(fixture.root, "SHOULD_NOT_EXIST"))).toBe(false)
      expect(existsSync(join(fixture.root, ".git/gitui-rewrite"))).toBe(false)
    }),
  )

  it.effect("squashes both messages and fixes up content while keeping the previous message", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.commit("base")
      const first = add(fixture, "a", "a\n", "add a")
      add(fixture, "b", "b\n", "add b")
      add(fixture, "c", "c\n", "fix c")
      add(fixture, "d", "d\n", "add d")
      const tree = fixture.git("rev-parse", "HEAD^{tree}")
      const repo = RepoId.make(fixture.root)
      const r = yield* Repo
      yield* r.startRewrite(repo, request(yield* r.rewritePlan(repo, first), ["pick", "squash", "fixup", "pick"]))
      expect(fixture.git("log", "--reverse", "--format=%s").split("\n")).toEqual(["base", "add a", "add d"])
      expect(fixture.git("show", "-s", "--format=%B", "HEAD^")).toBe("add a\n\nadd b")
      expect(fixture.git("rev-parse", "HEAD^{tree}")).toBe(tree)
    }),
  )

  it.effect("reorders independent commits and drops the selected change", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.commit("base")
      const first = add(fixture, "a", "a\n", "add a")
      add(fixture, "b", "b\n", "add b")
      add(fixture, "c", "c\n", "add c")
      const repo = RepoId.make(fixture.root)
      const r = yield* Repo
      const edit = request(yield* r.rewritePlan(repo, first), ["pick", "drop", "pick"])
      yield* r.startRewrite(repo, { ...edit, steps: [edit.steps[2]!, edit.steps[0]!, edit.steps[1]!] })
      expect(fixture.git("log", "--reverse", "--format=%s").split("\n")).toEqual(["base", "add c", "add a"])
      expect(fixture.git("ls-tree", "--name-only", "HEAD").split("\n")).toEqual(["a", "c"])
    }),
  )

  it.effect("pauses for amendment and keeps later reword instructions after continuing", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.commit("base")
      const first = add(fixture, "a", "a\n", "add a")
      add(fixture, "b", "b\n", "add b")
      const repo = RepoId.make(fixture.root)
      const r = yield* Repo
      const edit = request(yield* r.rewritePlan(repo, first), ["edit", "reword"])
      const steps = edit.steps.map((step, i) => (i === 1 ? { ...step, message: "renamed b" } : step))
      expect((yield* r.startRewrite(repo, { ...edit, steps })).paused).toBe(true)
      expect(yield* r.rebaseState(repo)).toMatchObject({ _tag: "Rebase", phase: "edit", split: false })
      fixture.write("a", "amended a\n")
      yield* r.stage(repo, [RepoPath.make("a")])
      yield* r.commitIndex(repo, "amended a", true)
      yield* r.continueOperation(repo)
      expect(fixture.git("log", "--reverse", "--format=%s").split("\n")).toEqual(["base", "amended a", "renamed b"])
      expect(readFileSync(join(fixture.root, "a"), "utf8")).toBe("amended a\n")
      expect(yield* r.rebaseState(repo)).toEqual({ _tag: "Inactive" })
    }),
  )

  it.effect("splits a paused commit into separately staged replacements before replaying later commits", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.commit("base")
      fixture.write("a", "a\n")
      fixture.write("b", "b\n")
      fixture.git("add", ".")
      const first = Oid.make(fixture.commit("combined"))
      add(fixture, "later", "later\n", "later")
      const tree = fixture.git("rev-parse", "HEAD^{tree}")
      const repo = RepoId.make(fixture.root)
      const r = yield* Repo
      const started = yield* r.startRewrite(repo, request(yield* r.rewritePlan(repo, first), ["edit", "pick"]))
      yield* r.splitRebaseCommit(repo)
      expect(yield* r.rebaseState(repo)).toMatchObject({ _tag: "Rebase", phase: "edit", split: true })
      expect((yield* Effect.flip(r.continueOperation(repo))).stderr).toContain("Create the replacement commits")
      expect((yield* Effect.flip(r.commitIndex(repo, "wrong amend", true))).stderr).toContain("Create a new commit")
      yield* r.stage(repo, [RepoPath.make("a")])
      yield* r.commitIndex(repo, "part a", false)
      expect((yield* Effect.flip(r.continueOperation(repo))).stderr).toContain("remaining changes")
      yield* r.stage(repo, [RepoPath.make("b")])
      yield* r.commitIndex(repo, "part b", false)
      yield* r.continueOperation(repo)
      expect(fixture.git("log", "--reverse", "--format=%s").split("\n")).toEqual(["base", "part a", "part b", "later"])
      expect(fixture.git("rev-parse", "HEAD^{tree}")).toBe(tree)
      expect(fixture.git("log", "-1", "--format=%s", started.backupRef)).toBe("later")
    }),
  )

  for (const action of ["continue", "abort"] as const) {
    it.effect(`${action}s a conflicting rewrite and retains its backup`, () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        add(fixture, "a", "base\n", "base")
        const first = add(fixture, "a", "first\n", "first")
        add(fixture, "a", "second\n", "second")
        add(fixture, "later", "later\n", "later")
        const original = fixture.git("rev-parse", "HEAD")
        const repo = RepoId.make(fixture.root)
        const r = yield* Repo
        const edit = request(yield* r.rewritePlan(repo, first), ["drop", "pick", "reword"])
        const steps = edit.steps.map((step, i) => (i === 2 ? { ...step, message: "later renamed" } : step))
        const result = yield* r.startRewrite(repo, { ...edit, steps })
        expect(result.paused).toBe(true)
        expect(yield* r.rebaseState(repo)).toMatchObject({
          _tag: "Rebase",
          phase: "conflict",
          backupRef: result.backupRef,
        })
        expect((yield* Effect.flip(r.commitIndex(repo, "wrong commit", false))).stderr).toContain("use Continue")
        if (action === "continue") {
          fixture.write("a", "resolved second\n")
          yield* r.stage(repo, [RepoPath.make("a")])
          yield* r.continueOperation(repo)
          expect(fixture.git("log", "--reverse", "--format=%s").split("\n")).toEqual([
            "base",
            "second",
            "later renamed",
          ])
          expect(readFileSync(join(fixture.root, "a"), "utf8")).toBe("resolved second\n")
        } else {
          yield* r.abortOperation(repo)
          expect(fixture.git("rev-parse", "HEAD")).toBe(original)
          expect(readFileSync(join(fixture.root, "a"), "utf8")).toBe("second\n")
        }
        expect((yield* r.status(repo)).operation).toBeNull()
        expect(fixture.git("rev-parse", result.backupRef)).toBe(original)
        expect(existsSync(join(fixture.root, ".git/gitui-rewrite"))).toBe(false)
      }),
    )
  }

  it.effect(
    "rejects stale, dirty, detached, malformed, and unacknowledged published plans without changing history",
    () =>
      Effect.gen(function* () {
        const fixture = makeRepo()
        fixture.commit("base")
        const first = add(fixture, "a", "a\n", "a")
        const repo = RepoId.make(fixture.root)
        const r = yield* Repo
        const edit = request(yield* r.rewritePlan(repo, first), ["reword"])
        fixture.write("dirty", "dirty\n")
        expect((yield* Effect.flip(r.startRewrite(repo, edit))).stderr).toContain("stash all changes")
        fixture.git("clean", "-fd")
        fixture.git("switch", "--detach", "-q")
        expect((yield* Effect.flip(r.startRewrite(repo, edit))).stderr).toContain("Check out a branch")
        fixture.git("switch", "-q", "main")
        const duplicate: ReadonlyArray<RewriteStep> = [edit.steps[0]!, edit.steps[0]!]
        expect((yield* Effect.flip(r.startRewrite(repo, { ...edit, steps: duplicate }))).stderr).toContain(
          "exactly once",
        )
        fixture.git("update-ref", "refs/remotes/origin/main", first)
        expect((yield* Effect.flip(r.startRewrite(repo, edit))).stderr).toContain("already on a remote")
        fixture.commit("branch moved")
        expect((yield* Effect.flip(r.startRewrite(repo, { ...edit, allowPublished: true }))).stderr).toContain(
          "branch changed",
        )
        expect(fixture.git("log", "--reverse", "--format=%s").split("\n")).toEqual(["base", "a", "branch moved"])
        expect(fixture.git("for-each-ref", "--format=%(refname)", "refs/gitui/rewrites/")).toBe("")
      }),
  )

  it.effect("honors commit hooks and reports a stopped rewrite honestly", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.commit("base")
      const first = add(fixture, "a", "a\n", "a")
      fixture.git("config", "core.hooksPath", ".git/test-hooks")
      fixture.write(".git/test-hooks/commit-msg", "#!/bin/sh\necho 'Commit rejected by project hook' >&2\nexit 1\n")
      chmodSync(join(fixture.root, ".git/test-hooks/commit-msg"), 0o755)
      const repo = RepoId.make(fixture.root)
      const r = yield* Repo
      const plan = yield* r.rewritePlan(repo, first)
      const error = yield* Effect.flip(r.startRewrite(repo, request(plan, ["reword"])))
      expect(error.stderr).toContain("Commit rejected by project hook")
      expect(error.stderr).toContain("Original history saved at refs/gitui/rewrites/")
      expect((yield* r.status(repo)).operation).toBe("rebase")
      yield* r.abortOperation(repo)
      expect(fixture.git("rev-parse", "HEAD")).toBe(plan.head)
    }),
  )

  it.effect("honors configured commit signing instead of silently creating unsigned replacements", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      fixture.commit("base")
      const first = add(fixture, "a", "a\n", "a")
      fixture.git("config", "commit.gpgSign", "true")
      fixture.git("config", "gpg.program", "/gitui-test-missing-signing-program")
      const repo = RepoId.make(fixture.root)
      const r = yield* Repo
      const plan = yield* r.rewritePlan(repo, first)
      const error = yield* Effect.flip(r.startRewrite(repo, request(plan, ["reword"])))
      expect(error.stderr).toContain("gitui-test-missing-signing-program")
      expect(error.stderr).toContain("Original history saved at refs/gitui/rewrites/")
      yield* r.abortOperation(repo)
      expect(fixture.git("rev-parse", "HEAD")).toBe(plan.head)
    }),
  )

  it.effect("can reword the root commit and refuses to drop the entire repository history", () =>
    Effect.gen(function* () {
      const fixture = makeRepo()
      const first = add(fixture, "a", "a\n", "root")
      const repo = RepoId.make(fixture.root)
      const r = yield* Repo
      const plan = yield* r.rewritePlan(repo, first)
      expect(plan.base).toBeNull()
      expect((yield* Effect.flip(r.startRewrite(repo, request(plan, ["drop"])))).stderr).toContain(
        "Keep at least one commit",
      )
      const edit = request(plan, ["reword"])
      yield* r.startRewrite(repo, { ...edit, steps: edit.steps.map((step) => ({ ...step, message: "renamed root" })) })
      expect(fixture.git("log", "--format=%s")).toBe("renamed root")
      expect(readFileSync(join(fixture.root, "a"), "utf8")).toBe("a\n")
    }),
  )
})
