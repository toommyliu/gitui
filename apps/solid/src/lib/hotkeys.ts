import type { MenuCommand, MenuShortcuts } from "@gitui/contracts"
import { createContext, createSignal, onCleanup, useContext } from "solid-js"
import * as Schema from "effect/Schema"
import { desktop } from "./desktop"
import { load, save } from "./storage"

type Letter =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z"
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
const namedKeys = [
  "Enter",
  "Escape",
  "Backspace",
  "Delete",
  "Tab",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "/",
  ".",
  ",",
  "[",
  "]",
  "\\",
] as const
type Named = (typeof namedKeys)[number]
type Key = Letter | Digit | Named
type Modifiers = "" | "Mod+" | "Alt+" | "Shift+" | "Mod+Alt+" | "Mod+Shift+" | "Alt+Shift+" | "Mod+Alt+Shift+"
export type Chord = `${Modifiers}${Key}`

interface CommandDef {
  readonly name: string
  readonly keys: ReadonlyArray<Chord>
  readonly inInputs?: boolean
  readonly configurable?: boolean
}

export const commands = {
  "palette.open": { name: "Show all commands", keys: ["Mod+K"], inInputs: true, configurable: true },
  "settings.open": { name: "Open settings", keys: ["Mod+,"], inInputs: true },
  "theme.toggle": { name: "Switch between light and dark", keys: [] },
  "log.toggle": { name: "Show or hide the command log", keys: ["Mod+J"], inInputs: true, configurable: true },
  "repo.open": { name: "Open a repository", keys: ["Mod+O"], inInputs: true, configurable: true },
  "repo.switch": { name: "Switch repository…", keys: ["Mod+P"], inInputs: true, configurable: true },
  "branch.switch": { name: "Switch branch…", keys: ["Mod+Shift+B"], inInputs: true, configurable: true },
  "repo.close": { name: "Close the repository", keys: ["Mod+W"], inInputs: true },
  "repo.reopen": {
    name: "Reopen the last closed repository",
    keys: ["Mod+Shift+T"],
    inInputs: true,
    configurable: true,
  },
  "repo.fetch": { name: "Fetch", keys: [], configurable: true },
  "repo.pull": { name: "Pull", keys: [], configurable: true },
  "repo.pullWith": { name: "Pull with strategy…", keys: [] },
  "repo.push": { name: "Push", keys: [], configurable: true },
  "repo.pushTo": { name: "Push to…", keys: [] },
  "repo.pushTags": { name: "Push tags…", keys: [] },
  "repo.remotes": { name: "Manage remotes…", keys: [] },
  "repo.recovery": { name: "Recover commits…", keys: [] },
  "repo.undoCommit": { name: "Undo the last commit", keys: [] },
  "repo.identity": { name: "Commit identity and signing…", keys: [] },
  "repo.addWorktree": { name: "Add a worktree…", keys: [] },
  "repo.cleanupWorktrees": { name: "Clean up worktrees…", keys: [] },
  "repo.cleanupBranches": { name: "Clean up branches…", keys: [] },
  "repo.switch1": { name: "Switch to repository 1", keys: ["Alt+1"] },
  "repo.switch2": { name: "Switch to repository 2", keys: ["Alt+2"] },
  "repo.switch3": { name: "Switch to repository 3", keys: ["Alt+3"] },
  "repo.switch4": { name: "Switch to repository 4", keys: ["Alt+4"] },
  "repo.switch5": { name: "Switch to repository 5", keys: ["Alt+5"] },
  "repo.switch6": { name: "Switch to repository 6", keys: ["Alt+6"] },
  "repo.switch7": { name: "Switch to repository 7", keys: ["Alt+7"] },
  "repo.switch8": { name: "Switch to repository 8", keys: ["Alt+8"] },
  "repo.switch9": { name: "Switch to the last repository", keys: ["Alt+9"] },
  "history.compare": { name: "Compare branches or commits…", keys: [] },
  "history.file": { name: "Show a file's history and blame…", keys: [] },
  "history.extendNext": { name: "Extend the commit range down", keys: ["Shift+J", "Shift+ArrowDown"] },
  "history.extendPrevious": { name: "Extend the commit range up", keys: ["Shift+K", "Shift+ArrowUp"] },
  "history.copySha": { name: "Copy the commit hash", keys: ["Mod+C"] },
  "commit.rewrite": { name: "Rewrite commits…", keys: [] },
  "view.changes": { name: "Show changes", keys: ["Mod+1"], inInputs: true, configurable: true },
  "view.history": { name: "Show history", keys: ["Mod+2"], inInputs: true, configurable: true },
  "view.branches": { name: "Show branches", keys: ["Mod+3"], inInputs: true, configurable: true },
  "view.stashes": { name: "Show stashes", keys: ["Mod+4"], inInputs: true, configurable: true },
  "view.sidebar": { name: "Show or hide the list", keys: ["Mod+B"], inInputs: true, configurable: true },
  "view.files": { name: "Show or hide the file list", keys: ["Mod+Alt+B"], inInputs: true, configurable: true },
  "view.back": { name: "Leave focus", keys: ["Escape"] },
  "rail.next": { name: "Next repository", keys: ["Mod+Alt+ArrowDown"], inInputs: true, configurable: true },
  "rail.previous": { name: "Previous repository", keys: ["Mod+Alt+ArrowUp"], inInputs: true, configurable: true },
  "list.next": { name: "Move down a list", keys: ["J"], configurable: true },
  "list.previous": { name: "Move up a list", keys: ["K"], configurable: true },
  "diff.nextFile": { name: "Next file in the diff", keys: ["]"], configurable: true },
  "diff.previousFile": { name: "Previous file in the diff", keys: ["["], configurable: true },
  "diff.find": { name: "Find in the diff", keys: ["Mod+F"], inInputs: true },
  "diff.wrap": { name: "Turn line wrapping on or off", keys: ["Alt+Z"], configurable: true },
  "diff.nextHunk": { name: "Next hunk", keys: ["N"], configurable: true },
  "diff.previousHunk": { name: "Previous hunk", keys: ["P"], configurable: true },
  "diff.layout": { name: "Switch between unified and split", keys: ["Alt+S"], configurable: true },
  "lines.stage": { name: "Stage the selected lines", keys: ["S"], configurable: true },
  "lines.unstage": { name: "Unstage the selected lines", keys: ["U"], configurable: true },
  "lines.discard": { name: "Discard the selected lines", keys: ["D"], configurable: true },
  "lines.clear": { name: "Clear the line selection", keys: ["Escape"] },
  "commit.create": { name: "Commit staged changes", keys: ["Mod+Enter"], inInputs: true, configurable: true },
  "files.extendNext": { name: "Add the next file to the selection", keys: ["Shift+J", "Shift+ArrowDown"] },
  "files.extendPrevious": { name: "Add the previous file to the selection", keys: ["Shift+K", "Shift+ArrowUp"] },
  "files.selectAll": { name: "Select every file", keys: ["Mod+A"] },
  "files.stage": { name: "Stage or unstage the selection", keys: ["Space"] },
  "files.discard": { name: "Discard the selected files", keys: ["Mod+Backspace"] },
  "files.stageAll": { name: "Stage all files", keys: ["Mod+Shift+S"], inInputs: true, configurable: true },
  "files.unstageAll": { name: "Unstage all files", keys: ["Mod+Shift+U"], inInputs: true, configurable: true },
  "history.search": { name: "Search history", keys: ["Mod+F"], inInputs: true },
  "view.search": { name: "Search or filter the list", keys: ["/"], configurable: true },
} as const satisfies Record<string, CommandDef>

