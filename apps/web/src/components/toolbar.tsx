import { useAtom, useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { ButtonGroup } from "@workspace/ui/components/button-group"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { useState } from "react"
import { shortOid } from "@/lib/format"
import { commandLogAtom, connectionAtom, isFailure, latest, logViewAtom, statusAtom, useGitAction } from "@/lib/git"
import { SettingsDialog } from "./settings-dialog"

type NetworkAction = "Fetch" | "Pull" | "Push"

function LogButton() {
  const entries = latest(useAtomValue(commandLogAtom)) ?? []
  const [view, setView] = useAtom(logViewAtom)
  const unseen = entries.filter((entry) => entry.id > view.seenId && isFailure(entry)).length
  return (
    <Button size="sm" variant="ghost" onClick={() => setView((current) => ({ ...current, open: true }))}>
      Log
      {unseen > 0 && (
        <Badge variant="destructive" className="h-4 rounded-sm px-1 tabular-nums">
          {unseen}
        </Badge>
      )}
    </Button>
  )
}

export function Toolbar({ repo }: { repo: RepoId }) {
  const status = latest(useAtomValue(statusAtom(repo)))
  const git = useGitAction()
  const [running, setRunning] = useState<NetworkAction | null>(null)
  const connection = useAtomValue(connectionAtom)

  const run = async (action: NetworkAction) => {
    setRunning(action)
    await git(action, repo, (c) => c(action, { repo }))
    setRunning(null)
  }

  const head = status?.head
  const upstream = status?.upstream
  const count = (action: NetworkAction) =>
    action === "Pull" ? (upstream?.behind ?? 0) : action === "Push" ? (upstream?.ahead ?? 0) : 0

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
      <div className="flex min-w-0 items-center gap-2">
        {head === undefined ? (
          <Skeleton className="h-3 w-24" />
        ) : (
          <span className="truncate font-semibold">
            {head._tag === "Detached" ? `HEAD at ${shortOid(head.oid)}` : head.name}
          </span>
        )}
        {head?._tag === "Unborn" && <span className="text-muted-foreground">no commits yet</span>}
        {upstream != null && <span className="truncate text-muted-foreground max-sm:hidden">{upstream.name}</span>}
        {status?.operation != null && <Badge variant="destructive">{status.operation} in progress</Badge>}
        {connection === "disconnected" && (
          <Badge variant="destructive">
            <Spinner data-icon="inline-start" />
            Reconnecting to server
          </Badge>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ButtonGroup>
          {(["Fetch", "Pull", "Push"] as const).map((action) => (
            <Button
              key={action}
              size="sm"
              variant="outline"
              disabled={running !== null}
              onClick={() => void run(action)}
            >
              {running === action && <Spinner data-icon="inline-start" />}
              {action}
              {count(action) > 0 && <span className="text-muted-foreground tabular-nums">{count(action)}</span>}
            </Button>
          ))}
        </ButtonGroup>
        <LogButton />
        <SettingsDialog />
      </div>
    </div>
  )
}
