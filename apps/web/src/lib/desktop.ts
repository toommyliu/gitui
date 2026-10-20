import type { MenuShortcuts, Theme } from "@gitui/contracts"

export interface DesktopBridge {
  readonly rpcUrl: string
  readonly pickFolder: () => Promise<string | null>
  readonly setTheme: (theme: Theme) => void
  readonly setMenuShortcuts: (shortcuts: MenuShortcuts) => void
  readonly onTheme: (listener: (theme: unknown) => void) => () => void
  readonly onCommand: (listener: (command: unknown) => void) => () => void
}

declare global {
  interface Window {
    readonly gitui?: DesktopBridge
  }
}

export const desktop = window.gitui
