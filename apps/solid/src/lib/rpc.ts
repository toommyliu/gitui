import * as BrowserSocket from "@effect/platform-browser/BrowserSocket"
import { GitError, GitRpcs } from "@gitui/contracts"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { createSignal } from "solid-js"
import { desktop } from "./desktop"

export type Connection = "connecting" | "connected" | "disconnected"

const [connection, setConnection] = createSignal<Connection>("connecting")
export { connection }

const socketUrl = desktop?.rpcUrl ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`

const makeClient = RpcClient.make(GitRpcs)

export type Client = Effect.Success<typeof makeClient>

class Git extends Context.Service<Git, Client>()("Git") {}

const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: true, pingTimeout: "15 seconds" }).pipe(
  Layer.provide([
    BrowserSocket.layerWebSocket(socketUrl),
    RpcSerialization.layerJson,
    Layer.succeed(RpcClient.ConnectionHooks)({
      onConnect: Effect.sync(() => setConnection("connected")),
      onDisconnect: Effect.sync(() => setConnection("disconnected")),
    }),
  ]),
)

const runtime = ManagedRuntime.make(Layer.effect(Git, makeClient).pipe(Layer.provide(protocol)))

export const describeError = (error: unknown) =>
  error instanceof GitError ? error.summary : error instanceof Error ? error.message : String(error)

export const call = async <A, E>(request: (git: Client) => Effect.Effect<A, E>): Promise<A> => {
  const exit = await runtime.runPromiseExit(Effect.flatMap(Git, request))
  if (Exit.isSuccess(exit)) return exit.value
  throw Cause.squash(exit.cause)
}

export const subscribe = <A, E>(
  request: (git: Client) => Stream.Stream<A, E>,
  onValue: (value: A) => void,
  onError?: (error: unknown) => void,
): (() => void) => {
  const fiber = runtime.runFork(
    Effect.flatMap(Git, (git) => Stream.runForEach(request(git), (value) => Effect.sync(() => onValue(value)))).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          if (!Cause.hasInterruptsOnly(cause)) onError?.(Cause.squash(cause))
        }),
      ),
    ),
  )
  return () => {
    runtime.runFork(Fiber.interrupt(fiber))
  }
}

export const collect = async <A, E>(request: (git: Client) => Stream.Stream<A, E>, onValue?: (value: A) => void) => {
  const exit = await runtime.runPromiseExit(
    Effect.flatMap(Git, (git) => Stream.runForEach(request(git), (value) => Effect.sync(() => onValue?.(value)))),
  )
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
}
