import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test"

const native = vi.hoisted(() => ({ reveal: vi.fn(), openFolder: vi.fn().mockResolvedValue(""), execute: vi.fn() }))
vi.mock("electron", () => ({ app: {}, shell: { showItemInFolder: native.reveal, openPath: native.openFolder } }))
vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: ReadonlyArray<string>,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    native.execute(command, args)
    callback(null, "", "")
  },
  spawn: vi.fn(),
}))
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: (path: string) => path.startsWith("/Applications/") || path.startsWith("/System/"),
}))

import { openIn } from "./open-in"

let repo: string
const filename = "space ' quote $(touch nope); & #.ts"
beforeAll(async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin")
  repo = await mkdtemp(join(tmpdir(), "gitui-open-in-"))
  await mkdir(join(repo, "nested"))
  await writeFile(join(repo, "nested", filename), "first\nsecond\n")
})
afterAll(async () => {
  await rm(repo, { recursive: true, force: true })
  vi.restoreAllMocks()
})
beforeEach(() => vi.clearAllMocks())

describe("opening a review location in another app", () => {
  it("passes a file and line as one literal argument to the editor", async () => {
    await openIn({ app: "vscode", repo, file: { path: `nested/${filename}`, line: 2 } })
    expect(native.execute).toHaveBeenCalledWith(
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      ["--goto", `${repo}/nested/${filename}:2`],
    )
  })

  it("reveals the current file path without launching it", async () => {
    await openIn({ app: "file-manager", repo, file: { path: `nested/${filename}` } })
    expect(native.reveal).toHaveBeenCalledWith(join(repo, "nested", filename))
    expect(native.execute).not.toHaveBeenCalled()
  })

  it("opens a terminal at the worktree root even when invoked on a nested file", async () => {
    await openIn({ app: "terminal", repo, file: { path: `nested/${filename}` } })
    expect(native.execute).toHaveBeenCalledWith("/usr/bin/open", [
      "-a",
      "/System/Applications/Utilities/Terminal.app",
      repo,
    ])
  })

  it("opens a repository's contents in Finder", async () => {
    await openIn({ app: "file-manager", repo })
    expect(native.openFolder).toHaveBeenCalledWith(repo)
    expect(native.reveal).not.toHaveBeenCalled()
  })

  it("does not ask the editor to create a deleted file", async () => {
    await expect(openIn({ app: "vscode", repo, file: { path: "deleted.ts" } })).rejects.toThrow("no longer on disk")
    expect(native.execute).not.toHaveBeenCalled()
  })

  it("rejects paths outside the repository", async () => {
    await expect(openIn({ app: "vscode", repo, file: { path: "../outside.ts" } })).rejects.toThrow(
      "inside this repository",
    )
    await expect(openIn({ app: "vscode", repo, file: { path: "/etc/hosts" } })).rejects.toThrow(
      "inside this repository",
    )
    expect(native.execute).not.toHaveBeenCalled()
  })

  it("rejects unrecognized apps and invalid line numbers at the IPC boundary", async () => {
    for (const value of [
      { app: "sh", repo },
      { app: "vscode", repo, file: { path: "anything", line: 0 } },
      { app: "vscode", repo, file: { path: "anything", line: 1.5 } },
    ]) {
      await expect(openIn(value)).rejects.toThrow()
    }
    expect(native.execute).not.toHaveBeenCalled()
    expect(native.reveal).not.toHaveBeenCalled()
  })
})
