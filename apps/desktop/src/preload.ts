import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron"

const subscribe = (channel: string) => (listener: (value: unknown) => void) => {
  const handler = (_event: IpcRendererEvent, value: unknown) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld("gitui", {
  rpcUrl: ipcRenderer.sendSync("gitui:rpc-url") as string,
  pickFolder: () => ipcRenderer.invoke("gitui:pick-folder") as Promise<string | null>,
  setTheme: (theme: unknown) => ipcRenderer.send("gitui:theme", theme),
  setMenuShortcuts: (shortcuts: unknown) => ipcRenderer.send("gitui:menu-shortcuts", shortcuts),
  onTheme: subscribe("gitui:theme"),
  onCommand: subscribe("gitui:command"),
})
