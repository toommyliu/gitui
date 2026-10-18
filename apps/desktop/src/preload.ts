import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("gitui", {
  rpcUrl: ipcRenderer.sendSync("gitui:rpc-url") as string,
  pickFolder: () => ipcRenderer.invoke("gitui:pick-folder") as Promise<string | null>,
})
