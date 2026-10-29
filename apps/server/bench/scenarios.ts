import { appendFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { allRefsVisible, type GitError, GitRpcs, type LogExpired, type RepoId, type RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import type * as RpcClient from "effect/rpc/RpcClient"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import type { Fixture } from "./fixture.ts"

export type Client = RpcClient.FromGroup<typeof GitRpcs, RpcClientError>

export type TrialError = GitError | LogExpired | RpcClientError

export interface Trial {
  readonly run: (client: Client) => Effect.Effect<unknown, TrialError>
  readonly verify?: () => void
}

export interface Scenario {
  readonly name: string
  readonly mutates: boolean
  readonly setup: (fx: Fixture, n: number) => Trial
}

export const firstLogPage = (client: Client, repo: RepoId) =>
  Effect.gen(function* () {
    const handle = yield* Stream.runHead(client.OpenLog({ repo, query: "", refs: allRefsVisible }))
    const { logId } = Option.getOrThrow(handle)
    return yield* client.GetLogPage({ repo, logId, start: 0, count: 200 })
  })

export const refresh = (client: Client, repo: RepoId) =>
  Effect.all([client.GetStatus({ repo }), client.GetRefs({ repo }), firstLogPage(client, repo)], {
    concurrency: "unbounded",
  })

const expect = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const hasRef = (fx: Fixture, ref: string) => fx.git("for-each-ref", "--format=%(refname)", ref) !== ""

const read = (name: string, run: (client: Client, repo: RepoId) => Effect.Effect<unknown, TrialError>): Scenario => ({
  name,
  mutates: false,
  setup: (fx) => ({ run: (client) => run(client, fx.root) }),
})

const worktreeRemoval = (name: string, force: boolean): Scenario => ({
  name,
  mutates: true,
  setup: (fx, n) => {
    const path = fx.worktree(`${name}-${n}`, `bench/${name}-${n}`, { create: true })
    if (force) appendFileSync(join(path, "README.md"), "uncommitted\n")
    return {
      run: (client) => client.RemoveWorktree({ repo: fx.root, path, force, deleteBranch: false }),
      verify: () => {
        expect(!existsSync(path), `${path} still exists`)
        expect(!fx.git("worktree", "list", "--porcelain").includes(path), `${path} is still registered`)
      },
    }
  },
})

export const scenarios: ReadonlyArray<Scenario> = [
  read("status", (client, repo) => client.GetStatus({ repo })),
  read("refs", (client, repo) => client.GetRefs({ repo })),
  {
    name: "log-open",
    mutates: false,
    setup: (fx, n) => {
      fx.git("branch", "-f", `bench/log-${n}`, `HEAD~${n + 1}`)
      return { run: (client) => firstLogPage(client, fx.root) }
    },
  },
  {
    name: "commit-detail",
    mutates: false,
    setup: (fx) => {
      const oid = fx.oid("HEAD")
      return { run: (client) => client.GetCommit({ repo: fx.root, oid }) }
    },
  },
  {
    name: "create-branch",
    mutates: true,
    setup: (fx, n) => {
      const name = `bench/new-${n}`
      const startPoint = fx.oid("HEAD~3")
      return {
        run: (client) => client.CreateBranch({ repo: fx.root, name, startPoint, checkout: false }),
        verify: () => expect(hasRef(fx, `refs/heads/${name}`), `${name} was not created`),
      }
    },
  },
  {
    name: "delete-branch",
    mutates: true,
    setup: (fx, n) => {
      const name = `bench/merged-${n}`
      fx.git("branch", name, "HEAD~2")
      return {
        run: (client) => client.DeleteBranch({ repo: fx.root, name, force: false, removeWorktree: false }),
        verify: () => expect(!hasRef(fx, `refs/heads/${name}`), `${name} still exists`),
      }
    },
  },
  {
    name: "add-worktree",
    mutates: true,
    setup: (fx, n) => {
      const path = join(fx.root, "..", `added-${n}`)
      return {
        run: (client) => client.AddWorktree({ repo: fx.root, path, branch: `bench/added-${n}`, startPoint: null }),
        verify: () => expect(existsSync(join(path, "Makefile")), `${path} was not checked out`),
      }
    },
  },
  {
    name: "checkout",
    mutates: true,
    setup: (fx) => {
      fx.git("switch", "-q", "main")
      return {
        run: (client) => client.Checkout({ repo: fx.root, branch: "topic/1" }),
        verify: () => expect(fx.git("branch", "--show-current") === "topic/1", "checkout did not switch"),
      }
    },
  },
  {
    name: "stage-file",
    mutates: true,
    setup: (fx, n) => {
      fx.git("switch", "-q", "main")
      fx.git("reset", "-q", "--hard")
      appendFileSync(join(fx.root, "Makefile"), `# change ${n}\n`)
      return {
        run: (client) => client.Stage({ repo: fx.root, paths: ["Makefile" as RepoPath] }),
        verify: () => expect(fx.git("diff", "--cached", "--name-only") === "Makefile", "Makefile was not staged"),
      }
    },
  },
  {
    name: "commit",
    mutates: true,
    setup: (fx, n) => {
      fx.git("switch", "-q", "main")
      appendFileSync(join(fx.root, "Makefile"), `# commit ${n}\n`)
      fx.git("add", "Makefile")
      const message = `bench commit ${n}`
      return {
        run: (client) => Stream.runDrain(client.Commit({ repo: fx.root, message, amend: false })),
        verify: () => expect(fx.git("log", "-1", "--format=%s") === message, "commit was not created"),
      }
    },
  },
  {
    name: "delete-branch-and-worktree",
    mutates: true,
    setup: (fx, n) => {
      const name = `bench/with-worktree-${n}`
      const path = fx.worktree(`with-worktree-${n}`, name, { create: true })
      return {
        run: (client) => client.DeleteBranch({ repo: fx.root, name, force: false, removeWorktree: true }),
        verify: () => {
          expect(!hasRef(fx, `refs/heads/${name}`), `${name} still exists`)
          expect(!existsSync(path), `${path} still exists`)
        },
      }
    },
  },
  worktreeRemoval("remove-worktree", false),
  worktreeRemoval("remove-worktree-force", true),
]
