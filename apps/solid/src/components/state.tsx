import type { JSX } from "@solidjs/web"
import { Errored, Loading, Show } from "solid-js"
import { describeError } from "@/lib/rpc"
import { Alert, Button } from "./ui"

export function Spinner() {
  return (
    <span
      role="status"
      aria-label="Loading"
      class="inline-block size-3.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground"
    />
  )
}

export function Centered(props: { children: JSX.Element }) {
  return (
    <div class="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      {props.children}
    </div>
  )
}

export function Failure(props: { error: unknown; title?: string | undefined; onRetry?: () => void }) {
  return (
    <Centered>
      <Alert tone="error" title={props.title ?? "Something went wrong"} class="w-full max-w-md text-start">
        {describeError(props.error)}
      </Alert>
      <Show when={props.onRetry}>
        {(retry) => (
          <Button class="mt-1" onClick={retry()}>
            Try again
          </Button>
        )}
      </Show>
    </Centered>
  )
}

export function Boundary(props: {
  children: JSX.Element
  label?: string | undefined
  title?: string | undefined
  on?: unknown
  failure?: ((error: unknown, reset: () => void) => JSX.Element) | undefined
}) {
  return (
    <Errored
      fallback={(error, reset) =>
        props.failure?.(error(), reset) ?? <Failure error={error()} title={props.title} onRetry={reset} />
      }
    >
      <Loading
        on={props.on}
        fallback={
          <Centered>
            <Spinner />
            {props.label !== undefined && <span class="text-xs">{props.label}</span>}
          </Centered>
        }
      >
        {props.children}
      </Loading>
    </Errored>
  )
}
