import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { MenuCommand, menuCommands, MenuShortcuts, menuShortcuts } from "@gitui/contracts"
import {
  type CustomHotkeys,
  defineAppHotkeys,
  type Hotkey,
  type HotkeyCallback,
  type HotkeyChord,
  PUNCTUATION_CODE_MAP,
  type UseHotkeyCommonOptions,
  useAppHotkeys,
  useHotkey,
  useHotkeys,
  validateHotkey,
} from "@tanstack/react-hotkeys"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react"
import { desktop } from "./desktop"

declare module "@tanstack/react-hotkeys" {
  interface HotkeyMeta {
    readonly also?: ReadonlyArray<HotkeyChord>
  }
  interface Register {
    appHotkeys: typeof appHotkeys
  }
}

export const commandGroups = ["General", "Tabs", "Repository", "History", "Lists", "Working copy", "Diff"] as const

const desktopDefault = (hotkey: HotkeyChord) => (desktop === undefined ? null : hotkey)

export const appHotkeys = defineAppHotkeys({
  "settings.open": { hotkey: menuShortcuts["settings.open"], meta: { name: "Open settings", group: "General" } },
  "palette.open": { hotkey: menuShortcuts["palette.open"], meta: { name: "Show all commands", group: "General" } },
  "theme.toggle": { hotkey: null, meta: { name: "Switch between light and dark", group: "General" } },
  "log.toggle": {
    hotkey: menuShortcuts["log.toggle"],
    meta: { name: "Show or hide the command log", group: "General" },
  },
  "repo.open": { hotkey: menuShortcuts["repo.open"], meta: { name: "Open a repository", group: "Tabs" } },
  "tab.close": { hotkey: desktopDefault(menuShortcuts["tab.close"]), meta: { name: "Close the tab", group: "Tabs" } },
  "tab.reopen": {
    hotkey: desktopDefault(menuShortcuts["tab.reopen"]),
    meta: { name: "Reopen closed tab", group: "Tabs" },
  },
  "tab.next": { hotkey: desktopDefault(menuShortcuts["tab.next"]), meta: { name: "Next tab", group: "Tabs" } },
  "tab.previous": {
    hotkey: desktopDefault(menuShortcuts["tab.previous"]),
    meta: { name: "Previous tab", group: "Tabs" },
  },
  "repo.fetch": { hotkey: null, meta: { name: "Fetch", group: "Repository" } },
  "repo.pull": { hotkey: null, meta: { name: "Pull", group: "Repository" } },
  "repo.remotes": { hotkey: null, meta: { name: "Manage remotes…", group: "Repository" } },
  "repo.pushTags": { hotkey: null, meta: { name: "Push tags…", group: "Repository" } },
  "repo.push": { hotkey: null, meta: { name: "Push", group: "Repository" } },
  "repo.recovery": { hotkey: null, meta: { name: "Recover discarded changes or commits…", group: "Repository" } },
  "history.compare": { hotkey: null, meta: { name: "Compare branches or commits…", group: "History" } },
  "history.extendNext": { hotkey: "Shift+ArrowDown", meta: { name: "Extend commit range down", group: "History" } },
  "history.extendPrevious": { hotkey: "Shift+ArrowUp", meta: { name: "Extend commit range up", group: "History" } },
  "history.search": { hotkey: "Mod+F", meta: { name: "Search history", group: "History" } },
  "history.copySha": { hotkey: "Mod+C", meta: { name: "Copy the commit SHA", group: "History" } },
  "list.next": { hotkey: "J", meta: { name: "Move down a list", group: "Lists", also: ["ArrowDown"] } },
  "list.previous": { hotkey: "K", meta: { name: "Move up a list", group: "Lists", also: ["ArrowUp"] } },
  "commit.create": {
    hotkey: "Mod+Enter",
    meta: { name: "Commit staged changes", group: "Working copy" },
    options: { ignoreInputs: false },
  },
  "files.extendNext": {
    hotkey: "Shift+J",
    meta: { name: "Add the next file to the selection", group: "Working copy", also: ["Shift+ArrowDown"] },
  },
  "files.extendPrevious": {
    hotkey: "Shift+K",
    meta: { name: "Add the previous file to the selection", group: "Working copy", also: ["Shift+ArrowUp"] },
  },
  "files.selectAll": { hotkey: "Mod+A", meta: { name: "Select every file in the section", group: "Working copy" } },
  "files.clear": { hotkey: "Escape", meta: { name: "Clear the selection", group: "Working copy" } },
  "files.stage": { hotkey: "Space", meta: { name: "Stage or unstage the selection", group: "Working copy" } },
  "files.discard": {
    hotkey: "Backspace",
    meta: { name: "Discard the selection", group: "Working copy", also: ["Delete"] },
  },
  "files.stageAll": { hotkey: "Mod+Shift+S", meta: { name: "Stage all files", group: "Working copy" } },
  "files.unstageAll": { hotkey: "Mod+Shift+U", meta: { name: "Unstage all files", group: "Working copy" } },
  "diff.nextFile": { hotkey: "]", meta: { name: "Next file in the diff", group: "Diff" } },
  "diff.previousFile": { hotkey: "[", meta: { name: "Previous file in the diff", group: "Diff" } },
  "diff.wrap": { hotkey: "Alt+Z", meta: { name: "Turn line wrapping on or off", group: "Diff" } },
  "diff.layout": { hotkey: null, meta: { name: "Switch between unified and split", group: "Diff" } },
})

