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

const args = [
  join(root, "node_modules", "vite-plus", "bin", "vp"),
  "run",
  "--parallel",
  ...process.argv.slice(2),
  "dev",
]
if (process.stdin.isTTY && process.execve !== undefined) {
  process.execve(process.execPath, [process.execPath, ...args], env)
}
// vp exits on SIGTERM without stopping its tasks, so give it a process group and signal the whole group.
const child = spawn(process.execPath, args, { stdio: "inherit", env, detached: true })
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => process.kill(-child.pid!, signal))
}
child.on("exit", (code) => process.exit(code ?? 1))