export type CommandId = keyof typeof commands

export const menuCommandIds: Record<MenuCommand, CommandId> = {
  "settings.open": "settings.open",
  "repo.open": "repo.open",
  "tab.close": "repo.close",
  "tab.reopen": "repo.reopen",
  "tab.next": "rail.next",
  "tab.previous": "rail.previous",
  "log.toggle": "log.toggle",
  "palette.open": "palette.open",
}

const menuOwned: ReadonlySet<CommandId> = new Set(desktop === undefined ? [] : Object.values(menuCommandIds))

const chordPattern = /^(Mod\+)?(Alt\+)?(Shift\+)?(.+)$/

export const isChord = (value: string): value is Chord => {
  const key = chordPattern.exec(value)?.[4]
  return key !== undefined && (/^[A-Z0-9]$/.test(key) || namedKeys.some((named) => named === key))
}

const isCommandId = (value: string): value is CommandId => Object.hasOwn(commands, value)

type Keymap = Partial<Record<CommandId, ReadonlyArray<Chord>>>

const KEYMAP = "gitui.solid.keymap"

const isConfigurable = (id: CommandId) => "configurable" in commands[id]

const decodeKeymap = (value: unknown): Keymap => {
  const stored = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Array(Schema.String)))(value)
  const keymap: Keymap = {}
  for (const [id, keys] of Object.entries(stored))
    if (isCommandId(id) && isConfigurable(id)) keymap[id] = keys.filter(isChord)
  return keymap
}

