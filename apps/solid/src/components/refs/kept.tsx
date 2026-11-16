import { createSignal, For, Show } from "solid-js"
import { ChevronRight } from "../icons"

export interface Kept {
  readonly name: string
  readonly reason: string
}

export function KeptList(props: { entries: ReadonlyArray<Kept>; why: string }) {
  const [open, setOpen] = createSignal(false)
  const count = () => (props.entries.length === 1 ? "1 branch" : `${props.entries.length} branches`)
  return (
    <Show when={props.entries.length > 0}>
      <div class="flex flex-col gap-1">
        <button
          type="button"
          aria-expanded={open() ? "true" : "false"}
          onClick={() => setOpen(!open())}
          class="-mx-1 flex items-start gap-1 rounded px-1 py-0.5 text-start text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <span class={["mt-px flex shrink-0 transition-transform", open() && "rotate-90"]}>
            <ChevronRight class="size-3.5" />
          </span>
          <span>
            {count()} won't be deleted {props.why}
          </span>
        </button>
        <Show when={open()}>
          <ul class="max-h-32 divide-y overflow-y-auto overscroll-none rounded-md border text-xs">
            <For each={props.entries}>
              {(entry) => (
                <li class="flex min-w-0 items-center gap-3 px-2 py-1">
                  <span class="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
                  <span class="max-w-[50%] shrink-0 truncate text-2xs text-muted-foreground">{entry.reason}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  )
}
