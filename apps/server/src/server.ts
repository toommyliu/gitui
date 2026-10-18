import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import { GitRpcs } from "@gitui/contracts"
import { CommandLog, Repo } from "@gitui/git"
import * as Layer from "effect/Layer"
import * as HttpMiddleware from "effect/http/HttpMiddleware"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpStaticServer from "effect/http/HttpStaticServer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import { handlers } from "./handlers.ts"

export interface ServerOptions {
  readonly host: string
  readonly port: number
  readonly repoRoots: ReadonlyArray<string>
  readonly webDist: string
}

export const serverLayer = (options: ServerOptions) => {
  const rpc = RpcServer.layerHttp({ group: GitRpcs, path: "/rpc", protocol: "websocket" }).pipe(
    Layer.provide(handlers(options.repoRoots)),
    Layer.provide(Repo.layer),
    Layer.provide(CommandLog.layer),
    Layer.provide(RpcSerialization.layerJson),
  )
  const assets = existsSync(options.webDist)
    ? HttpStaticServer.layer({ root: options.webDist, spa: true, cacheControl: "no-cache" })
    : Layer.empty
  const compression = HttpRouter.middleware(HttpMiddleware.compression(), { global: true })
  return HttpRouter.serve(Layer.mergeAll(rpc, assets, compression)).pipe(
    Layer.provide(
      NodeHttpServer.layer(createServer, {
        port: options.port,
        host: options.host,
        websocket: { perMessageDeflate: true },
      }),
    ),
  )
}
