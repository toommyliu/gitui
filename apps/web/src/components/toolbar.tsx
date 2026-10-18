import { useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { Button } from "@workspace/ui/components/button"
import { useState } from "react"
import { shortOid } from "@/lib/format"
import { latest, statusAtom, useGitAction } from "@/lib/git"

type NetworkAction = "Fetch" | "Pull" | "Push"

export function Toolbar({ repo }: { repo: RepoId }) {
  const status = latest(useAtomValue(statusAtom(repo)))
  const git = useGitAction()
  const [running, setRunning] = useState<NetworkAction | null>(null)

  const run = async (action: NetworkAction) => {
    setRunning(action)
    await git(action, repo, (c) => c(action, { repo }))
    setRunning(null)
  }

  const head = status?.head
  const upstream = status?.upstream
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-semibold">
          {head === undefined ? "…" : head._tag === "Detached" ? `HEAD at ${shortOid(head.oid)}` : head.name}
        </span>
        {head?._tag === "Unborn" && <span className="text-muted-foreground">no commits yet</span>}
        {upstream !== null && upstream !== undefined && (
          <span className="truncate text-muted-foreground">
            {upstream.name}
            {upstream.ahead > 0 && ` · ${upstream.ahead} ahead`}
            {upstream.behind > 0 && ` · ${upstream.behind} behind`}
          </span>
        )}
        {status?.operation != null && (
          <span className="rounded-sm bg-destructive/15 px-1.5 py-0.5 font-medium text-destructive">
            {status.operation} in progress
          </span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 gap-1">
        {(["Fetch", "Pull", "Push"] as const).map((action) => (
          <Button key={action} size="sm" variant="outline" disabled={running !== null} onClick={() => void run(action)}>
            {running === action ? `${action}ing…` : action}
            {action === "Pull" && (upstream?.behind ?? 0) > 0 && (
              <span className="tabular-nums">{upstream?.behind}</span>
            )}
            {action === "Push" && (upstream?.ahead ?? 0) > 0 && <span className="tabular-nums">{upstream?.ahead}</span>}
          </Button>
        ))}
      </div>
    </div>
  )
}
