import type { CommandEntry } from "@gitui/contracts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"

export const COMMAND_LOG_CAPACITY = 2000

export class CommandLog extends Context.Service<
  CommandLog,
  {
    record(entry: Omit<CommandEntry, "id">): Effect.Effect<void>
    readonly entries: Stream.Stream<ReadonlyArray<CommandEntry>>
  }
>()("@gitui/git/CommandLog") {
  static readonly layer = Layer.effect(
    CommandLog,
    Effect.gen(function* () {
      const buffer: Array<CommandEntry> = []
      const pubsub = yield* PubSub.unbounded<CommandEntry>()
      let nextId = 1

      const record = (entry: Omit<CommandEntry, "id">) => {
        const full = { ...entry, id: nextId++ }
        buffer.push(full)
        if (buffer.length > COMMAND_LOG_CAPACITY) buffer.splice(0, buffer.length - COMMAND_LOG_CAPACITY)
        return Effect.asVoid(PubSub.publish(pubsub, full))
      }

      const entries = Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(pubsub)
          const snapshot = buffer.slice()
          const lastId = snapshot.at(-1)?.id ?? 0
          const live = Stream.fromSubscription(subscription).pipe(
            Stream.filter((entry) => entry.id > lastId),
            Stream.groupedWithin(200, "100 millis"),
          )
          return Stream.concat(Stream.make(snapshot), live)
        }),
      )

      return CommandLog.of({ record, entries })
    }),
  )
}
