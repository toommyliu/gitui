import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { dialog } from "electron"

const target = "/usr/local/bin/gitui"

const scriptFor = (bundle: string) =>
  `#!/bin/sh\n[ $# -eq 0 ] && set -- .\nexec open -a '${bundle.replaceAll("'", `'\\''`)}' "$@"\n`

const installDirectly = async (script: string) => {
  await rm(target, { force: true })
  await writeFile(target, script, { mode: 0o755 })
}

const installAsAdmin = async (script: string) => {
  const dir = await mkdtemp(join(tmpdir(), "gitui-"))
  try {
    const file = join(dir, "gitui")
    await writeFile(file, script)
    await promisify(execFile)("osascript", [
      "-e",
      "on run argv",
      "-e",
      `do shell script "mkdir -p /usr/local/bin && install -m 755 " & quoted form of item 1 of argv & " ${target}" with administrator privileges`,
      "-e",
      "end run",
      file,
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const confirmReplace = async () => {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: "Replace the existing gitui command?",
    detail: `${target} already exists and opens something else.`,
    buttons: ["Cancel", "Replace"],
    defaultId: 1,
    cancelId: 0,
  })
  return response === 1
}

const install = async () => {
  const script = scriptFor(resolve(process.execPath, "../../.."))
  const existing = await readFile(target, "utf8").catch(() => null)
  if (existing !== script) {
    if (existing !== null && !(await confirmReplace())) return
    await installDirectly(script).catch(() => installAsAdmin(script))
  }
  await dialog.showMessageBox({
    message: "Installed the gitui command",
    detail: "In a terminal, run gitui to open the current folder, or gitui <path> to open another one.",
  })
}

const isCancelledPrompt = (error: unknown) => String(error).includes("(-128)")

export const installShellCommand = () =>
  install().catch((error: unknown) => {
    if (isCancelledPrompt(error)) return
    dialog.showErrorBox("Couldn't install the gitui command", error instanceof Error ? error.message : String(error))
  })
