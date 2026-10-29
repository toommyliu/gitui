import { randomUUID } from "node:crypto"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitError, type CredentialPrompt } from "@gitui/contracts"
import * as Deferred from "effect/Deferred"
import * as Exit from "effect/Exit"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

const helperSource = String.raw`
const net = require('node:net');
const cp = require('node:child_process');
delete process.env.ELECTRON_RUN_AS_NODE;
const kind = process.argv[2];
const configAskpass = kind === 'git' ? cp.spawnSync('git', ['config','--get','core.askpass'], {encoding:'utf8'}).stdout?.trim() : '';
const native = kind === 'ssh' ? process.env.GITUI_NATIVE_SSH_ASKPASS : process.env.GITUI_NATIVE_ASKPASS || configAskpass || process.env.GITUI_NATIVE_SSH_ASKPASS;
let nativeAnswer;
if (native) {
  const result = cp.spawnSync(native, process.argv.slice(3), {encoding:'utf8', env:{...process.env, GIT_ASKPASS:native, SSH_ASKPASS:native}});
  if (result.status === 0) nativeAnswer = result.stdout.replace(/\r?\n$/, '');
}
const socket = net.createConnection(process.env.GITUI_PROMPT_SOCKET);
let data = '';
socket.on('connect', () => socket.write(JSON.stringify({token:process.env.GITUI_PROMPT_TOKEN,message:process.argv[3] || 'Git authentication', answer:nativeAnswer})+'\n'));
socket.on('data', chunk => { data += chunk; if (data.includes('\n')) { try { const answer=JSON.parse(data); if (typeof answer === 'string') { process.stdout.write(answer+'\n'); process.exit(0); } } catch {} process.exit(1); } });
socket.on('error', () => process.exit(1));
socket.on('end', () => process.exit(1));
setTimeout(() => process.exit(1), 300000).unref();
`

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