let current: Keymap = load(KEYMAP, decodeKeymap, {})
const [keymapVersion, setKeymapVersion] = createSignal(0)

const replaceKeymap = (next: Keymap) => {
  current = next
  save(KEYMAP, next)
  setKeymapVersion((version) => version + 1)
}

export const keysOf = (id: CommandId): ReadonlyArray<Chord> => {
  keymapVersion()
  return current[id] ?? commands[id].keys
}

export const isCustomized = (id: CommandId) => {
  keymapVersion()
  return current[id] !== undefined
}

export const commandIds = Object.keys(commands).filter(isCommandId)

export const configurableIds = commandIds.filter(isConfigurable)

export const commandsUsing = (chord: Chord): ReadonlyArray<CommandId> =>
  commandIds.filter((id) => keysOf(id).includes(chord))

export const menuShortcutTable = (): MenuShortcuts => {
  const keyOf = (id: CommandId): string | null => keysOf(id)[0] ?? null
  return {
    "settings.open": keyOf(menuCommandIds["settings.open"]),
    "repo.open": keyOf(menuCommandIds["repo.open"]),
    "tab.close": keyOf(menuCommandIds["tab.close"]),
    "tab.reopen": keyOf(menuCommandIds["tab.reopen"]),
    "tab.next": keyOf(menuCommandIds["tab.next"]),
    "tab.previous": keyOf(menuCommandIds["tab.previous"]),
    "log.toggle": keyOf(menuCommandIds["log.toggle"]),
    "palette.open": keyOf(menuCommandIds["palette.open"]),
  }
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

const keyOf = (event: KeyboardEvent): string => {
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1]
  if (letter !== undefined) return letter
  const digit = /^Digit(\d)$/.exec(event.code)?.[1]
  if (digit !== undefined) return digit
  return event.key === " " ? "Space" : event.key
}

export const chordOf = (event: KeyboardEvent): string => {
  const mod = isMac ? event.metaKey : event.ctrlKey
  return `${mod ? "Mod+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${keyOf(event)}`
}

export const matchesCommand = (event: KeyboardEvent, id: CommandId) => {
  const chord = chordOf(event)
  return keysOf(id).some((key) => key === chord)
}

export const formatChord = (chord: Chord) =>
  chord
    .replace("Mod+", isMac ? "⌘" : "Ctrl+")
    .replace("Alt+", isMac ? "⌥" : "Alt+")
    .replace("Shift+", isMac ? "⇧" : "Shift+")
    .replace("Enter", "↵")
    .replace("Escape", "Esc")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")

