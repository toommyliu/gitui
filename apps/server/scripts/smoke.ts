import { NodeRuntime, NodeSocket } from "@effect/platform-node"
import { GitRpcs } from "@gitui/contracts"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"

const url = process.argv[2] ?? "ws://127.0.0.1:4600/rpc"
const path = process.argv[3] ?? process.cwd()

const program = Effect.gen(function* () {
  const client = yield* RpcClient.make(GitRpcs)
  const listing = yield* client.ListDirectory({ path: "~" })
  yield* Console.log(
    `home folders: ${listing.entries.length} (${listing.entries
      .slice(0, 5)
      .map((entry) => entry.name)
      .join(", ")})`,
  )
  const info = yield* client.OpenRepo({ path })
  yield* Console.log("open:", info)
  const status = yield* client.GetStatus({ repo: info.id })
  yield* Console.log("head:", status.head, "entries:", status.entries.length)
  const refs = yield* client.GetRefs({ repo: info.id })
  yield* Console.log(
    "branches:",
    refs.branches.map((b) => b.name),
    "worktrees:",
    refs.worktrees.length,
  )
  const log = yield* client.OpenLog({ repo: info.id, query: "" })
  const rows = yield* client.GetLogPage({ repo: info.id, logId: log.logId, start: 0, count: 3 })
  yield* Console.log(
    "log total:",
    log.total,
    rows.map((r) => r.subject),
  )
  const detail = yield* client.GetCommit({ repo: info.id, oid: rows[0]!.oid })
  const file = detail.files[0]!
  const diff = yield* client.GetDiff({
    repo: info.id,
    target: { _tag: "Commit", oid: detail.oid },
    path: file.path,
    from: file.from,
  })
  yield* Console.log("diff:", file.path, diff._tag, diff._tag === "Patch" ? diff.patch.length : "")
  const events = yield* client
    .WatchRepo({ repo: info.id })
    .pipe(Stream.take(1), Stream.runCollect, Effect.timeout("3 seconds"), Effect.option)
  yield* Console.log("watch event within 3s:", events)
}).pipe(Effect.scoped)

program.pipe(
  Effect.provide(
    RpcClient.layerProtocolSocket().pipe(Layer.provide([NodeSocket.layerWebSocket(url), RpcSerialization.layerJson])),
  ),
  NodeRuntime.runMain,
)
