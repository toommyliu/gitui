import type { DesktopBridge } from "@gitui/contracts"

declare global {
  interface Window {
    readonly gitui?: DesktopBridge
  }
}

export const desktop = window.gitui
