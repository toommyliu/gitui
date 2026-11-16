import type { JSX } from "@solidjs/web"
import { createResizableController, Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/solid/resizable"
import { children, createEffect, createSignal, onSettled, Show } from "solid-js"

export function Split(props: {
  id: string
  listLabel: string
  collapsed: boolean
  list: JSX.Element
  children: JSX.Element
}) {
  const list = children(() => props.list)
  const main = children(() => props.children)
  const controller = createResizableController()
  const [attached, setAttached] = createSignal(false)
  onSettled(() => {
    setAttached(true)
  })
  createEffect(
    () => [props.collapsed, attached()] as const,
    ([collapsed, ready]) => {
      if (!ready) return
      if (collapsed) controller.collapse(0)
      else controller.expand(0)
    },
  )
  return (
    <Show when={attached()} fallback={<div class="h-full" />}>
      <Resizable autoSaveId={`gitui.split.${props.id}`} controller={controller} class="flex h-full min-h-0">
        <ResizablePanel
          id={`${props.id}-list`}
          defaultSize={24}
          minSize="240px"
          maxSize="50%"
          collapsible
          class="flex min-h-0 flex-col overflow-hidden p-0"
        >
          {list()}
        </ResizablePanel>
        <ResizableHandle
          aria-label={`Resize ${props.listLabel}`}
          class="w-px shrink-0 bg-border hover:bg-ring focus-visible:bg-ring data-collapsed:hidden"
        />
        <ResizablePanel id={`${props.id}-main`} class="flex min-h-0 min-w-0 flex-col overflow-hidden p-0">
          {main()}
        </ResizablePanel>
      </Resizable>
    </Show>
  )
}
