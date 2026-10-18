export interface DesktopBridge {
  readonly rpcUrl: string
  readonly pickFolder: () => Promise<string | null>
}

declare global {
  interface Window {
    readonly gitui?: DesktopBridge
  }
}

export const desktop = window.gitui
