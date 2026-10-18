import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  shell,
} from "electron"
import * as Schema from "effect/Schema"
import { APP_ORIGIN, BackendReady, SCHEME } from "./protocol.ts"

const webDist = resolve(__dirname, "../../web/dist")
const appOrigin = process.env.GITUI_DEV_URL ?? APP_ORIGIN

app.setName("gitui")
if (process.env.GITUI_USER_DATA_DIR !== undefined) app.setPath("userData", process.env.GITUI_USER_DATA_DIR)

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

const serveApp = (request: Request) => {
  const pathname = decodeURIComponent(new URL(request.url).pathname)
  const file = resolve(webDist, `.${pathname}`)
  const inside = file.startsWith(webDist + sep)
  const target = inside && existsSync(file) && statSync(file).isFile() ? file : join(webDist, "index.html")
  return net.fetch(pathToFileURL(target).toString())
}

const startBackend = () =>
  new Promise<{ readonly child: ChildProcess; readonly port: number }>((resolveStart, rejectStart) => {
    const child = spawn(process.execPath, [join(__dirname, "backend.mjs")], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    })
    child.once("message", (message) =>
      resolveStart({ child, port: Schema.decodeUnknownSync(BackendReady)(message).port }),
    )
    child.once("exit", (code) => rejectStart(new Error(`The git server exited with code ${code} before it started.`)))
    child.send({ appOrigin })
  })

const fromApp = (event: IpcMainEvent | IpcMainInvokeEvent) =>
  event.senderFrame?.url.startsWith(`${appOrigin}/`) === true

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.once("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${appOrigin}/`)) event.preventDefault()
  })
  void window.loadURL(`${appOrigin}/`)
}

let backend: ChildProcess | undefined
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window === undefined) return createWindow()
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.on("before-quit", () => {
    quitting = true
  })
  app.on("will-quit", () => backend?.kill())
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app
    .whenReady()
    .then(async () => {
      protocol.handle(SCHEME, serveApp)
      const started = await startBackend()
      backend = started.child
      backend.on("exit", (code) => {
        if (quitting) return
        dialog.showErrorBox("gitui stopped", `The git server exited with code ${code}.`)
        app.quit()
      })
      const rpcUrl = `ws://127.0.0.1:${started.port}/rpc`
      ipcMain.on("gitui:rpc-url", (event) => {
        event.returnValue = fromApp(event) ? rpcUrl : null
      })
      ipcMain.handle("gitui:pick-folder", async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!fromApp(event) || window === null) return null
        const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      })
      createWindow()
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch((error: unknown) => {
      dialog.showErrorBox("gitui couldn't start", error instanceof Error ? error.message : String(error))
      app.quit()
    })
}
