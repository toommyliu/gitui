import { useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { ButtonGroup } from "@workspace/ui/components/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { useState } from "react"
import { shortOid } from "@/lib/format"
import { latest, statusAtom, useGitAction } from "@/lib/git"
import { type Theme, useTheme } from "./theme-provider"

type NetworkAction = "Fetch" | "Pull" | "Push"

const themes: ReadonlyArray<readonly [Theme, string]> = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
]

export function Toolbar({ repo }: { repo: RepoId }) {
  const status = latest(useAtomValue(statusAtom(repo)))
  const git = useGitAction()
  const [running, setRunning] = useState<NetworkAction | null>(null)
  const { theme, setTheme } = useTheme()

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
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>Theme</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={theme} onValueChange={(value: Theme) => setTheme(value)}>
              {themes.map(([value, label]) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
