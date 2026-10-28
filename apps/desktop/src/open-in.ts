import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { type OpenApp, type OpenAppId, OpenInRequest } from "@gitui/contracts"
import { app, shell } from "electron"
import * as Schema from "effect/Schema"

const exec = promisify(execFile)

interface InstalledApp {
  readonly id: OpenAppId
  readonly name: string
  readonly path: string
  readonly executable: string
}

const macApps = [
  ["vscode", "VS Code", "Visual Studio Code.app", "Contents/Resources/app/bin/code"],
  ["cursor", "Cursor", "Cursor.app", "Contents/Resources/app/bin/cursor"],
  ["zed", "Zed", "Zed.app", "Contents/MacOS/cli"],
  ["sublime", "Sublime Text", "Sublime Text.app", "Contents/SharedSupport/bin/subl"],
  ["file-manager", "Finder", "/System/Library/CoreServices/Finder.app", ""],
  ["terminal", "Terminal", "/System/Applications/Utilities/Terminal.app", ""],
  ["ghostty", "Ghostty", "Ghostty.app", "Contents/MacOS/ghostty"],
  ["xcode", "Xcode", "Xcode.app", "/usr/bin/xed"],
] as const

const discover = async (): Promise<ReadonlyArray<InstalledApp>> => {
  if (process.platform === "darwin") {
    return macApps.flatMap(([id, name, bundle, binary]) => {
      const path = (
        isAbsolute(bundle) ? [bundle] : [join(homedir(), "Applications", bundle), join("/Applications", bundle)]
      ).find(existsSync)
      return path === undefined
        ? []
        : [{ id, name, path, executable: isAbsolute(binary) ? binary : join(path, binary) }]
    })
  }
  if (process.platform === "win32") {
    const windows = process.env.SystemRoot ?? "C:\\Windows"
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    const programs = process.env.ProgramFiles ?? "C:\\Program Files"
    const candidates: ReadonlyArray<readonly [OpenAppId, string, ReadonlyArray<string>]> = [
      [
        "vscode",
        "VS Code",
        [join(local, "Programs", "Microsoft VS Code", "Code.exe"), join(programs, "Microsoft VS Code", "Code.exe")],
      ],
      ["cursor", "Cursor", [join(local, "Programs", "cursor", "Cursor.exe")]],
      ["zed", "Zed", [join(local, "Programs", "Zed", "Zed.exe")]],
      ["sublime", "Sublime Text", [join(programs, "Sublime Text", "subl.exe")]],
      ["file-manager", "Explorer", [join(windows, "explorer.exe")]],
      ["terminal", "Command Prompt", [join(windows, "System32", "cmd.exe")]],
    ]
    return candidates.flatMap(([id, name, paths]) => {
      const path = paths.find(existsSync)
      return path === undefined ? [] : [{ id, name, path, executable: path }]
    })
  }
  const candidates: ReadonlyArray<readonly [OpenAppId, string, string]> = [
    ["vscode", "VS Code", "code"],
    ["cursor", "Cursor", "cursor"],
    ["zed", "Zed", "zed"],
    ["sublime", "Sublime Text", "subl"],
    ["file-manager", "File manager", "xdg-open"],
    ["terminal", "Terminal", "x-terminal-emulator"],
    ["ghostty", "Ghostty", "ghostty"],
  ]
  const found = await Promise.all(
    candidates.map(async ([id, name, command]) => {
      try {
        const { stdout } = await exec("which", [command])
        const path = stdout.trim()
        return [{ id, name, path, executable: path }]
      } catch {
        return []
      }
    }),
  )
  return found.flat()
}

const icons = new Map<string, Promise<string | null>>()

