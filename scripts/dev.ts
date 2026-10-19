import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { statSync, writeSync } from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"

const BASE_WEB_PORT = 5173
const BASE_SERVER_PORT = 4600
// Browsers refuse to load port 6000, so web ports must stay below it.
const MAX_OFFSET = 800

const root = resolve(import.meta.dirname, "..")
const linkedWorktree = statSync(join(root, ".git")).isFile()
const start = linkedWorktree ? (createHash("sha256").update(root).digest().readUInt32BE(0) % MAX_OFFSET) + 1 : 0

const isFree = (port: number) =>
  new Promise<boolean>((resolveFree) => {
    const server = createServer()
    server.once("error", () => resolveFree(false))
    server.listen(port, "127.0.0.1", () => server.close(() => resolveFree(true)))
  })

const findPorts = async () => {
  for (let step = 0; step <= MAX_OFFSET; step++) {
    const offset = (start + step) % (MAX_OFFSET + 1)
    const web = BASE_WEB_PORT + offset
    const server = BASE_SERVER_PORT + offset
    if ((await isFree(web)) && (await isFree(server))) return { web, server }
  }
  throw new Error("No free dev ports")
}

const ports = await findPorts()
writeSync(1, `[dev] web http://127.0.0.1:${ports.web} server ${ports.server}\n`)

const env: NodeJS.ProcessEnv = {
  ...process.env,
  WEB_PORT: String(ports.web),
  SERVER_PORT: String(ports.server),
  PORT: String(ports.server),
}
if (linkedWorktree) env["GITUI_USER_DATA_DIR"] = join(root, ".dev", "electron")

const vp = join(root, "node_modules", "vite-plus", "bin", "vp")
// `vp run` SIGKILLs its other tasks once one exits non-zero, and Vite exits 130 on Ctrl+C, so each package gets its own `vp run`.
// In a terminal they share its foreground process group, so Ctrl+C reaches every task and Vite can read stdin.
// Otherwise each gets a process group to signal. vp waits for its task on SIGINT but abandons it on SIGTERM, so send SIGINT.
const interactive = process.stdin.isTTY
const children = process.argv
  .slice(2)
  .map((filter) =>
    spawn(process.execPath, [vp, "run", filter, "dev"], { stdio: "inherit", env, detached: !interactive }),
  )
const interrupt = () => {
  for (const child of children) {
    try {
      process.kill(-child.pid!, "SIGINT")
    } catch {}
  }
}
if (interactive) process.on("SIGINT", () => {})
else for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, interrupt)
const codes = await Promise.all(
  children.map((child) => new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)))),
)
process.exit(codes.find((code) => code !== 0) ?? 0)
