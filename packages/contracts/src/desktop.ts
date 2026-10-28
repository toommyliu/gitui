import * as Schema from "effect/Schema"

export const Theme = Schema.Literals(["system", "light", "dark"])
export type Theme = typeof Theme.Type

export const OpenAppId = Schema.Literals([
  "file-manager",
  "vscode",
  "cursor",
  "zed",
  "sublime",
  "terminal",
  "ghostty",
  "xcode",
])
export type OpenAppId = typeof OpenAppId.Type

export interface OpenApp {
  readonly id: OpenAppId
  readonly name: string
  readonly icon: string | null
}

export const OpenInRequest = Schema.Struct({
  app: OpenAppId,
  repo: Schema.String,
  file: Schema.optional(
    Schema.Struct({
      path: Schema.String,
      line: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
    }),
  ),
})
export type OpenInRequest = typeof OpenInRequest.Type

export interface DesktopBridge {
  readonly rpcUrl: string
  readonly pickFolder: () => Promise<string | null>
  readonly getOpenApps: () => Promise<ReadonlyArray<OpenApp>>
  readonly openIn: (request: OpenInRequest) => Promise<void>
  readonly setTheme: (theme: Theme) => void
  readonly setMenuShortcuts: (shortcuts: MenuShortcuts) => void
  readonly onTheme: (listener: (theme: unknown) => void) => () => void
  readonly onCommand: (listener: (command: unknown) => void) => () => void
}

export const menuCommands = [
  "settings.open",
  "repo.open",
  "tab.close",
  "tab.reopen",
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
  "tab.reopen": "Mod+Shift+T",
  "tab.next": "Control+Tab",
  "tab.previous": "Control+Shift+Tab",
  "log.toggle": "Mod+J",
  "palette.open": "Mod+K",
} as const satisfies MenuShortcuts
