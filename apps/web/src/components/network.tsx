import { RegistryContext, useAtom, useAtomValue } from "@effect/atom-react"
import type { PushContext, RepoId, Tracking } from "@gitui/contracts"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, CircleAlertIcon, RefreshCwIcon } from "lucide-react"
import { type ComponentProps, type ReactNode, useContext, useEffect, useEffectEvent } from "react"
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
import { savedPushDestination } from "@/lib/publishing-preferences"
import { pushContextAtom, pushContextKey, syncPreferencesAtom } from "@/lib/publishing-state"
import { settingsAtom } from "@/lib/settings"
import { pullChoices, pushUrls, usePublishing } from "./publishing"

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
  const publishing = usePublishing(repo)
  const idle = useAtomValue(networkStateAtom(repo))?._tag !== "Running"
  useCommand("repo.fetch", () => void network.run({ action: "Fetch" }), { enabled: idle })
  useCommand("repo.pull", publishing.pull, { enabled: idle })
  useCommand("repo.pullWith", publishing.pullWith, { enabled: idle })
  useCommand("repo.push", () => void publishing.push(), { enabled: idle })
  useCommand("repo.pushTo", () => void publishing.pushTo(), { enabled: idle })
  useCommand("repo.remotes", publishing.manageRemotes)
  useCommand("repo.pushTags", () => publishing.pushTags(), { enabled: idle })
}

const noPushContext = Atom.make(AsyncResult.initial<PushContext, never>())

export function SyncButtons({
  repo,
  branch,
  upstream,
}: {
  repo: RepoId
  branch: string | null
  upstream: Tracking | null
}) {
  const network = useNetwork(repo)
  const publishing = usePublishing(repo)
  const [preferences, setPreferences] = useAtom(syncPreferencesAtom(repo))
  const context = latest(useAtomValue(branch === null ? noPushContext : pushContextAtom(pushContextKey(repo, branch))))
  const state = useAtomValue(networkStateAtom(repo))
  const running = state?._tag === "Running" ? state.action : null
  const behind = upstream?.behind ?? 0
  const ahead = upstream?.ahead ?? 0
  const strategy = pullChoices.find((choice) => choice.value === preferences.pullStrategy)!.label
  const destination = context === undefined ? null : savedPushDestination(preferences, context)
  const remote = context?.remotes.find((remote) => remote.name === destination?.remote)
  const target = destination === null ? null : `${destination.remote}/${destination.remoteBranch}`
  const pushDetail = [
    ...(ahead > 0 && upstream !== null ? [`${commits(ahead)} ahead of ${upstream.name}`] : []),
    ...(remote !== undefined ? pushUrls(remote) : branch !== null ? [`Choose a remote and branch for ${branch}`] : []),
  ]

  return (
    <div className="flex w-full min-w-0 items-center justify-end">
      <SyncButton label="Fetch" disabled={running !== null} onClick={() => void network.run({ action: "Fetch" })}>
        {running === "Fetch" ? <Spinner className="size-3" /> : <RefreshCwIcon />}
      </SyncButton>
      <SyncButton
        label={`Pull${behind > 0 ? ` ${commits(behind)}` : ""}${upstream === null ? "" : ` from ${upstream.name}`}`}
        detail={`Strategy: ${strategy}`}
        disabled={running !== null}
        onClick={publishing.pull}
      >
        {running === "Pull" ? <Spinner className="size-3" /> : <ArrowDownIcon />}
        {behind > 0 && <span className="text-foreground tabular-nums">{behind}</span>}
      </SyncButton>
      <SyncMenu label="Pull options" disabled={running !== null}>
        <DropdownMenuRadioGroup
          value={preferences.pullStrategy}
          onValueChange={(next: unknown) => {
            const choice = pullChoices.find((choice) => choice.value === next)
            if (choice !== undefined) setPreferences((stored) => ({ ...stored, pullStrategy: choice.value }))
          }}
        >
          <DropdownMenuLabel>Pull strategy</DropdownMenuLabel>
          {pullChoices.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={publishing.pullWith}>Pull with strategy…</DropdownMenuItem>
      </SyncMenu>
      <SyncButton
        label={target === null ? "Push to…" : `Push to ${target}`}
        detail={pushDetail.length > 0 ? pushDetail.join("\n") : undefined}
        disabled={running !== null}
        className="min-w-0 shrink"
        onClick={() => void publishing.push(destination)}
      >
        {running === "Push" ? <Spinner className="size-3" /> : <ArrowUpIcon />}
        {ahead > 0 && <span className="text-foreground tabular-nums">{ahead}</span>}
        {target !== null && <span className="min-w-0 truncate">{target}</span>}
      </SyncButton>
      <SyncMenu label="Push options" disabled={running !== null}>
        <DropdownMenuItem onClick={() => void publishing.pushTo()}>Push to…</DropdownMenuItem>
        <DropdownMenuItem onClick={() => publishing.pushTags()}>Push tags…</DropdownMenuItem>
      </SyncMenu>
    </div>
  )
}

function SyncButton({
  label,
  detail,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string; detail?: string | undefined }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className={cn("px-1.5 text-muted-foreground", className)}
            aria-label={detail === undefined ? label : `${label}. ${detail}`}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
        {label}
        {detail !== undefined && <span className="break-all whitespace-pre-line opacity-70">{detail}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

function SyncMenu({ label, disabled, children }: { label: string; disabled: boolean; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="w-6 shrink-0 px-0 text-muted-foreground"
            aria-label={label}
            disabled={disabled}
          />
        }
      >
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
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
