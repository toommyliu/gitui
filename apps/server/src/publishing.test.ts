import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeSocket } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { GitRpcs } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { makeRepo } from "../../../packages/git/src/testRepo.ts"
import { serverLayer } from "./server.ts"

layer(serverLayer({ host: "127.0.0.1", port: 0, webDist: null, trustedOrigins: [] }))("Publishing RPC", (it) => {
  it.effect("publishes to a chosen remote and refreshes configuration and refs through the real socket", () =>
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
      const tip = fixture.commit("publish")
      fixture.git("tag", "v1")
      const remotePath = mkdtempSync(join(tmpdir(), "gitui-rpc-remote-"))
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", remotePath])
      const remoteGit = (...args: string[]) =>
        execFileSync("git", ["--git-dir", remotePath, ...args], { encoding: "utf8" }).trim()
      const { id: repo } = yield* client.OpenRepo({ path: fixture.root })
      yield* client.AddRemote({ repo, remote: { name: "fork", urls: [remotePath], pushUrls: [] } })
      const context = yield* client.GetPushContext({ repo, branch: "main" })
      expect(context.remotes).toEqual([{ name: "fork", urls: [remotePath], pushUrls: [remotePath] }])
      yield* Stream.runDrain(
        client.Push({
          repo,
          destination: { branch: "main", remote: "fork", remoteBranch: "review" },
          setUpstream: true,
          expectedContext: context.fingerprint,
        }),
      )
      expect(remoteGit("rev-parse", "refs/heads/review")).toBe(tip)
      yield* client.EditRemote({ repo, name: "fork", remote: { name: "team", urls: [remotePath], pushUrls: [] } })
      const stale = yield* Stream.runDrain(
        client.Push({
          repo,
          destination: { branch: "main", remote: "team", remoteBranch: "unexpected" },
          setUpstream: false,
          expectedContext: context.fingerprint,
        }),
      ).pipe(Effect.flip)
      expect(stale).toMatchObject({ _tag: "GitError", stderr: expect.stringContaining("configuration changed") })
      expect(remoteGit("for-each-ref", "--format=%(refname)", "refs/heads")).toBe("refs/heads/review")
      expect((yield* client.GetStatus({ repo })).upstream?.name).toBe("team/review")
      yield* Stream.runDrain(
        client.Pull({ repo, strategy: "ff-only", target: { branch: "main", upstream: "refs/remotes/team/review" } }),
      )
      yield* Stream.runDrain(client.PushTags({ repo, remote: "team", tags: ["v1"] }))
      const refs = yield* client.GetRefs({ repo })
      expect(refs.remotes).toEqual([{ name: "team", urls: [remotePath], pushUrls: [] }])
      const branch = refs.remoteBranches.find((branch) => branch.name === "team/review")!
      yield* client.SetUpstream({ repo, branch: "main", upstream: null })
      expect((yield* client.GetStatus({ repo })).upstream).toBeNull()
      yield* client.DeleteRemoteTrackingBranch({ repo, name: "team/review" })
      expect((yield* client.GetRefs({ repo })).remoteBranches).toEqual([])
      expect(remoteGit("rev-parse", "refs/heads/review")).toBe(tip)
      yield* Stream.runDrain(
        client.DeleteRemoteBranch({ repo, remote: "team", branch: "review", expected: branch.oid }),
      )
      expect(remoteGit("for-each-ref", "--format=%(refname)")).toBe("refs/tags/v1")
      yield* client.RemoveRemote({ repo, name: "team" })
      expect((yield* client.GetRefs({ repo })).remotes).toEqual([])
    }).pipe(Effect.scoped),
  )
})
