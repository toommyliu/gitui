import { type CommandOutcome, GitError, type Progress } from "@gitui/contracts"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/process/ChildProcess"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import { CommandLog } from "./command-log.ts"
import { ProgressSplitter, parseProgress } from "./progress.ts"

const repositoryRoutingVars = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
]

const gitEnv = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const name of repositoryRoutingVars) delete env[name]
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
    LC_ALL: "C",
  }
}

const baseArgs = ["--no-pager", "-c", "core.quotePath=false", "-c", "color.ui=never", "-c", "log.showSignature=false"]

export interface RunOptions {
  readonly stdin?: Uint8Array
  readonly okExitCodes?: ReadonlyArray<number>
  readonly write?: boolean
  readonly patternPathspecs?: boolean
  readonly env?: Readonly<Record<string, string>>
}

// `git stash push --include-untracked` cleans up through pathspec magic; with
// --literal-pathspecs it stashes untracked files but leaves them on disk.
const globalArgs = (options: RunOptions | undefined) =>
  options?.patternPathspecs === true ? baseArgs : [...baseArgs, "--literal-pathspecs"]

const MAX_LOGGED_STDERR = 8 * 1024

const command = (cwd: string, args: ReadonlyArray<string>, options: RunOptions | undefined) =>
  ChildProcess.make("git", [...globalArgs(options), ...args], {
    cwd,
    env: { ...gitEnv(), ...options?.env },
    extendEnv: false,
    stdin: options?.stdin === undefined ? "ignore" : Stream.make(options.stdin),
  })

const decoder = new TextDecoder()

export const nulList = (items: ReadonlyArray<string>) =>
  new TextEncoder().encode(items.map((item) => `${item}\0`).join(""))

export class Git extends Context.Service<
  Git,
  {
    run(cwd: string, args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<Uint8Array, GitError>
    text(cwd: string, args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<string, GitError>
    stream(cwd: string, args: ReadonlyArray<string>): Stream.Stream<Uint8Array, GitError>
    progress(cwd: string, args: ReadonlyArray<string>, options?: RunOptions): Stream.Stream<Progress, GitError>
  }
>()("@gitui/git/Git") {
  static readonly layer = Layer.effect(
    Git,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const log = yield* CommandLog
      const spawnError = (args: ReadonlyArray<string>) => (cause: unknown) =>
        new GitError({ args: [...args], exitCode: -1, stderr: String(cause) })

      const recorder = Effect.fnUntraced(function* (
        cwd: string,
        args: ReadonlyArray<string>,
        options: RunOptions | undefined,
      ) {
        const prefix = globalArgs(options)
        const startedAt = yield* Clock.currentTimeMillis
        return (outcome: CommandOutcome, stderr: string) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            log.record({
              cwd,
              args: [...prefix, ...args],
              prefixLength: prefix.length,
              kind: options?.write === true ? "write" : "read",
              startedAt,
              durationMs: now - startedAt,
              outcome,
              stderr: stderr.slice(0, MAX_LOGGED_STDERR),
            }),
          )
      })

      const run = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>, options?: RunOptions) {
        const finish = yield* recorder(cwd, args, options)
        const { stdout, stderr, exitCode } = yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(command(cwd, args, options))
            const [stdout, stderr, exitCode] = yield* Effect.all(
              [Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr), handle.exitCode],
              { concurrency: "unbounded" },
            )
            return { stdout, stderr: decoder.decode(stderr).trim(), exitCode }
          }),
        ).pipe(
          Effect.catchTag("PlatformError", (cause) =>
            Effect.andThen(
              finish({ _tag: "SpawnFailed", message: String(cause) }, ""),
              Effect.fail(spawnError(args)(cause)),
            ),
          ),
        )
        const accepted = exitCode === 0 || (options?.okExitCodes ?? []).includes(exitCode)
        yield* finish({ _tag: "Exited", code: exitCode, accepted }, stderr)
        if (!accepted) {
          return yield* new GitError({ args: [...args], exitCode, stderr })
        }
        return stdout
      })

      return Git.of({
        run,
        text: (cwd, args, options) => Effect.map(run(cwd, args, options), (bytes) => decoder.decode(bytes)),
        stream: (cwd, args) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const finish = yield* recorder(cwd, args, undefined)
              const handle = yield* spawner.spawn(command(cwd, args, undefined))
              const stderr = yield* Effect.forkScoped(Stream.mkUint8Array(handle.stderr))
              const exited = Effect.gen(function* () {
                const exitCode = yield* handle.exitCode
                const message = decoder.decode(yield* Fiber.join(stderr)).trim()
                yield* finish({ _tag: "Exited", code: exitCode, accepted: exitCode === 0 }, message)
                if (exitCode !== 0) return yield* new GitError({ args: [...args], exitCode, stderr: message })
              })
              return handle.stdout.pipe(
                Stream.concat(Stream.drain(Stream.fromEffect(exited))),
                Stream.onExit((exit) => (Exit.hasInterrupts(exit) ? finish({ _tag: "Streamed" }, "") : Effect.void)),
              )
            }),
          ).pipe(Stream.mapError((error) => (error instanceof GitError ? error : spawnError(args)(error)))),
        progress: (cwd, args, options) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const writeOptions = { ...options, write: true }
              const finish = yield* recorder(cwd, args, writeOptions)
              const handle = yield* spawner.spawn(command(cwd, args, writeOptions))
              const splitter = new ProgressSplitter()
              const lines = handle.stderr.pipe(
                Stream.decodeText(),
                Stream.mapAccum(
                  () => undefined,
                  (state, text) => [state, splitter.push(text)] as const,
                  { onHalt: () => splitter.flush() },
                ),
              )
              const exited = Effect.gen(function* () {
                const exitCode = yield* handle.exitCode
                yield* finish({ _tag: "Exited", code: exitCode, accepted: exitCode === 0 }, splitter.transcript)
                if (exitCode !== 0) {
                  return yield* new GitError({ args: [...args], exitCode, stderr: splitter.transcript })
                }
              })
              return Stream.merge(lines, Stream.drain(handle.stdout)).pipe(
                Stream.concat(Stream.drain(Stream.fromEffect(exited))),
                Stream.map(parseProgress),
                Stream.onExit((exit) =>
                  Exit.hasInterrupts(exit) ? finish({ _tag: "Cancelled" }, splitter.transcript) : Effect.void,
                ),
              )
            }),
          ).pipe(Stream.mapError((error) => (error instanceof GitError ? error : spawnError(args)(error)))),
      })
    }),
  )
}
