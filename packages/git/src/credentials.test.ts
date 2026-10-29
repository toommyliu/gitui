import { execFileSync, spawn } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, test } from "vite-plus/test"
import * as Fiber from "effect/Fiber"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { fixtureEnv, makeRepo } from "./testRepo.ts"
import { makeCredentialBridge } from "./credentials.ts"

const runHelper = (env: Record<string, string>, cwd?: string) =>
  new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(env.GIT_ASKPASS!, ["Password for fake helper:"], { cwd, env: { ...process.env, ...env } })
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
    expect(
      await runHelper({
        ...operation.env,
        GIT_ASKPASS: operation.env.SSH_ASKPASS,
        GITUI_NATIVE_ASKPASS: "/missing",
        GITUI_NATIVE_SSH_ASKPASS: native,
      }),
    ).toEqual({ code: 0, output: "fake-native-answer\n" })
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

test.each(["environment", "config", "ssh"] as const)(
  "matches native Git for literal %s askpass paths with shell characters",
  async (source) => {
    const fixture = makeRepo()
    const native = join(fixture.root, "native helper $(false)")
    writeFileSync(native, "#!/bin/sh\nprintf 'fake-literal-answer\\n'\n")
    chmodSync(native, 0o700)
    const env = {
      ...fixtureEnv(),
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: source === "environment" ? native : undefined,
      SSH_ASKPASS: source === "ssh" ? native : undefined,
    }
    if (source === "config") fixture.git("config", "core.askpass", native)
    const bridge = await makeCredentialBridge()
    const operation = bridge.register(fixture.root)
    const listening = Effect.runFork(
      Stream.runForEach(bridge.prompts(fixture.root), (prompts) =>
        Effect.sync(() => {
          for (const prompt of prompts) bridge.answer(fixture.root, prompt.id, null)
        }),
      ),
    )
    try {
      const nativeResult = execFileSync("git", ["-c", "credential.helper=", "credential", "fill"], {
        cwd: fixture.root,
        env,
        encoding: "utf8",
        input: "protocol=https\nhost=fake.invalid\n\n",
      })
      expect(nativeResult).toContain("username=fake-literal-answer\npassword=fake-literal-answer")
      expect(
        await runHelper(
          {
            ...operation.env,
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
            GITUI_NATIVE_ASKPASS: source === "environment" ? native : "",
            GITUI_NATIVE_SSH_ASKPASS: source === "ssh" ? native : "",
          },
          fixture.root,
        ),
      ).toEqual({ code: 0, output: "fake-literal-answer\n" })
    } finally {
      await Effect.runPromise(Fiber.interrupt(listening))
      operation.close()
      bridge.close()
      rmSync(fixture.root, { recursive: true, force: true })
    }
  },
)
