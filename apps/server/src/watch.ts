import { watch, type FSWatcher } from "node:fs"
import { join, sep } from "node:path"
import type { ChangeScope, RepoEvent, RepoInfo } from "@gitui/contracts"
import { DRAFT_FILE } from "@gitui/git"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

const THROTTLE_MS = 120

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep)

export const classify = (repo: RepoInfo, path: string): ChangeScope | null => {
  if (!inside(path, repo.commonDir) && !inside(path, repo.gitDir)) return "worktree"
  if (path === join(repo.gitDir, "index")) return "index"
  if (path === join(repo.gitDir, DRAFT_FILE)) return "draft"
  if (path.endsWith(".lock")) return null
  const rel = path.slice(repo.commonDir.length + 1)
  if (rel.startsWith(`objects${sep}`) || rel.startsWith(`logs${sep}`)) return null
  return "refs"
}

const watchRoots = (repo: RepoInfo) =>
  [repo.id, repo.commonDir, repo.gitDir].filter((dir, i, all) => all.findIndex((other) => inside(dir, other)) === i)

export const watchRepo = (repo: RepoInfo): Stream.Stream<RepoEvent> =>
  Stream.callback<RepoEvent>(
    (queue) =>
      Effect.gen(function* () {
        const pending = new Set<ChangeScope>()
        let timer: ReturnType<typeof setTimeout> | undefined
        const flush = () => {
          timer = undefined
          Queue.offerUnsafe(queue, { scopes: [...pending] })
          pending.clear()
        }
        const mark = (scope: ChangeScope | null) => {
          if (scope === null) return
          pending.add(scope)
          timer ??= setTimeout(flush, THROTTLE_MS)
        }
        const watchers: Array<FSWatcher> = watchRoots(repo).map((dir) =>
          watch(dir, { recursive: true }, (_event, name) => {
            if (name === null) {
              mark("worktree")
              mark("index")
              mark("refs")
            } else {
              mark(classify(repo, join(dir, name)))
            }
          }),
        )
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            clearTimeout(timer)
            for (const watcher of watchers) watcher.close()
          }),
        )
      }),
    { bufferSize: 8, strategy: "sliding" },
  )
