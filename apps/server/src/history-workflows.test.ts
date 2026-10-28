import { NodeSocket } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { GitRpcs } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { makeRepo } from "../../../packages/git/src/testRepo.ts"
import { serverLayer } from "./server.ts"

layer(serverLayer({ host: "127.0.0.1", port: 0, webDist: null, trustedOrigins: [] }))("History workflows RPC", (it) => {
  it.effect("reviews a branch, edits its history, and recovers the original commits through the real socket", () =>
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer
      if (address._tag === "UnixPathAddress") return yield* Effect.die("Expected a TCP server")
      const protocol = yield* Layer.build(
        RpcClient.layerProtocolSocket().pipe(
          Layer.provide([NodeSocket.layerWebSocket(`ws://127.0.0.1:${address.port}/rpc`), RpcSerialization.layerJson]),
        ),
      )
      const client = yield* RpcClient.make(GitRpcs).pipe(Effect.provide(protocol))
      const fixture = makeRepo()
      fixture.write("alpha.ts", "export const alpha = 0\n")
      fixture.git("add", ".")
      fixture.commit("Base")
      fixture.git("switch", "-q", "-c", "feature")
      fixture.write("alpha.ts", "export const alpha = 1\n")
      fixture.git("add", ".")
      const first = fixture.commit("Alpha draft")
      fixture.write("beta.ts", "export const beta = 2\n")
      fixture.git("add", ".")
      const original = fixture.commit("Ship beta")
      const { id: repo } = yield* client.OpenRepo({ path: fixture.root })
      const comparison = yield* client.GetComparison({
        repo,
        comparison: { base: "main", head: "feature", mode: "merge-base" },
      })
      expect(comparison.files.map((file) => file.path)).toEqual(["alpha.ts", "beta.ts"])
      const patch = yield* client.GetDiff({
        repo,
        target: { _tag: "Comparison", base: comparison.start, head: comparison.head },
        paths: [],
        ignoreWhitespace: false,
        allowLarge: false,
      })
      expect(patch._tag).toBe("Patch")
      if (patch._tag === "Patch") expect(patch.patch).toContain("+export const beta = 2")

      const firstCommit = yield* client.GetCommit({ repo, oid: comparison.head })
      const plan = yield* client.GetRewritePlan({ repo, first: firstCommit.parents[0]! })
      expect(plan.commits.map((commit) => commit.oid)).toEqual([first, original])
      const result = yield* client.StartRewrite({
        repo,
        request: {
          branch: plan.branch,
          head: plan.head,
          first: plan.commits[0]!.oid,
          allowPublished: false,
          steps: plan.commits.map((commit, index) => ({
            oid: commit.oid,
            action: index === 0 ? "reword" : "pick",
            message: index === 0 ? "Ship alpha" : commit.message,
          })),
        },
      })
      expect(result.paused).toBe(false)
      expect(fixture.git("log", "--format=%s", "-3")).toBe("Ship beta\nShip alpha\nBase")
      expect((yield* client.GetRebaseState({ repo }))._tag).toBe("Inactive")

      const recovery = yield* client.GetRecovery({ repo })
      const saved = recovery.entries.find((entry) => entry.oid === original)
      expect(saved?.oid).toBe(original)
      yield* client.RecoverCommit({ repo, oid: comparison.head, name: "recovered/original" })
      expect(fixture.git("rev-parse", "recovered/original")).toBe(original)
      expect(
        (yield* client.GetComparison({
          repo,
          comparison: { base: "recovered/original", head: "feature", mode: "direct" },
        })).files,
      ).toEqual([])

      const undo = recovery.undo
      expect(undo._tag).toBe("Available")
      if (undo._tag !== "Available") return yield* Effect.die("Expected the rewritten commit to be undoable")
      yield* client.UndoCommit({ repo, expected: undo.oid, branch: undo.branch })
      expect(fixture.git("log", "--format=%s", "-1")).toBe("Ship alpha")
      expect(fixture.git("status", "--porcelain")).toBe("A  beta.ts")
      expect(fixture.git("show", ":beta.ts")).toBe("export const beta = 2")
      const stale = yield* Effect.result(client.UndoCommit({ repo, expected: undo.oid, branch: undo.branch }))
      expect(stale._tag).toBe("Failure")
      expect(fixture.git("log", "--format=%s", "-1")).toBe("Ship alpha")
    }).pipe(Effect.scoped),
  )
})
