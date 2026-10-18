import { useAtom, useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Progress } from "@/components/ui/progress"
import { shortOid } from "@/lib/format"
import {
  commandLogAtom,
  connectionAtom,
  isFailure,
  latest,
  logViewAtom,
  networkLabels,
  networkStateAtom,
  statusAtom,
  useNetwork,
} from "@/lib/git"
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
  const network = useNetwork(repo)
  const running = useAtomValue(networkStateAtom(repo))
  const connection = useAtomValue(connectionAtom)

  const head = status?.head
  const upstream = status?.upstream
  const count = (action: NetworkAction) =>
    action === "Pull" ? (upstream?.behind ?? 0) : action === "Push" ? (upstream?.ahead ?? 0) : 0

  return (
    <>
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
                onClick={() => void network.run({ action })}
              >
                {running?.action === action && <Spinner data-icon="inline-start" />}
                {action}
                {count(action) > 0 && <span className="text-muted-foreground tabular-nums">{count(action)}</span>}
              </Button>
            ))}
          </ButtonGroup>
          <LogButton />
          <SettingsDialog />
        </div>
      </div>
      {running !== null && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/40 px-2">
          <span className="shrink-0 font-medium">{networkLabels[running.action]}</span>
          <Progress
            aria-label={`${networkLabels[running.action]} progress`}
            value={running.progress?.percent ?? null}
            className="w-20 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {running.progress?.line ?? "Connecting…"}
          </span>
          <Button size="xs" variant="ghost" onClick={network.cancel}>
            Cancel
          </Button>
        </div>
      )}
    </>
  )
}
