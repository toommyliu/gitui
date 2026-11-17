import type { JSX } from "@solidjs/web"
import { Button as BaseButton } from "@ui-sdk/solid/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/solid/tooltip"
import { children, type ComponentProps, createSignal, For, omit, onCleanup, Show } from "solid-js"
import { Prose } from "./commit-mention"
import { Check, CircleAlert, CircleCheck, Copy, Info, Search, TriangleAlert, X } from "./icons"

export const ROW = 24

const variants = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border bg-background hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "text-destructive hover:bg-destructive/10",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
} as const

export type ButtonVariant = keyof typeof variants

type ButtonProps = Omit<ComponentProps<typeof BaseButton>, "class"> & {
  variant?: ButtonVariant | undefined
  class?: string | undefined
}

export const buttonClass = (variant: ButtonVariant = "outline") =>
  `inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:hover:bg-transparent ${variants[variant]}`

export function Button(props: ButtonProps) {
  const rest = omit(props, "variant", "class")
  return <BaseButton {...rest} class={[buttonClass(props.variant), props.class]} />
}

export function Kbd(props: { children: JSX.Element }) {
  return <kbd class="font-sans text-2xs font-normal opacity-60">{props.children}</kbd>
}

export function Count(props: { value: number; class?: string | undefined }) {
  return (
    <Show when={props.value > 0}>
      <span class={["text-2xs text-muted-foreground tabular-nums", props.class]}>{props.value}</span>
    </Show>
  )
}

export function Bar(props: { children: JSX.Element; class?: string | undefined }) {
  return (
    <div class={["flex h-8 shrink-0 items-center gap-1.5 border-b px-2 text-xs whitespace-nowrap", props.class]}>
      {props.children}
    </div>
  )
}

export function Empty(props: { title: string; children?: JSX.Element }) {
  return (
    <div class="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      <p class="text-xs font-medium">{props.title}</p>
      <Show when={props.children}>
        <div class="max-w-xs text-xs text-muted-foreground">{props.children}</div>
      </Show>
    </div>
  )
}

export function Tip(props: {
  label: JSX.Element
  keys?: string | undefined
  side?: "top" | "bottom" | "left" | "right" | undefined
  closeOnPress?: boolean | undefined
  children: (trigger: Record<string, unknown>) => JSX.Element
}) {
  return (
    <Tooltip delay={500} closeOnPress={props.closeOnPress ?? true}>
      <TooltipTrigger render={(trigger) => props.children(trigger)} />
      <TooltipContent side={props.side ?? "bottom"} sideOffset={6}>
        {props.label}
        <Show when={props.keys}>{(keys) => <span class="ms-1.5 opacity-60">{keys()}</span>}</Show>
      </TooltipContent>
    </Tooltip>
  )
}

export const createCopy = () => {
  const [copied, setCopied] = createSignal<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(text)
    clearTimeout(timer)
    timer = setTimeout(() => setCopied(null), 1500)
  }
  return { copied, copy }
}

export function CopyHash(props: { oid: string }) {
  const { copied: copiedText, copy: copyText } = createCopy()
  const copied = () => copiedText() === props.oid
  const copy = () => copyText(props.oid)
  return (
    <Tip label={copied() ? "Copied" : "Copy the full hash"} closeOnPress={false}>
      {(trigger) => (
        <BaseButton
          {...trigger}
          class={[
            "inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 font-mono text-2xs hover:bg-muted",
            copied() ? "border-change-added/50 text-change-added" : "text-foreground",
          ]}
          onClick={() => void copy()}
        >
          {props.oid.slice(0, 7)}
          {copied() ? <Check class="size-3 shrink-0" /> : <Copy />}
        </BaseButton>
      )}
    </Tip>
  )
}

