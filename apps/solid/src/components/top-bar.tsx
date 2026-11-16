import { Portal } from "@solidjs/web"
import type { JSX } from "@solidjs/web"
import { createSignal, Show } from "solid-js"

const [slot, setSlot] = createSignal<HTMLElement>()

export const TopBarSlot = () => <div ref={setSlot} class="flex h-full min-w-0 flex-1 items-center gap-2 pe-2" />

export function TopBar(props: { children: JSX.Element }) {
  return <Show when={slot()}>{(mount) => <Portal mount={mount()}>{props.children}</Portal>}</Show>
}
