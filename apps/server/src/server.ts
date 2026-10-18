import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import { GitRpcs } from "@gitui/contracts"
import { CommandLog, Repo } from "@gitui/git"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpMiddleware from "effect/http/HttpMiddleware"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as HttpStaticServer from "effect/http/HttpStaticServer"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import { handlers } from "./handlers.ts"

export interface ServerOptions {
  readonly host: string
  readonly port: number
  readonly repoRoots: ReadonlyArray<string>
  readonly webDist: string | null
  readonly trustedOrigins: ReadonlyArray<string>
}

const allowedOrigin = (origin: string, host: string | undefined, trusted: ReadonlyArray<string>) => {
  if (trusted.includes(origin)) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

const rejectForeignOrigins = (trusted: ReadonlyArray<string>) =>
  HttpRouter.middleware(
    HttpMiddleware.make((app) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const origin = request.headers["origin"]
        if (origin === undefined || allowedOrigin(origin, request.headers["host"], trusted)) return yield* app
        return HttpServerResponse.text("Requests from this origin are not allowed.", { status: 403 })
      }),
    ),
    { global: true },
  )

export const serverLayer = (options: ServerOptions) => {
  const rpc = RpcServer.layerHttp({ group: GitRpcs, path: "/rpc", protocol: "websocket" }).pipe(
    Layer.provide(handlers(options.repoRoots)),
    Layer.provide(Repo.layer),
    Layer.provide(CommandLog.layer),
    Layer.provide(RpcSerialization.layerJson),
  )
  const assets =
    options.webDist !== null && existsSync(options.webDist)
      ? HttpStaticServer.layer({ root: options.webDist, spa: true, cacheControl: "no-cache" })
      : Layer.empty
  const compression = HttpRouter.middleware(HttpMiddleware.compression(), { global: true })
  return HttpRouter.serve(Layer.mergeAll(rpc, assets, compression, rejectForeignOrigins(options.trustedOrigins))).pipe(
    Layer.provideMerge(
      NodeHttpServer.layer(createServer, {
        port: options.port,
        host: options.host,
        websocket: { perMessageDeflate: true },
      }),
    ),
  )
}
