import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { NodeSocket } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { GitRpcs, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { makeRepo } from "../../../packages/git/src/testRepo.ts"
import { serverLayer } from "./server.ts"

layer(serverLayer({ host: "127.0.0.1", port: 0, webDist: null, trustedOrigins: [] }))(
  "File investigation RPC",
  (it) => {
    it.effect("investigates and restores through the real socket while retaining staged content", () =>
      Effect.gen(function* () {
        const { address } = yield* HttpServer.HttpServer
        if (address._tag === "UnixPathAddress") return yield* Effect.die("Expected TCP")
        const protocol = yield* Layer.build(
          RpcClient.layerProtocolSocket().pipe(
            Layer.provide([
              NodeSocket.layerWebSocket(`ws://127.0.0.1:${address.port}/rpc`),
              RpcSerialization.layerJson,
            ]),
          ),
        )
        const client = yield* RpcClient.make(GitRpcs).pipe(Effect.provide(protocol))
        const f = yield* Effect.acquireRelease(Effect.sync(makeRepo), (f) =>
          Effect.sync(() => rmSync(f.root, { recursive: true, force: true })),
        )
        f.write("old.txt", "original\n")
        f.git("add", ".")
        const first = f.commit("Create")
        f.git("mv", "old.txt", "new.txt")
        f.commit("Rename")
        f.write("new.txt", "staged\n")
        f.git("add", ".")
        f.write("new.txt", "local\n")
        const { id: repo } = yield* client.OpenRepo({ path: f.root }),
          path = RepoPath.make("new.txt")
        expect(yield* client.GetTrackedFiles({ repo })).toEqual(["new.txt"])
        const history = yield* client.GetFileHistory({ repo, revision: "HEAD", path })
        expect(history.entries.map((e) => e.path)).toEqual(["new.txt", "old.txt"])
        const old = history.entries[1]!,
          source = { revision: old.oid, path: old.path }
        expect((yield* client.GetFileRevision({ repo, ...source })).content).toEqual({
          _tag: "Text",
          content: "original\n",
        })
        const blame = yield* client.GetFileBlame({ repo, revision: history.revision, path })
        expect(blame._tag).toBe("Lines")
        if (blame._tag === "Lines")
          expect((yield* client.GetCommit({ repo, oid: blame.lines[0]!.oid })).oid).toBe(first)
        const preview = yield* client.PreviewFileRestore({ repo, source, destination: path })
        expect(preview.overwrite).toBe(true)
        const request = { repo, source, destination: path, expectedVersion: preview.version, overwrite: false }
        expect((yield* Effect.result(client.RestoreFile(request)))._tag).toBe("Failure")
        yield* client.RestoreFile({ ...request, overwrite: true })
        expect(readFileSync(join(f.root, path), "utf8")).toBe("original\n")
        expect(f.git("show", ":new.txt")).toBe("staged")
        const backup = yield* client.Discard({ repo, paths: [path] })
        expect(readFileSync(join(f.root, path), "utf8")).toBe("staged\n")
        expect(yield* client.RestoreDiscard({ repo, id: backup!.id, overwriteVersion: null })).toEqual({
          _tag: "Restored",
        })
        expect(readFileSync(join(f.root, path), "utf8")).toBe("original\n")
        const updates = yield* Stream.runCollect(
          client.Commit({ repo, message: "Commit staged version", amend: false }),
        )
        expect(updates.at(-1)).toEqual({ _tag: "Committed", oid: f.git("rev-parse", "HEAD") })
        expect(f.git("show", "HEAD:new.txt")).toBe("staged")
        expect(readFileSync(join(f.root, path), "utf8")).toBe("original\n")
      }).pipe(Effect.scoped),
    )
  },
)
