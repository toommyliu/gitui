import { useAtom } from "@effect/atom-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { useRef } from "react"
import { useAppHotkeys } from "@tanstack/react-hotkeys"
import { type CommandId, commandGroups, paletteOpenAtom, runCommand, useRegisteredCommands } from "@/lib/commands"
import { Shortcut } from "./shortcut"

export function CommandPalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom)
  const registered = useRegisteredCommands().filter((id) => id !== "palette.open")
  const resolved = useAppHotkeys()
  const chosen = useRef<CommandId | null>(null)

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen: boolean) => {
        if (isOpen || chosen.current === null) return
        runCommand(chosen.current)
        chosen.current = null
      }}
      title="Commands"
      description="Search for a command to run."
      className="top-[20%] shadow-lg sm:max-w-xl"
      overlayClassName="bg-transparent"
    >
      <Command>
        <CommandInput placeholder="Search commands" />
        <CommandList className="max-h-[min(26rem,60svh)]">
          <CommandEmpty>No matching commands.</CommandEmpty>
          {commandGroups.map((group) => {
            const ids = registered.filter((id) => resolved[id].meta?.group === group)
            if (ids.length === 0) return null
            return (
              <CommandGroup key={group} heading={group}>
                {ids.map((id) => {
                  const { meta, hotkey } = resolved[id]
                  const name = meta?.name ?? id
                  return (
                    <CommandItem
                      key={id}
                      className="min-h-8"
                      value={name}
                      onSelect={() => {
                        chosen.current = id
                        setOpen(false)
                      }}
                    >
                      {name}
                      {hotkey !== null && (
                        <CommandShortcut>
                          <Shortcut hotkey={hotkey} />
                        </CommandShortcut>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
