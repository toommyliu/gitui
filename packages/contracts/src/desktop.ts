import * as Schema from "effect/Schema"

export const Theme = Schema.Literals(["system", "light", "dark"])
export type Theme = typeof Theme.Type

export const menuCommands = [
  "settings.open",
  "repo.open",
  "tab.close",
  "tab.next",
  "tab.previous",
  "log.toggle",
  "palette.open",
] as const

export const MenuCommand = Schema.Literals(menuCommands)
export type MenuCommand = typeof MenuCommand.Type

export const MenuShortcuts = Schema.Record(MenuCommand, Schema.NullOr(Schema.String))
export type MenuShortcuts = typeof MenuShortcuts.Type

export const menuShortcuts = {
  "settings.open": "Mod+,",
  "repo.open": "Mod+O",
  "tab.close": "Mod+W",
  "tab.next": "Control+Tab",
  "tab.previous": "Control+Shift+Tab",
  "log.toggle": "Mod+J",
  "palette.open": "Mod+K",
} as const satisfies MenuShortcuts
