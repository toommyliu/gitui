import { rmSync } from "node:fs"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { CommandLog } from "./command-log.ts"
import { Git } from "./git.ts"
import { makeRepo } from "./testRepo.ts"

layer(Git.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Git askpass", (it) => {
  it.effect(
    "lets Git request username/password with terminal prompting disabled and returns only redacted credentials",
    () =>
      Effect.gen(function* () {
        const fixture = yield* Effect.acquireRelease(Effect.sync(makeRepo), (f) =>
          Effect.sync(() => rmSync(f.root, { recursive: true, force: true })),
        )
        const git = yield* Git
        const ready = yield* Deferred.make<void>()
        const messages: Array<boolean> = []
        const listener = yield* Effect.forkScoped(
          Stream.runForEach(git.prompts(fixture.root), (prompts) =>
            Effect.sync(() => {
              Deferred.doneUnsafe(ready, Exit.void)
              for (const prompt of prompts) {
                messages.push(prompt.secret)
                git.answerPrompt(fixture.root, prompt.id, prompt.secret ? "fake-password" : "fake-username")
              }
            }),
          ),
        )
        yield* Deferred.await(ready)
        const result = yield* git.text(fixture.root, ["-c", "credential.helper=", "credential", "fill"], {
          stdin: new TextEncoder().encode("protocol=https\nhost=fake.invalid\n\n"),
        })
        expect(messages).toEqual([false, true])
        expect(result).toContain("username=[redacted]")
        expect(result).toContain("password=[redacted]")
        expect(result).not.toContain("fake-password")
        yield* Fiber.interrupt(listener)
      }).pipe(Effect.scoped),
  )
})
