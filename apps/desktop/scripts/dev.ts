import { type ChildProcess, spawn } from "node:child_process"
import { createRequire } from "node:module"
import { connect } from "node:net"
import { setTimeout as sleep } from "node:timers/promises"
import { context, type Plugin } from "esbuild"
import { bundles } from "./bundles.ts"

const devUrl = new URL(`http://127.0.0.1:${process.env.WEB_PORT ?? 5173}`)
const electron = createRequire(import.meta.url)("electron") as string
const env: NodeJS.ProcessEnv = { ...process.env, GITUI_DEV_URL: devUrl.origin }
delete env["ELECTRON_RUN_AS_NODE"]

const viteListening = () =>
  new Promise<boolean>((resolve) => {
    const socket = connect(Number(devUrl.port), devUrl.hostname)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })

let app: ChildProcess | undefined
let closing = false

const stop = () =>
  new Promise<void>((resolve) => {
    const running = app
    app = undefined
    if (running === undefined || running.exitCode !== null || running.signalCode !== null) return resolve()
    running.once("exit", () => resolve())
    running.kill()
  })

const start = async () => {
  while (!(await viteListening())) await sleep(100)
  if (closing) return
  const child = spawn(electron, ["."], { stdio: "inherit", env })
  child.once("exit", () => {
    if (app === child) app = undefined
  })
  app = child
}

let restarts = Promise.resolve()
let timer: NodeJS.Timeout | undefined
const restart = () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    restarts = restarts.then(stop).then(start)
  }, 100)
}

const built = new Set<string | undefined>()
const relaunch: Plugin = {
  name: "relaunch-electron",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return
      built.add(build.initialOptions.outfile)
      if (built.size === bundles.length) restart()
    })
  },
}

const contexts = await Promise.all(bundles.map((options) => context({ ...options, plugins: [relaunch] })))
await Promise.all(contexts.map((ctx) => ctx.watch()))

const shutdown = async () => {
  closing = true
  clearTimeout(timer)
  await Promise.all(contexts.map((ctx) => ctx.dispose()))
  await stop()
  process.exit(0)
}
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
