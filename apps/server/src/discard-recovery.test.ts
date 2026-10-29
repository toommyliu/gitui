import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeSocket } from "@effect/platform-node"
import { expect, it } from "@effect/vitest"
import { GitRpcs, type RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { makeRepo } from "../../../packages/git/src/testRepo.ts"
import { serverLayer } from "./server.ts"

const client = Effect.gen(function* () {
  const { address } = yield* HttpServer.HttpServer
  if (address._tag === "UnixPathAddress") return yield* Effect.die("Expected TCP")
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide([NodeSocket.layerWebSocket(`ws://127.0.0.1:${address.port}/rpc`), RpcSerialization.layerJson]),
    ),
  )
  return yield* RpcClient.make(GitRpcs).pipe(Effect.provide(protocol))
})
const freshServer = () => Layer.fresh(serverLayer({ host: "127.0.0.1", port: 0, webDist: null, trustedOrigins: [] }))
const p = (path: string) => path as RepoPath

it.live("recovers discards over RPC after restarting the server, with guarded overwrites and unchanged index", () =>
  Effect.gen(function* () {
    const f = makeRepo()
    f.write("a", "base\n")
    f.git("add", ".")
    f.commit("base")
    f.write("a", "staged\n")
    f.git("add", "a")
    f.write("a", "working\n")
    f.write("new", "untracked\n")
    const index = f.raw("ls-files", "--stage", "-z")
    const backupId = yield* Effect.gen(function* () {
      const c = yield* client
      const { id: repo } = yield* c.OpenRepo({ path: f.root })
      const backup = yield* c.Discard({ repo, paths: [p("a"), p("new")] })
      expect(readFileSync(join(f.root, "a"), "utf8")).toBe("staged\n")
      return backup!.id
    }).pipe(Effect.scoped, Effect.provide(freshServer()))

    yield* Effect.gen(function* () {
      const c = yield* client
      const { id: repo } = yield* c.OpenRepo({ path: f.root })
      expect((yield* c.GetDiscardRecovery({ repo }))[0]?.id).toBe(backupId)
      f.write("a", "newer\n")
      const conflict = yield* c.RestoreDiscard({ repo, id: backupId, overwriteVersion: null })
      expect(conflict._tag).toBe("Conflict")
      expect(readFileSync(join(f.root, "a"), "utf8")).toBe("newer\n")
      if (conflict._tag !== "Conflict") return yield* Effect.die("Expected conflict")
      expect(yield* c.RestoreDiscard({ repo, id: backupId, overwriteVersion: conflict.version })).toEqual({
        _tag: "Restored",
      })
      expect(readFileSync(join(f.root, "a"), "utf8")).toBe("working\n")
      expect(readFileSync(join(f.root, "new"), "utf8")).toBe("untracked\n")
      expect(f.raw("ls-files", "--stage", "-z")).toEqual(index)
      const lineBackup = yield* c.ApplyLines({
        repo,
        action: "discard",
        path: p("a"),
        lines: [
          { side: "old", line: 1, text: "staged" },
          { side: "new", line: 1, text: "working" },
        ],
      })
      yield* c.RestoreDiscard({ repo, id: lineBackup!.id, overwriteVersion: null })
      expect(readFileSync(join(f.root, "a"), "utf8")).toBe("working\n")
      expect(f.raw("ls-files", "--stage", "-z")).toEqual(index)
    }).pipe(Effect.scoped, Effect.provide(freshServer()))
  }),
)

it.live("refuses a discard over RPC when backup storage cannot be created", () =>
  Effect.gen(function* () {
    const f = makeRepo()
    f.write("a", "base\n")
    f.git("add", ".")
    f.commit("base")
    f.write("a", "precious\n")
    writeFileSync(join(f.root, ".git/gitui-discard-backups"), "blocked")
    const c = yield* client
    const { id: repo } = yield* c.OpenRepo({ path: f.root })
    expect((yield* Effect.result(c.Discard({ repo, paths: [p("a")] })))._tag).toBe("Failure")
    expect(readFileSync(join(f.root, "a"), "utf8")).toBe("precious\n")
  }).pipe(Effect.scoped, Effect.provide(freshServer())),
)
