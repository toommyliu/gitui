import { NodeRuntime, NodeSocket } from "@effect/platform-node"
import { GitRpcs } from "@gitui/contracts"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"

const [url = "ws://127.0.0.1:4600/rpc", path = process.cwd()] = process.argv.slice(2)

const timed = <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const start = performance.now()
    const result = yield* effect
    yield* Console.log(`${label}: ${(performance.now() - start).toFixed(1)}ms`)
    return result
  })

const program = Effect.gen(function* () {
  const client = yield* RpcClient.make(GitRpcs)
  const info = yield* client.OpenRepo({ path })
  yield* timed("status", client.GetStatus({ repo: info.id }))
  yield* timed("refs", client.GetRefs({ repo: info.id }))
  const log = yield* timed("open log", client.OpenLog({ repo: info.id }))
  yield* timed("first page (200)", client.GetLogPage({ repo: info.id, logId: log.logId, start: 0, count: 200 }))
  const last = yield* timed(
    `last page of ${log.total}`,
    client.GetLogPage({ repo: info.id, logId: log.logId, start: Math.max(0, log.total - 200), count: 200 }),
  )
  yield* timed(
    "last page again (cached)",
    client.GetLogPage({ repo: info.id, logId: log.logId, start: Math.max(0, log.total - 200), count: 200 }),
  )
  const widest = Math.max(...last.map((row) => row.graph.up.length / 3))
  yield* Console.log(`rows returned: ${last.length}, widest lane count on last page: ${widest}`)
}).pipe(Effect.scoped)

program.pipe(
  Effect.provide(
    RpcClient.layerProtocolSocket().pipe(Layer.provide([NodeSocket.layerWebSocket(url), RpcSerialization.layerJson])),
  ),
  NodeRuntime.runMain,
)