export type CommandId = keyof typeof appHotkeys

export const tabKeys = [
  "Mod+1",
  "Mod+2",
  "Mod+3",
  "Mod+4",
  "Mod+5",
  "Mod+6",
  "Mod+7",
  "Mod+8",
  "Mod+9",
] as const satisfies ReadonlyArray<HotkeyChord>

const CUSTOM_HOTKEYS = "gitui.hotkeys"

const StoredHotkeys = Schema.Record(Schema.String, Schema.NullOr(Schema.String))

const isCommandId = (id: string): id is CommandId => Object.hasOwn(appHotkeys, id)

const isHotkey = (value: string): value is HotkeyChord => validateHotkey(value).valid

export const toLogicalHotkey = (hotkey: HotkeyChord): HotkeyChord => {
  const match = /^(.*)\[(\w+)\]$/.exec(hotkey)
  if (match === null) return hotkey
  const [, held = "", code = ""] = match
  const letter = /^Key([A-Z])$/.exec(code)?.[1]
  const character = held.includes("Shift") ? undefined : (/^Digit(\d)$/.exec(code)?.[1] ?? PUNCTUATION_CODE_MAP[code])
  const logical = `${held}${letter ?? character ?? code}`
  return isHotkey(logical) ? logical : hotkey
}

export const loadCustomHotkeys = () => {
  const custom: CustomHotkeys = {}
  try {
    const stored = Schema.decodeUnknownSync(StoredHotkeys)(JSON.parse(localStorage.getItem(CUSTOM_HOTKEYS) ?? "{}"))
    for (const [id, hotkey] of Object.entries(stored)) {
      if (isCommandId(id) && (hotkey === null || isHotkey(hotkey))) custom[id] = hotkey
    }
  } catch {
    return custom
  }
  return custom
}

export const saveCustomHotkeys = (custom: CustomHotkeys) => localStorage.setItem(CUSTOM_HOTKEYS, JSON.stringify(custom))

export const paletteOpenAtom = Atom.make(false).pipe(Atom.keepAlive)

const openModalsAtom = Atom.make(0).pipe(Atom.keepAlive)

export const useModal = (open: boolean) => {
  const setOpenModals = useAtomSet(openModalsAtom)
  useEffect(() => {
    if (!open) return
    setOpenModals((count) => count + 1)
    return () => setOpenModals((count) => count - 1)
  }, [open, setOpenModals])
}

export const useOverlayOpen = () => useAtomValue(openModalsAtom) > 0

const handlers = new Map<CommandId, () => void>()
const listeners = new Set<() => void>()
let registered: ReadonlyArray<CommandId> = []

const changed = () => {
  registered = Object.keys(appHotkeys).filter((id): id is CommandId => isCommandId(id) && handlers.has(id))
  for (const listener of listeners) listener()
}

export const runCommand = (id: CommandId) => handlers.get(id)?.()

export const useRegisteredCommands = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => registered,
  )

const isMenuCommand = Schema.is(MenuCommand)

const whileOverlayOpen: ReadonlySet<CommandId> = new Set(["settings.open"])

export const useCommand = (id: CommandId, run: () => void, options?: { readonly enabled?: boolean }) => {
  const overlayOpen = useOverlayOpen()
  const available = options?.enabled ?? true
  const active = available && (whileOverlayOpen.has(id) || !overlayOpen)
  const latest = useRef({ run, active })
  useLayoutEffect(() => {
    latest.current = { run, active }
  })
  useEffect(() => {
    if (!available) return
    const handler = () => {
      if (latest.current.active) latest.current.run()
    }
    handlers.set(id, handler)
    changed()
    return () => {
      if (handlers.get(id) !== handler) return
      handlers.delete(id)
      changed()
    }
  }, [id, available])
  const menuOwned = desktop !== undefined && isMenuCommand(id)
  useHotkey(useAppHotkeys()[id], run, { enabled: active && !menuOwned })
}

export interface KeyBinding {
  readonly id: CommandId
  readonly run: HotkeyCallback
}

export const useCommandKeys = (bindings: ReadonlyArray<KeyBinding>, options: UseHotkeyCommonOptions) => {
  const resolved = useAppHotkeys()
  useHotkeys(
    bindings.flatMap(({ id, run }) => {
      const appHotkey = resolved[id]
      return [
        { hotkey: appHotkey, callback: run },
        ...(appHotkey.meta?.also ?? []).map((hotkey) => ({ hotkey, callback: run })),
      ]
    }),
    options,
  )
}

export const useDesktopMenu = () => {
  const resolved = useAppHotkeys()
  useEffect(
    () =>
      desktop?.onCommand((value) => {
        if (isMenuCommand(value)) runCommand(value)
      }),
    [],
  )
  const shortcuts = JSON.stringify(Object.fromEntries(menuCommands.map((id) => [id, resolved[id].hotkey])))
  useEffect(() => {
    desktop?.setMenuShortcuts(Schema.decodeUnknownSync(MenuShortcuts)(JSON.parse(shortcuts)))
  }, [shortcuts])
}

export const isHotkeyChord = (hotkey: Hotkey): hotkey is HotkeyChord => typeof hotkey === "string"
