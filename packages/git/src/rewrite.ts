import { randomBytes } from "node:crypto"
import { join } from "node:path"
import {
  GitError,
  Oid,
  type RebaseState,
  type RepoId,
  type RewritePlan,
  type RewriteRequest,
  type RewriteResult,
  type Status,
} from "@gitui/contracts"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import type { Git } from "./git.ts"

const invalid = (stderr: string) => new GitError({ args: ["rebase", "--interactive"], exitCode: -1, stderr })
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

const editor = `const fs = require("node:fs")
const path = require("node:path")
const target = process.argv.at(-1)
if (process.argv[2] === "sequence") {
  const dir = path.dirname(target)
  const session = fs.readFileSync(path.join(__dirname, "session"), "utf8")
  const expected = JSON.parse(session)
  if (fs.readFileSync(path.join(dir, "orig-head"), "utf8").trim() !== expected.head ||
      fs.readFileSync(path.join(dir, "head-name"), "utf8").trim() !== "refs/heads/" + expected.branch) {
    throw new Error("The branch changed before the rebase started. Create a new plan.")
  }
  fs.copyFileSync(path.join(__dirname, "todo"), target)
  fs.writeFileSync(path.join(dir, "gitui-session"), session)
} else {
  const done = fs.readFileSync(path.join(__dirname, "..", "rebase-merge", "done"), "utf8").trim().split("\\n").at(-1)
  const match = /^reword ([0-9a-f]+)/.exec(done)
  if (match) fs.copyFileSync(path.join(__dirname, match[1] + ".msg"), target)
}
`

