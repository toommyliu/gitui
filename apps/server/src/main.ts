import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { GitRpcs } from "@gitui/contracts"
import { CommandLog, Repo } from "@gitui/git"
import * as Layer from "effect/Layer"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpStaticServer from "effect/http/HttpStaticServer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import { handlers } from "./handlers.ts"

const tailscaleIp = () => {
  try {
    return execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" }).trim().split("\n")[0] || undefined
  } catch {
    return undefined
  }
}

const host = process.env.HOST ?? tailscaleIp() ?? "127.0.0.1"
const port = Number(process.env.PORT ?? 4600)
const repoRoots = (process.env.REPO_ROOTS ?? join(homedir(), "projects")).split(":")
const webDist = resolve(import.meta.dirname, "../../web/dist")

const Rpc = RpcServer.layerHttp({ group: GitRpcs, path: "/rpc", protocol: "websocket" }).pipe(
  Layer.provide(handlers(repoRoots)),
  Layer.provide(Repo.layer),
  Layer.provide(CommandLog.layer),
  Layer.provide(RpcSerialization.layerJson),
)

const Static = existsSync(webDist) ? HttpStaticServer.layer({ root: webDist, spa: true }) : Layer.empty

HttpRouter.serve(Layer.mergeAll(Rpc, Static)).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port, host })),
  Layer.launch,
  NodeRuntime.runMain,
)