export const shortcut = (id: CommandId): string | undefined => {
  const chord = keysOf(id)[0]
  return chord === undefined ? undefined : formatChord(chord)
}

interface Handler {
  readonly id: CommandId
  readonly run: () => void
  readonly enabled: () => boolean
}

const handlers: Array<Handler> = []

const indexChords = () => {
  const index = new Map<string, ReadonlyArray<CommandId>>()
  for (const id of commandIds) for (const chord of keysOf(id)) index.set(chord, [...(index.get(chord) ?? []), id])
  return index
}

let byChord = indexChords()

export const setKeys = (id: CommandId, keys: ReadonlyArray<Chord> | null) => {
  const defaults: ReadonlyArray<Chord> = commands[id].keys
  const reset =
    keys === null || (keys.length === defaults.length && keys.every((key, index) => key === defaults[index]))
  const next: Keymap = Object.fromEntries(Object.entries(current).filter(([other]) => other !== id))
  if (!reset) next[id] = keys
  replaceKeymap(next)
  byChord = indexChords()
  desktop?.setMenuShortcuts(menuShortcutTable())
}

export const resetAllKeys = () => {
  replaceKeymap({})
  byChord = indexChords()
  desktop?.setMenuShortcuts(menuShortcutTable())
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)

const nativelyActivated =
  'button, a[href], select, summary, [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="treeitem"]'

const activatesItself = (chord: string, target: EventTarget | null) =>
  (chord === "Space" || chord === "Enter") && target instanceof Element && target.closest(nativelyActivated) !== null

const overModal: ReadonlySet<CommandId> = new Set(["palette.open", "settings.open"])

const modalOpen = () => document.querySelector('[aria-modal="true"]') !== null

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.isComposing) return
  const chord = chordOf(event)
  const ids = byChord.get(chord)
  if (ids === undefined || activatesItself(chord, event.target)) return
  const typing = isTyping(event.target)
  const blocked = modalOpen()
  for (let index = handlers.length - 1; index >= 0; index--) {
    const handler = handlers[index]
    if (handler === undefined || !ids.includes(handler.id) || menuOwned.has(handler.id) || !handler.enabled()) continue
    if (typing && !(commands[handler.id] as CommandDef).inInputs) continue
    if (blocked && !overModal.has(handler.id)) continue
    event.preventDefault()
    handler.run()
    return
  }
})

export const runCommand = (id: CommandId) => {
  for (let index = handlers.length - 1; index >= 0; index--) {
    const handler = handlers[index]
    if (handler?.id === id && handler.enabled()) return handler.run()
  }
}

export const isRunnable = (id: CommandId) => handlers.some((handler) => handler.id === id && handler.enabled())

export const CommandScope = createContext<() => boolean>(() => true)

export const useCommand = (id: CommandId, run: () => void, enabled: () => boolean = () => true) => {
  const inScope = useContext(CommandScope)
  const handler: Handler = { id, run, enabled: () => inScope() && enabled() }
  handlers.push(handler)
  onCleanup(() => {
    const index = handlers.indexOf(handler)
    if (index !== -1) handlers.splice(index, 1)
  })
}

const createHold = (matches: (event: KeyboardEvent) => boolean) => {
  const [held, setHeld] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const release = () => {
    clearTimeout(timer)
    setHeld(false)
  }
  window.addEventListener("keydown", (event) => {
    if (matches(event)) {
      if (!event.repeat) {
        clearTimeout(timer)
        timer = setTimeout(() => setHeld(true), 400)
      }
    } else if (!(event.altKey && /^Digit\d$/.test(event.code))) release()
  })
  window.addEventListener("keyup", (event) => {
    if (matches(event)) release()
  })
  window.addEventListener("blur", release)
  return held
}

export const modHeld = createHold((event) => event.key === (isMac ? "Meta" : "Control"))
export const altHeld = createHold((event) => event.key === "Alt")