const readIcon = async (path: string): Promise<string | null> => {
  if (process.platform !== "darwin") return app.getFileIcon(path, { size: "small" }).then((icon) => icon.toDataURL())
  const { stdout } = await exec("/usr/bin/plutil", [
    "-extract",
    "CFBundleIconFile",
    "raw",
    "-o",
    "-",
    join(path, "Contents/Info.plist"),
  ])
  const name = basename(stdout.trim())
  const icon = join(path, "Contents/Resources", name.endsWith(".icns") ? name : `${name}.icns`)
  const temporary = await mkdtemp(join(tmpdir(), "gitui-icon-"))
  try {
    const iconset = join(temporary, "app.iconset")
    await exec("/usr/bin/iconutil", ["-c", "iconset", "-o", iconset, icon])
    const png = [
      "icon_32x32@2x.png",
      "icon_64x64.png",
      "icon_128x128.png",
      "icon_128x128@2x.png",
      "icon_256x256.png",
      "icon_256x256@2x.png",
      "icon_512x512.png",
      "icon_512x512@2x.png",
      "icon_16x16@2x.png",
      "icon_16x16.png",
    ]
      .map((name) => join(iconset, name))
      .find(existsSync)
    if (png === undefined) return null
    return `data:image/png;base64,${(await readFile(png)).toString("base64")}`
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

const appIcon = (path: string) => {
  const cached = icons.get(path)
  if (cached !== undefined) return cached
  const icon = readIcon(path).catch(() => null)
  icons.set(path, icon)
  return icon
}

export const getOpenApps = async (): Promise<ReadonlyArray<OpenApp>> =>
  Promise.all(
    (await discover()).map(async ({ id, name, path }) => ({
      id,
      name,
      icon: await appIcon(path),
    })),
  )

const openLocation = async (request: OpenInRequest) => {
  if (!isAbsolute(request.repo) || request.repo.includes("\0")) throw new Error("Choose an absolute repository path.")
  const repo = resolve(request.repo)
  const directory = await stat(repo).catch(() => null)
  if (directory === null || !directory.isDirectory())
    throw new Error("The repository folder no longer exists. Reopen the repository.")
  if (request.file === undefined) return { repo, path: repo }
  const path = resolve(repo, request.file.path)
  const inside = relative(repo, path)
  if (
    request.file.path.includes("\0") ||
    isAbsolute(request.file.path) ||
    inside === ".." ||
    inside.startsWith(`..${sep}`) ||
    isAbsolute(inside)
  ) {
    throw new Error("Choose a file inside this repository.")
  }
  try {
    await stat(path)
  } catch {
    throw new Error("This file is no longer on disk. Open the repository to find its current location.")
  }
  return { repo, path }
}

const launch = (executable: string, args: ReadonlyArray<string>, cwd: string) =>
  new Promise<void>((resolveLaunch, reject) => {
    const child = spawn(executable, args, { cwd, detached: true, stdio: "ignore" })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolveLaunch()
    })
  })

export const openIn = async (value: unknown) => {
  const request = Schema.decodeUnknownSync(OpenInRequest)(value)
  const { repo, path } = await openLocation(request)
  const target = (await discover()).find(({ id }) => id === request.app)
  if (target === undefined) throw new Error("This app is no longer installed. Choose another app from Open in.")
  const line = request.file?.line
  const position = line === undefined ? path : `${path}:${line}`
  switch (target.id) {
    case "file-manager":
      if (request.file === undefined) {
        const error = await shell.openPath(repo)
        if (error !== "") throw new Error(error)
      } else shell.showItemInFolder(path)
      return
    case "terminal":
      if (process.platform === "darwin") await exec("/usr/bin/open", ["-a", target.path, repo])
      else await launch(target.executable, process.platform === "win32" ? ["/K"] : [], repo)
      return
    case "ghostty":
      if (process.platform === "darwin") await exec("/usr/bin/open", ["-a", target.path, repo])
      else await launch(target.executable, [`--working-directory=${repo}`], repo)
      return
    case "xcode":
      await exec(target.executable, [...(line === undefined ? [] : ["--line", String(line)]), path])
      return
    case "vscode":
    case "cursor":
      if (process.platform === "win32")
        await launch(target.executable, line === undefined ? [path] : ["--goto", position], repo)
      else await exec(target.executable, line === undefined ? [path] : ["--goto", position])
      return
    case "zed":
    case "sublime":
      if (process.platform === "win32") await launch(target.executable, [position], repo)
      else await exec(target.executable, [position])
  }
}
