import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { basename, join, resolve } from "node:path"

const desktop = resolve(import.meta.dirname, "..")
const electron = createRequire(import.meta.url)("electron") as string

const run = (command: string, args: ReadonlyArray<string>) => {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr || result.stdout}`)
}

const hashDirectory = (dir: string) => {
  const hash = createHash("sha256")
  for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
    const path = join(dir, file)
    if (statSync(path).isFile()) hash.update(file).update(readFileSync(path))
  }
  return hash.digest("hex")
}

// macOS takes the Dock icon and the menu bar name from the bundle the binary runs from, so Electron runs from a renamed copy.
export const electronBinary = (dev: boolean) => {
  if (process.platform !== "darwin") return electron
  const name = dev ? "gitui (Dev)" : "gitui"
  const checkout = basename(resolve(desktop, "../.."))
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "")
  const id = dev ? `com.gitui.dev.${checkout}` : "com.gitui.app"
  const icon = dev ? "icon-dev" : "icon"
  const iconDocument = join(desktop, "resources", `${icon}.icon`)
  const source = resolve(electron, "../../..")
  const runtime = join(desktop, ".electron-runtime")
  const bundle = join(runtime, `${name}.app`)
  const binary = join(bundle, "Contents", "MacOS", "Electron")
  const stampFile = join(runtime, `${name}.json`)
  const stamp = JSON.stringify({
    source,
    sourceMtimeMs: statSync(source).mtimeMs,
    icon: hashDirectory(iconDocument),
    id,
  })
  if (existsSync(binary) && existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) return binary

  rmSync(bundle, { recursive: true, force: true })
  mkdirSync(runtime, { recursive: true })
  cpSync(source, bundle, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE })
  const resources = join(bundle, "Contents", "Resources")
  const partialPlist = join(runtime, `${name}.partial.plist`)
  run("xcrun", [
    "actool",
    iconDocument,
    "--compile",
    resources,
    "--platform",
    "macosx",
    "--minimum-deployment-target",
    "11.0",
    "--app-icon",
    icon,
    "--output-partial-info-plist",
    partialPlist,
  ])
  rmSync(partialPlist)
  const plist = join(bundle, "Contents", "Info.plist")
  const info = {
    CFBundleName: name,
    CFBundleDisplayName: name,
    CFBundleIdentifier: id,
    CFBundleIconFile: icon,
    CFBundleIconName: icon,
  }
  for (const [key, value] of Object.entries(info)) run("plutil", ["-replace", key, "-string", value, plist])
  run("codesign", ["--force", "--deep", "--sign", "-", bundle])
  run("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", [
    "-f",
    bundle,
  ])
  writeFileSync(stampFile, stamp)
  return binary
}
