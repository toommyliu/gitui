import type { JSX } from "@solidjs/web"
import { Field, FieldError, FieldLabel } from "@ui-sdk/solid/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui-sdk/solid/select"
import { For, Show } from "solid-js"
import { ChevronDown } from "../icons"
import { Alert, Button, type Failure } from "../ui"
import { Spinner } from "../state"

export interface Option<T extends string> {
  readonly value: T
  readonly label: string
  readonly detail?: string | undefined
}

export function FormField(props: {
  label: string
  source?: string | undefined
  error?: string | null | undefined
  children: JSX.Element
}) {
  return (
    <Field invalid={Boolean(props.error)}>
      <div class="flex items-baseline justify-between gap-2">
        <FieldLabel>{props.label}</FieldLabel>
        <Show when={props.source}>{(source) => <span class="text-2xs text-muted-foreground">{source()}</span>}</Show>
      </div>
      {props.children}
      <Show when={props.error}>
        {(error) => (
          <FieldError match class="text-2xs text-destructive">
            {error()}
          </FieldError>
        )}
      </Show>
    </Field>
  )
}

export function SelectField<T extends string>(props: {
  label: string
  source?: string | undefined
  error?: string | null | undefined
  value: T | null
  options: ReadonlyArray<Option<T>>
  placeholder?: string | undefined
  onChange: (value: T) => void
}) {
  return (
    <FormField label={props.label} source={props.source} error={props.error}>
      <Select<T>
        value={props.value}
        placeholder={props.placeholder ?? ""}
        onValueChange={(next) => next !== null && props.onChange(next)}
        itemToLabel={(value) => props.options.find((option) => option.value === value)?.label ?? value}
      >
        <SelectTrigger
          class={[
            "flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-md border bg-background px-2 text-xs hover:bg-muted data-open:bg-muted",
            props.error ? "border-destructive" : "border-input",
          ]}
        >
          <SelectValue class="truncate data-placeholder:text-muted-foreground" />
          <ChevronDown />
        </SelectTrigger>
        <SelectContent
          side="bottom"
          align="start"
          sideOffset={4}
          class="max-h-[min(20rem,var(--available-height))] w-(--anchor-width) overflow-y-auto overscroll-none"
        >
          <For each={props.options}>
            {(option) => (
              <SelectItem value={option.value} class="data-selected:font-medium">
                <span class="shrink-0">{option.label}</span>
                <Show when={option.detail}>
                  {(detail) => <span class="min-w-0 truncate font-normal text-muted-foreground">{detail()}</span>}
                </Show>
              </SelectItem>
            )}
          </For>
        </SelectContent>
      </Select>
    </FormField>
  )
}

export function FailureAlert(props: { failure: Failure | null; onDismiss: () => void }) {
  return (
    <Show when={props.failure}>
      {(failure) => (
        <Alert tone="error" title={failure().title} onDismiss={props.onDismiss} class="pe-7">
          <span class="whitespace-pre-line">{failure().message}</span>
        </Alert>
      )}
    </Show>
  )
}

export function Actions(props: {
  pending: boolean
  submitLabel: string
  variant?: "primary" | "destructive" | undefined
  onCancel: () => void
  cancelLabel?: string | undefined
  children?: JSX.Element
}) {
  return (
    <div class="flex items-center gap-1.5">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">{props.children}</div>
      <Button type="button" disabled={props.pending} onClick={() => props.onCancel()}>
        {props.cancelLabel ?? "Cancel"}
      </Button>
      <Button type="submit" variant={props.variant ?? "primary"} disabled={props.pending}>
        <Show when={props.pending}>
          <Spinner />
        </Show>
        {props.submitLabel}
      </Button>
    </div>
  )
}
