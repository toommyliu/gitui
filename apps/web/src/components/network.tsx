import { RegistryContext, useAtomValue } from "@effect/atom-react"
import type { RepoId, Tracking } from "@gitui/contracts"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CircleAlertIcon, RefreshCwIcon } from "lucide-react"
import { useContext, useEffect, useEffectEvent } from "react"
import { useCommand } from "@/lib/commands"
import {
  latest,
  networkAtom,
  networkDoneLabels,
  networkLabels,
  networkStateAtom,
  repoInfoAtom,
  useNetwork,
} from "@/lib/git"
import { settingsAtom } from "@/lib/settings"

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

const commits = (count: number) => `${count} ${count === 1 ? "commit" : "commits"}`

export function useBackgroundFetch(paths: ReadonlyArray<string>) {
  const registry = useContext(RegistryContext)
  const { backgroundFetch } = useAtomValue(settingsAtom)
  const fetchAll = useEffectEvent(() => {
    for (const path of paths) {
      const repo = latest(registry.get(repoInfoAtom(path)))?.id
      if (repo === undefined || registry.get(networkStateAtom(repo))?._tag === "Running") continue
      registry.set(networkAtom(repo), { action: "Fetch" })
    }
  })
  useEffect(() => {
    if (backgroundFetch === "off") return
    const timer = setInterval(fetchAll, Number(backgroundFetch) * 60_000)
    return () => clearInterval(timer)
  }, [backgroundFetch])
}

export function useNetworkCommands(repo: RepoId) {
  const network = useNetwork(repo)
  const idle = useAtomValue(networkStateAtom(repo))?._tag !== "Running"
  useCommand("repo.fetch", () => void network.run({ action: "Fetch" }), { enabled: idle })
  useCommand("repo.pull", () => void network.run({ action: "Pull" }), { enabled: idle })
  useCommand("repo.push", () => void network.run({ action: "Push" }), { enabled: idle })
}

export function SyncButtons({ repo, upstream }: { repo: RepoId; upstream: Tracking | null }) {
  const network = useNetwork(repo)
  const state = useAtomValue(networkStateAtom(repo))
  const running = state?._tag === "Running" ? state : null
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
            {running?.action === action ? <Spinner className="size-3" /> : <Icon />}
            {count > 0 && <span className="text-foreground tabular-nums">{count}</span>}
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

export function NetworkStatus({ repo }: { repo: RepoId }) {
  const network = useNetwork(repo)
  const state = useAtomValue(networkStateAtom(repo))
  if (state === null) return null
  if (state._tag === "Finished") {
    const at = clock.format(state.at)
    switch (state.outcome) {
      case "succeeded":
        return (
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <CheckIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {networkDoneLabels[state.action]} at {at}
            </span>
          </span>
        )
      case "failed":
        return (
          <span className="flex min-w-0 items-center gap-1.5 text-destructive">
            <CircleAlertIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {networkLabels[state.action]} failed at {at}
            </span>
          </span>
        )
      case "cancelled":
        return (
          <span className="truncate text-muted-foreground">
            {networkLabels[state.action]} cancelled at {at}
          </span>
        )
    }
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 font-medium">{networkLabels[state.action]}</span>
      <Progress
        aria-label={`${networkLabels[state.action]} progress`}
        value={state.progress?.percent ?? null}
        className="w-20 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
        {state.progress?.line ?? "Connecting…"}
      </span>
      <Button size="xs" variant="ghost" onClick={network.cancel}>
        Cancel
      </Button>
    </div>
  )
}
