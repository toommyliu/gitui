import { NodeRuntime } from "@effect/platform-node"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as HttpServer from "effect/http/HttpServer"
import * as NetAddress from "effect/net/NetAddress"
import { serverLayer } from "@gitui/server/server"
import { BackendConfig } from "./protocol.ts"

// git and its hooks inherit this environment; left set, any Electron app a hook launches would start as plain Node.
Reflect.deleteProperty(process.env, "ELECTRON_RUN_AS_NODE")

process.on("disconnect", () => process.exit(0))

process.once("message", (message) => {
  const config = Schema.decodeUnknownSync(BackendConfig)(message)
  const reportPort = Layer.effectDiscard(
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer
      if (NetAddress.isInetAddress(address)) process.send?.({ port: address.port })
    }),
  )
  reportPort.pipe(
    Layer.provideMerge(
      serverLayer({
        host: "127.0.0.1",
        port: 0,
        webDist: null,
        trustedOrigins: [config.appOrigin],
      }),
    ),
    Layer.launch,
    NodeRuntime.runMain,
  )
})
