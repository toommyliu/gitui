import { useAtom, useAtomValue } from "@effect/atom-react"
import type { OpenApp, OpenInRequest } from "@gitui/contracts"
import * as Atom from "effect/reactivity/Atom"
import { ArrowUpRightIcon, ChevronDownIcon, FolderIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { desktop } from "@/lib/desktop"
import { settingsAtom } from "@/lib/settings"

const appsAtom = Atom.make<ReadonlyArray<OpenApp>>((get) => {
  void desktop?.getOpenApps().then(
    (apps) => get.setSelf(apps),
    () => {
      toast.error("Couldn't find installed apps", { description: "Reload gitui to try again.", duration: Infinity })
    },
  )
  return []
}).pipe(Atom.keepAlive)

type Location = Omit<OpenInRequest, "app">

function AppIcon({ app }: { app: OpenApp }) {
  return app.icon === null ? (
    <FolderIcon aria-hidden="true" />
  ) : (
    <img src={app.icon} alt="" className="size-5 shrink-0 object-contain" />
  )
}

const useOpenIn = (location: Location) => {
  const apps = useAtomValue(appsAtom)
  const [settings, setSettings] = useAtom(settingsAtom)
  const preferred = apps.find((app) => app.id === settings.openApp) ?? apps.find((app) => app.id === "file-manager")
  const open = async (app: OpenApp) => {
    try {
      await desktop?.openIn({ ...location, app: app.id })
      setSettings((current) => ({ ...current, openApp: app.id }))
    } catch (error) {
      toast.error(`Couldn't open in ${app.name}`, {
        description: error instanceof Error ? error.message : "Choose another app from Open in and try again.",
        duration: Infinity,
        closeButton: true,
      })
    }
  }
  return { apps, preferred, open }
}

export function OpenInButton({
  compact = false,
  disabled = false,
  ...location
}: Location & { compact?: boolean; disabled?: boolean }) {
  const { apps, preferred, open } = useOpenIn(location)
  if (desktop === undefined || preferred === undefined) return null
  const subject = location.file === undefined ? "repository" : location.file.path
  const position = location.file?.line === undefined ? "" : ` at line ${location.file.line}`
  const label = `Open ${subject}${position} in ${preferred.name}`
  return (
    <div className="flex shrink-0 items-center">
      <Button
        size={compact ? "icon-sm" : "sm"}
        variant="ghost"
        disabled={disabled}
        aria-label={label}
        title={label}
        onClick={() => void open(preferred)}
      >
        <AppIcon app={preferred} />
        {!compact && preferred.name}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`Open ${subject} in…`}
              title="Open in…"
            />
          }
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {apps.map((app) => (
            <DropdownMenuItem key={app.id} onClick={() => void open(app)}>
              <AppIcon app={app} />
              {app.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function OpenInContextMenu({ disabled = false, ...location }: Location & { disabled?: boolean }) {
  const { apps, open } = useOpenIn(location)
  if (desktop === undefined || apps.length === 0) return null
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <ArrowUpRightIcon />
        Open in
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-44">
        {apps.map((app) => (
          <ContextMenuItem key={app.id} onClick={() => void open(app)}>
            <AppIcon app={app} />
            {app.name}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}
