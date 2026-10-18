import { useAtomValue } from "@effect/atom-react"
import type { RepoId, Tracking } from "@gitui/contracts"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ArrowDownIcon, ArrowUpIcon, RefreshCwIcon } from "lucide-react"
import { networkLabels, networkStateAtom, useNetwork } from "@/lib/git"

const commits = (count: number) => `${count} ${count === 1 ? "commit" : "commits"}`

export function SyncButtons({ repo, upstream }: { repo: RepoId; upstream: Tracking | null }) {
  const network = useNetwork(repo)
  const running = useAtomValue(networkStateAtom(repo))
  const behind = upstream?.behind ?? 0
  const ahead = upstream?.ahead ?? 0
  const from = upstream === null ? "" : ` from ${upstream.name}`
  const to = upstream === null ? "" : ` to ${upstream.name}`
  const actions = [
    { action: "Fetch", Icon: RefreshCwIcon, count: 0, label: "Fetch" },
    {
      action: "Pull",
      Icon: ArrowDownIcon,
      count: behind,
      label: `Pull${behind > 0 ? ` ${commits(behind)}` : ""}${from}`,
    },
    { action: "Push", Icon: ArrowUpIcon, count: ahead, label: `Push${ahead > 0 ? ` ${commits(ahead)}` : ""}${to}` },
  ] as const

  return (
    <div className="ml-auto flex shrink-0 items-center">
      {actions.map(({ action, Icon, count, label }) => (
        <Tooltip key={action}>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="px-1.5 text-muted-foreground"
                aria-label={label}
                disabled={running !== null}
                onClick={() => void network.run({ action })}
              />
            }
          >
            {running?.action === action ? <Spinner /> : <Icon />}
            {count > 0 && <span className="text-foreground tabular-nums">{count}</span>}
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

export function NetworkProgress({ repo }: { repo: RepoId }) {
  const network = useNetwork(repo)
  const running = useAtomValue(networkStateAtom(repo))
  if (running === null) return null
  return (
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
  )
}
