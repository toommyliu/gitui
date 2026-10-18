import { request } from "node:http"
import { expect, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as HttpServer from "effect/http/HttpServer"
import * as NetAddress from "effect/net/NetAddress"
import { serverLayer } from "./server.ts"

const upgradeStatus = (port: number, origin: string | undefined) =>
  Effect.callback<number>((resume) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: "/rpc",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...(origin === undefined ? {} : { Origin: origin }),
      },
    })
    req.on("upgrade", (_response, socket) => {
      socket.destroy()
      resume(Effect.succeed(101))
    })
    req.on("response", (response) => {
      response.resume()
      resume(Effect.succeed(response.statusCode ?? 0))
    })
    req.on("error", (error) => resume(Effect.die(error)))
    req.end()
  })

const options = { host: "127.0.0.1", port: 0, webDist: "/nonexistent", trustedOrigins: ["gitui://app"] }

layer(serverLayer(options))("server", (it) => {
  it.effect("opens the rpc socket only for its own origin, a trusted origin or a non-browser client", () =>
    Effect.gen(function* () {
      const { address } = yield* HttpServer.HttpServer
      const port = NetAddress.isInetAddress(address) ? address.port : -1

      expect(yield* upgradeStatus(port, "https://evil.example")).toBe(403)
      expect(yield* upgradeStatus(port, "http://localhost:5173")).toBe(403)
      expect(yield* upgradeStatus(port, "null")).toBe(403)
      expect(yield* upgradeStatus(port, `http://127.0.0.1:${port}`)).toBe(101)
      expect(yield* upgradeStatus(port, "gitui://app")).toBe(101)
      expect(yield* upgradeStatus(port, undefined)).toBe(101)
    }),
  )
})
