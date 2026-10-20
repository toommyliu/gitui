import { writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { NodeRuntime, NodeSocket } from "@effect/platform-node"
import { type CommandEntry, GitRpcs, type RepoId } from "@gitui/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { serverLayer } from "../src/server.ts"
import { isolateGitConfig, makeFixture } from "./fixture.ts"
import type { Sample } from "./report.ts"
import { type Client, refresh, type Scenario, scenarios, type TrialError } from "./scenarios.ts"

const QUIET_MS = 300

const { values: options } = parseArgs({
  options: {
    only: { type: "string" },
    trials: { type: "string", default: "1" },
    ballast: { type: "string", default: "30000" },
    out: { type: "string" },
  },
})

const connect = Effect.gen(function* () {
  const server = yield* Layer.build(serverLayer({ host: "127.0.0.1", port: 0, webDist: null, trustedOrigins: [] }))
  const { address } = Context.get(server, HttpServer.HttpServer)
  if (address._tag === "UnixPathAddress") return yield* Effect.die("the bench server must listen on TCP")
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide([NodeSocket.layerWebSocket(`ws://127.0.0.1:${address.port}/rpc`), RpcSerialization.layerJson]),
    ),
  )
  return yield* RpcClient.make(GitRpcs).pipe(Effect.provide(protocol))
})

const drainUntilQuiet = (events: Queue.Queue<number>) =>
  Effect.gen(function* () {
    let drained = 0
    while (Option.isSome(yield* Effect.timeoutOption(Queue.take(events), QUIET_MS))) drained++
    return drained
  })

const measure = Effect.fnUntraced(function* (
  client: Client,
  repo: RepoId,
  scenario: Scenario,
  trial: ReturnType<Scenario["setup"]>,
  events: Queue.Queue<number>,
  log: ReadonlyArray<CommandEntry>,
) {
  yield* drainUntilQuiet(events)
  const wall0 = Date.now()
  const t0 = performance.now()
  const op = yield* Effect.forkChild(Effect.exit(trial.run(client)))
  let background: Fiber.Fiber<unknown, TrialError> | undefined
  let seen = 0
  let exit: Exit.Exit<unknown, TrialError> | undefined
  while (exit === undefined) {
    const next = yield* Effect.raceFirst(Fiber.join(op), Effect.as(Queue.take(events), "event" as const))
    if (next === "event") {
      seen++
      if (!scenario.mutates) continue
      if (background !== undefined) yield* Fiber.interrupt(background)
      background = yield* Effect.forkChild(refresh(client, repo))
    } else {
      exit = next
    }
  }
  const t1 = performance.now()
  if (background !== undefined) yield* Fiber.interrupt(background)
  if (Exit.isFailure(exit)) return yield* Effect.die(new Error(`${scenario.name} failed`, { cause: exit.cause }))
  let restarts = 0
  if (scenario.mutates) {
    while (
      (yield* Effect.raceFirst(Effect.as(refresh(client, repo), "done" as const), Queue.take(events))) !== "done"
    ) {
      seen++
      restarts++
    }
  }
  const t2 = performance.now()
  seen += yield* drainUntilQuiet(events)
  trial.verify?.()
  const wall1 = wall0 + (t1 - t0)
  const wall2 = wall0 + (t2 - t0)
  return {
    scenario: scenario.name,
    rpcMs: t1 - t0,
    settledMs: scenario.mutates ? t2 - t0 : null,
    restarts,
    events: seen,
    commands: log
      .filter((entry) => entry.startedAt >= wall0)
      .map((entry) => ({
        args: entry.args.slice(entry.prefixLength).join(" ").slice(0, 160),
        atMs: entry.startedAt - wall0,
        ms: entry.durationMs,
        phase: entry.startedAt < wall1 ? "op" : entry.startedAt < wall2 ? "refresh" : "after",
      })),
  } satisfies Sample
})

const round = Effect.gen(function* () {
  isolateGitConfig()
  const only = options.only?.split(",")
  const selected = scenarios.filter((scenario) => only === undefined || only.includes(scenario.name))
  if (selected.length === 0) return yield* Effect.die(`no scenario matches --only ${options.only}`)
  const fx = makeFixture(Number(options.ballast))
  yield* Effect.addFinalizer(() => Effect.sync(fx.dispose))
  const client = yield* connect
  const events = yield* Queue.unbounded<number>()
  const log: Array<CommandEntry> = []
  yield* Effect.forkScoped(
    Stream.runForEach(client.WatchRepo({ repo: fx.root }), () => Queue.offer(events, Date.now())),
  )
  yield* Effect.forkScoped(
    Stream.runForEach(client.CommandLog({ repo: fx.root }), (batch) => Effect.sync(() => log.push(...batch))),
  )
  yield* refresh(client, fx.root)
  yield* refresh(client, fx.root)
  const samples: Array<Sample> = []
  let n = 0
  for (const scenario of selected) {
    for (let i = 0; i < Number(options.trials); i++) {
      const sample = yield* measure(client, fx.root, scenario, scenario.setup(fx, n++), events, log)
      process.stderr.write(
        `  ${scenario.name.padEnd(28)} rpc ${sample.rpcMs.toFixed(1).padStart(7)}ms` +
          (sample.settledMs === null ? "" : `  settled ${sample.settledMs.toFixed(1).padStart(7)}ms`) +
          "\n",
      )
      samples.push(sample)
    }
  }
  if (options.out !== undefined) writeFileSync(options.out, JSON.stringify(samples))
}).pipe(Effect.scoped)

NodeRuntime.runMain(round.pipe(Effect.andThen(Effect.sync(() => process.exit(0)))))
