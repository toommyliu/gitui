import { randomBytes } from "node:crypto"
import { open, unlink } from "node:fs/promises"
import { GitError, type Oid, type RecoveryEntry, type RepoId, type Status, type UndoCommit } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import { Git } from "./git.ts"

const failure = (message: string) => new GitError({ args: ["recovery"], exitCode: -1, stderr: message })
const isOid = (oid: string) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)
const encoder = new TextEncoder()
const backupTime = (ref: string) => Number(/\/(\d+)-/.exec(ref)?.[1] ?? "0")
const eventTime = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000 ? value : 0

export const makeRecovery = (git: Git["Service"], status: (repo: RepoId) => Effect.Effect<Status, GitError>) => {
  const undoState = Effect.fn("Recovery.undoState")(function* (repo: RepoId) {
    const current = yield* status(repo)
    const unavailable = (reason: string): UndoCommit => ({ _tag: "Unavailable", reason })
    if (current.operation !== null) return unavailable(`Finish or abort the ${current.operation} first.`)
    if (current.entries.some((entry) => entry._tag === "Conflicted")) return unavailable("Resolve conflicts first.")
    if (current.head._tag === "Unborn") return unavailable("There are no commits to undo.")
    if (current.head._tag === "Detached") return unavailable("Switch to a branch before undoing a commit.")
    const fields = (yield* git.text(repo, ["show", "-s", "--format=%P%x00%s", current.head.oid])).trimEnd().split("\0")
    const parent = fields[0]?.split(" ")[0]
    if (parent === undefined || parent === "") return unavailable("The first commit has no parent to return to.")
    return {
      _tag: "Available",
      branch: current.head.name,
      oid: current.head.oid,
      parent: parent as Oid,
      subject: fields[1] ?? "",
    } satisfies UndoCommit
  })

  return {
    recovery: Effect.fn("Recovery.list")(function* (repo: RepoId) {
      const undo = yield* undoState(repo)
      const exists =
        (yield* git.text(repo, ["rev-parse", "--verify", "-q", "HEAD"], { okExitCodes: [1] })).trim() !== ""
      const entries: Array<RecoveryEntry> = []
      if (exists) {
        const fields = (yield* git.text(repo, [
          "reflog",
          "show",
          "-z",
          "-n",
          "500",
          "--date=unix",
          "--format=%H%x00%gD%x00%gs%x00%gn%x00%s",
          "HEAD",
        ])).split("\0")
        for (let i = 0; i + 4 < fields.length; i += 5) {
          const [oid = "", selector = "", action = "", actor = "", subject = ""] = fields.slice(i, i + 5)
          entries.push({
            kind: "reflog",
            oid: oid as Oid,
            selector: `HEAD@{${i / 5}}`,
            action,
            actor,
            subject,
            time: eventTime(Number(/@\{(\d+)\}/.exec(selector)?.[1] ?? "0")),
          })
        }
      }
      const backups = yield* Effect.forEach(["rewrites", "undo"], (namespace) =>
        git.text(repo, [
          "for-each-ref",
          "--count=100",
          "--sort=-refname",
          "--format=%(refname)%00%(objectname)%00%(subject)%00%(authorname)",
          `refs/gitui/${namespace}/`,
        ]),
      )
      const backupEntries: Array<RecoveryEntry> = []
      for (const line of backups.flatMap((out) => out.trimEnd().split("\n").filter(Boolean))) {
        const [selector = "", oid = "", subject = "", actor = ""] = line.split("\0")
        backupEntries.push({
          kind: "rewrite",
          selector,
          oid: oid as Oid,
          action: selector.startsWith("refs/gitui/undo/") ? "Before undo" : "Before history edit",
          subject,
          actor,
          time: eventTime(Math.floor(backupTime(selector) / 1000)),
        })
      }
      entries.push(...backupEntries.sort((a, b) => backupTime(b.selector) - backupTime(a.selector)).slice(0, 100))
      entries.sort((a, b) => b.time - a.time)
      return { entries, undo }
    }),
    recoverCommit: Effect.fn("Recovery.createBranch")(function* (repo: RepoId, oid: Oid, name: string) {
      if (!isOid(oid)) return yield* failure("Choose a full commit ID from recovery.")
      if (name.startsWith("-") || name === "HEAD") return yield* failure("Choose a valid branch name.")
      const ref = `refs/heads/${name}`
      yield* git.run(repo, ["check-ref-format", ref])
      yield* git.run(repo, ["cat-file", "-e", `${oid}^{commit}`])
      yield* git.run(repo, ["update-ref", "--create-reflog", "-m", "gitui: recover commit", "--stdin"], {
        stdin: encoder.encode(`option no-deref\ncreate ${ref} ${oid}\n`),
        write: true,
      })
    }),
    undoCommit: Effect.fn("Recovery.undoCommit")(function* (repo: RepoId, expected: Oid, branch: string) {
      if (!isOid(expected)) return yield* failure("Refresh recovery before undoing the commit.")
      const index = (yield* git.text(repo, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim()
      yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => open(`${index}.lock`, "wx", 0o600),
          catch: () => failure("Another Git operation is using the index. Wait for it to finish, then try again."),
        }),
        () =>
          Effect.gen(function* () {
            const current = yield* undoState(repo)
            if (current._tag === "Unavailable") return yield* failure(current.reason)
            if (current.oid !== expected || current.branch !== branch)
              return yield* failure("HEAD changed. Refresh recovery and review the current commit before undoing it.")
            const ref = `refs/heads/${current.branch}`
            const backup = `refs/gitui/undo/${Date.now()}-${randomBytes(6).toString("hex")}`
            const transaction = `start\noption no-deref\nupdate ${ref} ${current.parent} ${current.oid}\ncreate ${backup} ${current.oid}\nprepare\ncommit\n`
            yield* git.run(
              repo,
              ["update-ref", "--create-reflog", "-m", "gitui: undo commit, keep index and working tree", "--stdin"],
              { stdin: encoder.encode(transaction), write: true },
            )
          }),
        (handle) =>
          Effect.promise(async () => {
            await handle.close()
            await unlink(`${index}.lock`)
          }),
      )
    }),
  }
}
