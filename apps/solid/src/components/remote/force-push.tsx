import { createSignal } from "solid-js"
import { shortOid } from "@/lib/format"
import type { Repo } from "@/lib/repo"
import { Confirm } from "../refs/confirm"
import type { ForcePush } from "./push"

export function ForcePushConfirm(props: { repo: Repo; target: ForcePush | null; onClose: () => void }) {
  const [pending, setPending] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const close = () => {
    setError(null)
    props.onClose()
  }

  const description = () => {
    const current = props.target
    if (current === null) return ""
    const { target, destination, expected } = current
    return `This replaces ${target} with your local ${destination.branch}, dropping any commits on ${target} that ${destination.branch} doesn't have. The push stops if ${target} no longer points at ${shortOid(expected)}, so nothing pushed since your last fetch is lost.`
  }

  const push = async () => {
    const current = props.target
    if (current === null) return
    setPending(true)
    setError(null)
    const outcome = await props.repo.stream("push", (git) =>
      git.ForcePush({ repo: props.repo.id, destination: current.destination, expected: current.expected }),
    )
    setPending(false)
    if (outcome.ok) close()
    else setError(outcome.message)
  }

  return (
    <Confirm
      open={props.target !== null}
      onOpenChange={(open) => !open && !pending() && close()}
      title={`Force push ${props.target?.destination.branch ?? ""}?`}
      description={description()}
      error={error()}
      confirmLabel="Force push"
      pending={pending()}
      onConfirm={() => void push()}
    />
  )
}