const tones = {
  error: {
    box: "border-destructive/40 bg-destructive/12 [&_[data-alert-title]]:text-destructive",
    text: "text-destructive",
    Glyph: CircleAlert,
  },
  warning: {
    box: "border-change-modified/40 bg-change-modified/12 [&_[data-alert-title]]:text-change-modified",
    text: "text-change-modified",
    Glyph: TriangleAlert,
  },
  success: {
    box: "border-change-added/40 bg-change-added/12 [&_[data-alert-title]]:text-change-added",
    text: "text-change-added",
    Glyph: CircleCheck,
  },
  info: {
    box: "border-primary/40 bg-primary/12 [&_[data-alert-title]]:text-primary",
    text: "text-primary",
    Glyph: Info,
  },
} as const

function BreakAtSlashes(props: { text: string }) {
  return (
    <For each={props.text.split(/(?<=[\w.-])\//)}>
      {(part, index) => (
        <>
          <Show when={index() > 0}>
            /<wbr />
          </Show>
          <Prose text={part} />
        </>
      )}
    </For>
  )
}

export type Tone = keyof typeof tones

export function Alert(props: {
  tone: Tone
  title?: string | undefined
  children?: JSX.Element
  class?: string | undefined
  onDismiss?: (() => void) | undefined
}) {
  const body = children(() => props.children)
  const tone = () => tones[props.tone]
  return (
    <div
      role={props.tone === "error" ? "alert" : "status"}
      class={["relative flex gap-2 rounded-md border py-1.5 ps-2 pe-2.5 text-xs", tone().box, props.class]}
    >
      <span class={["flex h-4 shrink-0 items-center", tone().text]}>{tone().Glyph()}</span>
      <Show when={props.onDismiss}>
        {(dismiss) => (
          <button
            type="button"
            aria-label="Dismiss"
            class="absolute end-1.5 top-1.5 flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={() => dismiss()()}
          >
            <X />
          </button>
        )}
      </Show>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <Show when={props.title}>
          <p data-alert-title class="font-medium">
            {props.title}
          </p>
        </Show>
        <Show when={body()}>
          {(content) => {
            const text = () => {
              const value = content()
              return typeof value === "string" ? value : null
            }
            return (
              <div class="break-words text-foreground/80">
                <Show when={text()} fallback={content()}>
                  {(value) => <BreakAtSlashes text={value()} />}
                </Show>
              </div>
            )
          }}
        </Show>
      </div>
    </div>
  )
}

export interface Failure {
  readonly title: string
  readonly message: string
  readonly action?: { readonly label: string; readonly run: () => void } | undefined
}

export function Failures(props: { failure: Failure | null; onDismiss: () => void; edge?: "top" | "bottom" }) {
  return (
    <Show when={props.failure}>
      {(failure) => (
        <div class={["shrink-0 p-2", props.edge === "top" ? "border-t" : "border-b"]}>
          <Alert tone="error" title={failure().title} onDismiss={props.onDismiss} class="pe-7">
            {failure().message}
          </Alert>
          <Show when={failure().action}>
            {(action) => (
              <div class="flex justify-end pt-1.5">
                <Button variant="primary" onClick={() => action().run()}>
                  {action().label}
                </Button>
              </div>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}

export function SearchBar(props: {
  label: string
  placeholder: string
  value: string
  onInput: (value: string) => void
  onKeyDown?: ((event: KeyboardEvent) => void) | undefined
  ref?: ((element: HTMLInputElement) => void) | undefined
  children?: JSX.Element
}) {
  return (
    <div class="flex h-8 shrink-0 items-center gap-2 border-b ps-2.5 pe-1.5 text-xs focus-within:bg-muted/40">
      <span class="flex shrink-0 text-muted-foreground">
        <Search />
      </span>
      <input
        ref={props.ref}
        aria-label={props.label}
        placeholder={props.placeholder}
        spellcheck={false}
        autocomplete="off"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => props.onKeyDown?.(event)}
        class="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
      />
      <Show when={props.value !== ""}>
        <button
          type="button"
          aria-label="Clear"
          class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => props.onInput("")}
        >
          <X />
        </button>
      </Show>
      {props.children}
    </div>
  )
}
