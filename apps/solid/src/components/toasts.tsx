import type { ToastType } from "@ui-sdk/core/toast"
import { Toast, ToastAction, ToastDescription, ToastRegion, ToastTitle } from "@ui-sdk/solid/toast"
import { Show } from "solid-js"
import { toast } from "@/lib/toast"
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "./icons"
import { buttonClass } from "./ui"

const glyphs: Partial<Record<ToastType, { readonly Glyph: typeof CircleCheck; readonly class: string }>> = {
  success: { Glyph: CircleCheck, class: "text-change-added" },
  error: { Glyph: CircleAlert, class: "text-destructive" },
  warning: { Glyph: TriangleAlert, class: "text-change-modified" },
  info: { Glyph: Info, class: "text-primary" },
}

export function Toasts() {
  return (
    <ToastRegion toaster={toast} side="bottom" align="end" maxVisible={Number.MAX_SAFE_INTEGER}>
      {(item) => (
        <Toast>
          <div data-toast-heading>
            <Show when={item.type === undefined ? undefined : glyphs[item.type]}>
              {(glyph) => (
                <span data-toast-icon class={glyph().class}>
                  {glyph().Glyph()}
                </span>
              )}
            </Show>
            <ToastTitle />
          </div>
          <ToastAction class={buttonClass()} />
          <ToastDescription />
        </Toast>
      )}
    </ToastRegion>
  )
}
