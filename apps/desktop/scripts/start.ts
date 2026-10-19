import { spawn } from "node:child_process"
import { electronBinary } from "./electron.ts"

const env: NodeJS.ProcessEnv = { ...process.env }
delete env["ELECTRON_RUN_AS_NODE"]
delete env["GITUI_DEV_URL"]

const child = spawn(electronBinary(false), ["."], { stdio: "inherit", env })
child.once("exit", (code) => process.exit(code ?? 0))
