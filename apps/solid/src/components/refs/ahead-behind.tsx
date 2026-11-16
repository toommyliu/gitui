import type { Upstream } from "@gitui/contracts"
import { Match, Show, Switch } from "solid-js"
import { ArrowDownSmall, ArrowUpSmall } from "../icons"

export function AheadBehind(props: { upstream: Upstream }) {
  return (
    <Switch>
      <Match when={props.upstream._tag === "Gone"}>
        <span class="text-2xs text-destructive">gone</span>
      </Match>
      <Match when={props.upstream._tag === "Tracking" ? props.upstream : undefined}>
        {(tracking) => (
          <span class="inline-flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground tabular-nums">
            <Show when={tracking().ahead > 0}>
              <span class="inline-flex items-center gap-0.5">
                <ArrowUpSmall />
                {tracking().ahead}
              </span>
            </Show>
            <Show when={tracking().behind > 0}>
              <span class="inline-flex items-center gap-0.5">
                <ArrowDownSmall />
                {tracking().behind}
              </span>
            </Show>
          </span>
        )}
      </Match>
    </Switch>
  )
}
