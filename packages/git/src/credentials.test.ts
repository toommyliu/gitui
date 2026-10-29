import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, test } from "vite-plus/test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { makeCredentialBridge } from "./credentials.ts"

const runHelper = (env: Record<string, string>) =>
  new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(env.GIT_ASKPASS!, ["Password for fake helper:"], { env: { ...process.env, ...env } })
    let output = ""
    child.stdout.on("data", (chunk) => {
      output += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, output }))
  })

test("uses an existing askpass first and removes generated helper files on shutdown", async () => {
  const nativeDir = mkdtempSync(join(tmpdir(), "gitui-native-helper-"))
  const native = join(nativeDir, "native-askpass")
  writeFileSync(native, "#!/bin/sh\n[ -z \"$ELECTRON_RUN_AS_NODE\" ] || exit 2\nprintf 'fake-native-answer\\n'\n")
  chmodSync(native, 0o700)
  const bridge = await makeCredentialBridge()
  const operation = bridge.register("/fake/repository")
  const helperDir = dirname(operation.env.GIT_ASKPASS)
  try {
    expect(await runHelper({ ...operation.env, GITUI_NATIVE_ASKPASS: native })).toEqual({
      code: 0,
      output: "fake-native-answer\n",
    })
    expect(operation.sanitize("fake-native-answer")).toBe("[redacted]")
    expect(existsSync(helperDir)).toBe(true)
  } finally {
    operation.close()
    bridge.close()
    rmSync(nativeDir, { recursive: true, force: true })
  }
  expect(existsSync(helperDir)).toBe(false)
})

test("rejects forged operation tokens and unblocks helpers when their operation closes", async () => {
  const bridge = await makeCredentialBridge()
  const operation = bridge.register("/fake/repository")
  try {
    const forged = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(operation.env.GITUI_PROMPT_SOCKET)
      let output = ""
      socket.on("connect", () => socket.write(JSON.stringify({ token: "forged-token", message: "fake" }) + "\n"))
      socket.on("data", (chunk) => {
        output += chunk
      })
      socket.on("end", () => resolve(output))
      socket.on("error", reject)
    })
    expect(forged).toBe("null\n")
    const prompted = Effect.runPromise(
      Stream.runHead(bridge.prompts("/fake/repository").pipe(Stream.filter((prompts) => prompts.length > 0))),
    )
    const helper = runHelper(operation.env)
    await prompted
    operation.close()
    expect(await helper).toEqual({ code: 1, output: "" })
  } finally {
    operation.close()
    bridge.close()
  }
})
