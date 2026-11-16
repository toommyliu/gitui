import type { ChangeScope } from "@gitui/contracts"
import type * as Effect from "effect/Effect"
import { createSignal } from "solid-js"
import { useRepo } from "@/lib/repo"
import { type Client, describeError } from "@/lib/rpc"
import type { Failure } from "../ui"

export const createRunner = () => {
  const repo = useRepo()
  const [running, setRunning] = createSignal(false)
  const [failure, setFailure] = createSignal<Failure | null>(null)
  const run = async <E>(options: {
    scopes: ReadonlyArray<ChangeScope>
    request: (git: Client) => Effect.Effect<void, E>
    failure: string
    recover?: (error: unknown) => Failure["action"]
  }) => {
    setRunning(true)
    setFailure(null)
    try {
      await repo.mutate(options.scopes, options.request)
      return true
    } catch (error) {
      setFailure({ title: options.failure, message: describeError(error), action: options.recover?.(error) })
      return false
    } finally {
      setRunning(false)
    }
  }
  return { running, run, failure, report: setFailure, dismiss: () => setFailure(null) }
}