export const makeRewrite = (
  git: Git["Service"],
  fs: FileSystem.FileSystem,
  status: (repo: RepoId) => Effect.Effect<Status, GitError>,
  gitDirOf: (repo: RepoId) => Effect.Effect<string, GitError>,
) => {
  const fileError = (error: unknown) => invalid(`Unable to read or save the rebase plan: ${String(error)}`)
  const optional = (path: string) =>
    fs
      .readFileString(path)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(fileError(error)),
        ),
      )
  const write = (path: string, content: string) => fs.writeFileString(path, content).pipe(Effect.mapError(fileError))
  const run = (repo: RepoId, args: ReadonlyArray<string>) => Effect.asVoid(git.run(repo, args, { write: true }))
  const ownsSession = Effect.fn(function* (dir: string) {
    const saved = yield* optional(join(dir, "gitui-rewrite/session"))
    return saved !== null && saved === (yield* optional(join(dir, "rebase-merge/gitui-session")))
  })

  const state = Effect.fn("Rewrite.state")(function* (repo: RepoId): Effect.fn.Return<RebaseState, GitError> {
    const current = yield* status(repo)
    if (current.operation !== "rebase") return { _tag: "Inactive" }
    const dir = yield* gitDirOf(repo)
    const [amend, stopped, splitCommit] = yield* Effect.forEach(
      ["rebase-merge/amend", "rebase-merge/stopped-sha", "rebase-merge/gitui-split-commit"],
      (path) => optional(join(dir, path)),
    )
    const commit = amend?.trim() || stopped?.trim() || null
    return {
      _tag: "Rebase",
      phase: current.entries.some((entry) => entry._tag === "Conflicted")
        ? "conflict"
        : amend !== null && amend !== undefined
          ? "edit"
          : "other",
      commit: commit === null ? null : Oid.make(commit),
      split: commit !== null && splitCommit?.trim() === commit,
      backupRef: (yield* ownsSession(dir))
        ? (yield* optional(join(dir, "gitui-rewrite/backup")))?.trim() || null
        : null,
    }
  })

  const plan = Effect.fn("Rewrite.plan")(function* (repo: RepoId, first: Oid): Effect.fn.Return<RewritePlan, GitError> {
    const current = yield* status(repo)
    if (current.operation !== null) return yield* invalid("Finish or abort the current Git operation first.")
    if (current.head._tag !== "Branch") return yield* invalid("Check out a branch before editing its history.")
    if (current.entries.length > 0)
      return yield* invalid("Commit or stash all changes, including untracked files, first.")
    if (!/^[0-9a-f]{40,64}$/.test(first)) return yield* invalid("Choose a commit from this branch.")
    const { oid: head, name: branch } = current.head
    yield* git
      .run(repo, ["merge-base", "--is-ancestor", first, head])
      .pipe(Effect.mapError(() => invalid("Choose a commit that belongs to the checked-out branch.")))
    const parentLine = (yield* git.text(repo, ["rev-list", "--parents", "-1", first])).trim().split(" ")
    const base = parentLine[1] === undefined ? null : Oid.make(parentLine[1])
    const range = [head, ...(base === null ? [] : [`^${base}`])]
    const rows = (yield* git.text(repo, ["rev-list", "--reverse", "--parents", ...range])).trim().split("\n")
    if (rows.length > 200) return yield* invalid("Choose a newer starting commit. Edit up to 200 commits at a time.")
    if (rows.some((row) => row.split(" ").length > 2) || !rows[0]?.startsWith(first))
      return yield* invalid("This range contains merge commits. Choose a linear range after the last merge.")
    const unpublished = new Set(
      (yield* git.text(repo, ["rev-list", ...range, "--not", "--remotes"])).trim().split("\n"),
    )
    const commits = yield* Effect.forEach(rows, (row) => {
      const oid = Oid.make(row.split(" ")[0]!)
      return git
        .text(repo, ["show", "--no-patch", "--format=%B", oid])
        .pipe(Effect.map((message) => ({ oid, message: message.trimEnd(), published: !unpublished.has(oid) })))
    })
    return { branch, head, base, commits }
  })

  const environment = Effect.fn("Rewrite.environment")(function* (repo: RepoId, starting = false) {
    const gitDir = yield* gitDirOf(repo)
    const dir = join(gitDir, "gitui-rewrite")
    if (!starting && !(yield* ownsSession(gitDir))) return {}
    const command = `${quote(process.execPath)} ${quote(join(dir, "editor.cjs"))}`
    return { GIT_SEQUENCE_EDITOR: `${command} sequence`, GIT_EDITOR: `${command} message`, ELECTRON_RUN_AS_NODE: "1" }
  })

  const start = Effect.fn("Rewrite.start")(function* (
    repo: RepoId,
    request: RewriteRequest,
  ): Effect.fn.Return<RewriteResult, GitError> {
    const original = yield* plan(repo, request.first)
    if (original.head !== request.head || original.branch !== request.branch)
      return yield* invalid("The branch changed while the plan was open. Close it and create a new plan.")
    const expected = new Set(original.commits.map((commit) => commit.oid))
    if (
      request.steps.length !== expected.size ||
      new Set(request.steps.map((step) => step.oid)).size !== expected.size ||
      request.steps.some((step) => !expected.has(step.oid))
    )
      return yield* invalid("The plan must include each selected commit exactly once. Use Drop to remove a commit.")
    let picked = false
    for (const step of request.steps) {
      if (step.action === "drop") continue
      if ((step.action === "squash" || step.action === "fixup") && !picked)
        return yield* invalid("The first kept commit must be Pick, Reword, or Edit before a squash or fixup.")
      if (step.action === "reword" && (step.message.trim() === "" || step.message.includes("\0")))
        return yield* invalid("Enter a commit message for each Reword step.")
      picked = true
    }
    if (!picked && original.base === null)
      return yield* invalid("Keep at least one commit when editing the root commit.")
    if (original.commits.some((commit) => commit.published) && !request.allowPublished)
      return yield* invalid("Confirm that you want to rewrite commits that are already on a remote branch.")

    const dir = join(yield* gitDirOf(repo), "gitui-rewrite")
    yield* fs.remove(dir, { recursive: true, force: true }).pipe(Effect.mapError(fileError))
    yield* fs.makeDirectory(dir).pipe(Effect.mapError(fileError))
    yield* write(join(dir, "editor.cjs"), editor)
    yield* write(
      join(dir, "session"),
      JSON.stringify({ id: randomBytes(16).toString("hex"), head: original.head, branch: original.branch }),
    )
    yield* write(join(dir, "todo"), request.steps.map((step) => `${step.action} ${step.oid}\n`).join(""))
    for (const step of request.steps) {
      if (step.action === "reword") yield* write(join(dir, `${step.oid}.msg`), step.message)
    }
    const backupRef = `refs/gitui/rewrites/${Date.now()}-${randomBytes(4).toString("hex")}`
    yield* run(repo, [
      "update-ref",
      "--create-reflog",
      "-m",
      `Before history edit on ${original.branch}`,
      backupRef,
      original.head,
      "",
    ])
    yield* write(join(dir, "backup"), backupRef)
    yield* git
      .run(
        repo,
        [
          "-c",
          "rebase.abbreviateCommands=false",
          "-c",
          "rebase.updateRefs=false",
          "-c",
          "rebase.autoSquash=false",
          "rebase",
          "--interactive",
          "--no-autostash",
          "--no-rebase-merges",
          "--no-autosquash",
          "--keep-empty",
          ...(original.base === null ? ["--root"] : [original.base]),
        ],
        { write: true, env: yield* environment(repo, true) },
      )
      .pipe(
        Effect.catchTag("GitError", (error) =>
          Effect.gen(function* () {
            const paused = yield* state(repo)
            if (paused._tag === "Rebase" && paused.phase === "conflict") return
            return yield* new GitError({
              args: error.args,
              exitCode: error.exitCode,
              stderr: `${error.stderr}\nOriginal history saved at ${backupRef}.`,
            })
          }),
        ),
      )
    const paused = (yield* status(repo)).operation === "rebase"
    if (!paused) yield* fs.remove(dir, { recursive: true, force: true }).pipe(Effect.ignore)
    return { backupRef, paused }
  })

  const split = Effect.fn("Rewrite.split")(function* (repo: RepoId) {
    const current = yield* status(repo)
    const stopped = yield* state(repo)
    if (stopped._tag !== "Rebase" || stopped.phase !== "edit" || stopped.split)
      return yield* invalid("Pause at an Edit step before splitting a commit.")
    if (current.entries.length > 0) return yield* invalid("Commit or discard the current edits before splitting.")
    if (current.head._tag === "Unborn" || current.head.oid !== stopped.commit)
      return yield* invalid(
        "This commit was already amended. Continue the rebase or abort and plan it again to split it.",
      )
    const parent = (yield* git.text(repo, ["rev-list", "--parents", "-1", "HEAD"])).trim().split(" ")[1]
    if (parent === undefined)
      return yield* invalid("The root commit cannot be split here. Amend it or continue the rebase.")
    const dir = join(yield* gitDirOf(repo), "rebase-merge")
    yield* write(join(dir, "gitui-split-base"), parent)
    yield* write(join(dir, "gitui-split-commit"), stopped.commit!)
    yield* run(repo, ["reset", "--mixed", parent]).pipe(
      Effect.tapError(() =>
        Effect.all([
          fs.remove(join(dir, "gitui-split-base"), { force: true }),
          fs.remove(join(dir, "gitui-split-commit"), { force: true }),
        ]).pipe(Effect.ignore),
      ),
    )
  })

  const checkContinue = Effect.fn("Rewrite.checkContinue")(function* (repo: RepoId) {
    const stopped = yield* state(repo)
    if (stopped._tag !== "Rebase" || !stopped.split) return
    const current = yield* status(repo)
    const base = (yield* optional(join(yield* gitDirOf(repo), "rebase-merge/gitui-split-base")))?.trim()
    if (current.head._tag === "Unborn" || current.head.oid === base || current.entries.length > 0)
      return yield* invalid(
        "Create the replacement commits and commit or discard all remaining changes before continuing.",
      )
  })

  const checkCommit = Effect.fn("Rewrite.checkCommit")(function* (repo: RepoId, amend: boolean) {
    const current = yield* status(repo)
    if (current.operation !== "rebase") return
    const stopped = yield* state(repo)
    if (stopped._tag !== "Rebase" || stopped.phase !== "edit")
      return yield* invalid("Resolve conflicts and use Continue to commit this rebase step.")
    if (amend && stopped.split) return yield* invalid("Create a new commit for each part of the split.")
  })

  const cleanup = Effect.fn(function* (repo: RepoId) {
    if ((yield* status(repo)).operation !== "rebase")
      yield* fs
        .remove(join(yield* gitDirOf(repo), "gitui-rewrite"), { recursive: true, force: true })
        .pipe(Effect.ignore)
  })

  return { plan, start, state, split, environment, checkContinue, checkCommit, cleanup }
}
