import { GitError } from "@gitui/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/process/ChildProcess"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"

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
  return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }
}

const globalArgs = [
  "--no-pager",
  "--literal-pathspecs",
  "-c",
  "core.quotePath=false",
  "-c",
  "color.ui=never",
  "-c",
  "log.showSignature=false",
]

export interface RunOptions {
  readonly stdin?: Uint8Array
  readonly okExitCodes?: ReadonlyArray<number>
}

const command = (cwd: string, args: ReadonlyArray<string>, stdin: Uint8Array | undefined) =>
  ChildProcess.make("git", [...globalArgs, ...args], {
    cwd,
    env: gitEnv(),
    extendEnv: false,
    stdin: stdin === undefined ? "ignore" : Stream.make(stdin),
  })

const decoder = new TextDecoder()

export const nulList = (items: ReadonlyArray<string>) => new TextEncoder().encode(items.map((item) => `${item}\0`).join(""))

export class Git extends Context.Service<
  Git,
  {
    run(cwd: string, args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<Uint8Array, GitError>
    text(cwd: string, args: ReadonlyArray<string>, options?: RunOptions): Effect.Effect<string, GitError>
    stream(cwd: string, args: ReadonlyArray<string>): Stream.Stream<Uint8Array, GitError>
  }
>()("@gitui/git/Git") {
  static readonly layer = Layer.effect(
    Git,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const spawnError = (args: ReadonlyArray<string>) => (cause: unknown) =>
        new GitError({ args: [...args], exitCode: -1, stderr: String(cause) })

      const run = (cwd: string, args: ReadonlyArray<string>, options?: RunOptions) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(command(cwd, args, options?.stdin))
            const [stdout, stderr, exitCode] = yield* Effect.all(
              [Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr), handle.exitCode],
              { concurrency: "unbounded" },
            )
            if (exitCode !== 0 && !(options?.okExitCodes ?? []).includes(exitCode)) {
              return yield* new GitError({ args: [...args], exitCode, stderr: decoder.decode(stderr).trim() })
            }
            return stdout
          }),
        ).pipe(Effect.catchTag("PlatformError", (cause) => Effect.fail(spawnError(args)(cause))))

      return Git.of({
        run,
        text: (cwd, args, options) => Effect.map(run(cwd, args, options), (bytes) => decoder.decode(bytes)),
        stream: (cwd, args) =>
          spawner.spawn(command(cwd, args, undefined)).pipe(
            Effect.map((handle) => handle.stdout),
            Stream.unwrap,
            Stream.mapError(spawnError(args)),
          ),
      })
    }),
  )
}
