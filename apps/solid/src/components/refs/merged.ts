import type { BaseRef } from "@gitui/contracts"
import type { Repo } from "@/lib/repo"
import { call } from "@/lib/rpc"

const CONCURRENCY = 4

export interface Merged {
  readonly base: BaseRef | null
  readonly merged: ReadonlySet<string>
}

const isMerged = async (repo: Repo, base: BaseRef, name: string) => {
  try {
    const detail = await call((git) =>
      git.GetComparison({
        repo: repo.id,
        comparison: { base: base.oid, head: `refs/heads/${name}`, mode: "merge-base" },
      }),
    )
    return detail.start === detail.head
  } catch {
    return false
  }
}

export const loadMerged = async (repo: Repo, names: ReadonlyArray<string>): Promise<Merged> => {
  const { base } = await call((git) => git.GetWorktree({ repo: repo.id }))
  const merged = new Set<string>()
  if (base === null) return { base, merged }
  const queue = [...names]
  const worker = async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      if (await isMerged(repo, base, name)) merged.add(name)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { base, merged }
}