export const makeCredentialBridge = async () => {
  const directory = mkdtempSync(join(tmpdir(), "gitui-askpass-"))
  chmodSync(directory, 0o700)
  const socketPath = process.platform === "win32" ? `\\\\.\\pipe\\gitui-${randomUUID()}` : join(directory, "bridge")
  const script = join(directory, "askpass.cjs")
  const helper = join(directory, process.platform === "win32" ? "askpass.cmd" : "askpass")
  writeFileSync(script, helperSource, { mode: 0o600 })
  const sshHelper = join(directory, process.platform === "win32" ? "ssh-askpass.cmd" : "ssh-askpass")
  for (const [path, kind] of [
    [helper, "git"],
    [sshHelper, "ssh"],
  ] as const)
    writeFileSync(
      path,
      process.platform === "win32"
        ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${script}" ${kind} %*\r\n`
        : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(script)} ${kind} "$@"\n`,
      { mode: 0o700 },
    )
  const operations = new Map<
    string,
    { cwd: string; secrets: Array<string>; cancelled: boolean; cancellation: Deferred.Deferred<void> }
  >()
  const pending = new Map<string, { token: string; prompt: CredentialPrompt; socket: Socket }>()
  const listeners = new Map<string, Set<(prompts: ReadonlyArray<CredentialPrompt>) => void>>()
  const snapshot = (cwd: string) =>
    Array.from(pending.values())
      .filter((item) => operations.get(item.token)?.cwd === cwd)
      .map((item) => item.prompt)
  const notify = (cwd: string) => listeners.get(cwd)?.forEach((listener) => listener(snapshot(cwd)))
  const sanitize = (token: string, value: string) => {
    const secrets = [
      ...new Set(
        (operations.get(token)?.secrets ?? []).flatMap((secret) => [
          secret,
          ...secret.split(/\r?\n/).map((line) => line.trim()),
        ]),
      ),
    ]
      .filter((secret) => secret !== "")
      .sort((left, right) => right.length - left.length)
    for (const secret of secrets) value = value.replaceAll(secret, "[redacted]")
    return value.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@")
  }
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    let data = ""
    socket.setTimeout(300_000, () => socket.destroy())
    socket.on("error", () => {})
    socket.on("data", (chunk) => {
      data += chunk.toString()
      if (data.length > 8192) return socket.destroy()
      if (!data.includes("\n")) return
      socket.removeAllListeners("data")
      let request: unknown
      try {
        request = JSON.parse(data)
      } catch {
        return socket.destroy()
      }
      if (
        typeof request !== "object" ||
        request === null ||
        !("token" in request) ||
        !("message" in request) ||
        typeof request.token !== "string" ||
        typeof request.message !== "string"
      )
        return socket.destroy()
      const operation = operations.get(request.token)
      if (operation === undefined || operation.cancelled) return socket.end("null\n")
      if ("answer" in request && typeof request.answer === "string") {
        if (request.answer !== "") operation.secrets.push(request.answer)
        return socket.end(`${JSON.stringify(request.answer)}\n`)
      }
      const id = randomUUID()
      const prompt = {
        id,
        message: sanitize(request.token, request.message).slice(0, 2000),
        secret: !/^username\b/i.test(request.message),
      }
      pending.set(id, { token: request.token, prompt, socket })
      notify(operation.cwd)
      socket.once("close", () => {
        if (pending.delete(id)) {
          operation.cancelled = true
          Deferred.doneUnsafe(operation.cancellation, Exit.void)
        }
        notify(operation.cwd)
      })
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, resolve)
    })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return {
    register(cwd: string) {
      const token = randomUUID()
      const operation = {
        cwd,
        secrets: [] as Array<string>,
        cancelled: false,
        cancellation: Deferred.makeUnsafe<void>(),
      }
      operations.set(token, operation)
      return {
        env: {
          GIT_ASKPASS: helper,
          SSH_ASKPASS: sshHelper,
          SSH_ASKPASS_REQUIRE: "force",
          DISPLAY: process.env.DISPLAY ?? "gitui:0",
          GITUI_PROMPT_SOCKET: socketPath,
          GITUI_PROMPT_TOKEN: token,
          GITUI_NATIVE_ASKPASS: process.env.GIT_ASKPASS ?? "",
          GITUI_NATIVE_SSH_ASKPASS: process.env.SSH_ASKPASS ?? "",
        },
        sanitize: (value: string) => sanitize(token, value),
        cancelledEffect: Deferred.await(operation.cancellation).pipe(
          Effect.andThen(
            Effect.fail(
              new GitError({ args: [], exitCode: -1, stderr: "Authentication cancelled. Retry when ready." }),
            ),
          ),
        ),
        get hasSecrets() {
          return operation.secrets.length > 0
        },
        get cancelled() {
          return operation.cancelled
        },
        close() {
          for (const [id, item] of pending)
            if (item.token === token) {
              pending.delete(id)
              item.socket.end("null\n")
            }
          operations.delete(token)
          operation.secrets.length = 0
          notify(cwd)
        },
      }
    },
    answer(cwd: string, id: string, answer: string | null) {
      const item = pending.get(id)
      if (item === undefined || operations.get(item.token)?.cwd !== cwd) return false
      const operation = operations.get(item.token)!
      if (answer !== null && answer !== "") operation.secrets.push(answer)
      if (answer === null) {
        operation.cancelled = true
        Deferred.doneUnsafe(operation.cancellation, Exit.void)
      }
      pending.delete(id)
      item.socket.end(`${JSON.stringify(answer)}\n`)
      notify(cwd)
      return true
    },
    prompts: (cwd: string) =>
      Stream.callback<ReadonlyArray<CredentialPrompt>>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const listener = (prompts: ReadonlyArray<CredentialPrompt>) => {
              Queue.offerUnsafe(queue, prompts)
            }
            const set = listeners.get(cwd) ?? new Set()
            listeners.set(cwd, set)
            set.add(listener)
            listener(snapshot(cwd))
            return listener
          }),
          (listener) =>
            Effect.sync(() => {
              const set = listeners.get(cwd)
              set?.delete(listener)
              if (set?.size === 0) {
                listeners.delete(cwd)
                for (const [id, item] of pending)
                  if (operations.get(item.token)?.cwd === cwd) {
                    pending.delete(id)
                    item.socket.end("null\n")
                    const operation = operations.get(item.token)
                    if (operation) {
                      operation.cancelled = true
                      Deferred.doneUnsafe(operation.cancellation, Exit.void)
                    }
                  }
              }
            }),
        ),
      ),
    close() {
      for (const socket of sockets) socket.destroy()
      pending.clear()
      operations.clear()
      listeners.clear()
      server.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
