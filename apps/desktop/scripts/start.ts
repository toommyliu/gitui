import { spawn } from "node:child_process"
import { createRequire } from "node:module"

const electron = createRequire(import.meta.url)("electron") as string
const env = { ...process.env }
delete env["ELECTRON_RUN_AS_NODE"]

const child = spawn(electron, [".", ...process.argv.slice(2)], { stdio: "inherit", env })
child.on("exit", (code) => process.exit(code ?? 0))
