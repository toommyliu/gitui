import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { createContext, type ReactNode, useCallback, useContext, useId, useState } from "react"

export interface PromptField<F extends string> {
  readonly key: F
  readonly label: string
  readonly initial?: string
  readonly placeholder?: string | ((values: Readonly<Record<F, string>>) => string)
  readonly optional?: boolean
  readonly multiline?: boolean
  readonly choices?: ReadonlyArray<{ readonly value: string; readonly label: string }>
}

export interface PromptOption<O extends string> {
  readonly key: O
  readonly label: string
  readonly description?: string
  readonly initial?: boolean
}

export interface PromptRequest<F extends string, O extends string = never> {
  readonly title: string
  readonly description?: ReactNode
  readonly fields: ReadonlyArray<PromptField<F>>
  readonly options?: ReadonlyArray<PromptOption<O>>
  readonly submitLabel: string
  readonly onSubmit: (values: Readonly<Record<F, string>>, options: Readonly<Record<O, boolean>>) => Promise<boolean>
}

type AnyRequest = PromptRequest<string, string>

const PromptContext = createContext<(request: AnyRequest) => void>(() => {})

export const usePrompt = (): (<F extends string, O extends string = never>(request: PromptRequest<F, O>) => void) =>
  useContext(PromptContext) as never

export function PromptProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ readonly id: number; readonly request: AnyRequest } | null>(null)
  const prompt = useCallback(
    (next: AnyRequest) => setRequest((current) => ({ id: (current?.id ?? 0) + 1, request: next })),
    [],
  )
  return (
    <PromptContext value={prompt}>
      {children}
      <Dialog open={request !== null} onOpenChange={(open) => open || setRequest(null)}>
        <DialogContent className="sm:max-w-md">
          {request !== null && (
            <PromptForm
              key={request.id}
              request={request.request}
              onDone={() => setRequest((current) => (current === request ? null : current))}
            />
          )}
        </DialogContent>
      </Dialog>
    </PromptContext>
  )
}

function PromptForm({ request, onDone }: { request: AnyRequest; onDone: () => void }) {
  const id = useId()
  const [values, setValues] = useState(() =>
    Object.fromEntries(request.fields.map((field) => [field.key, field.initial ?? ""])),
  )
  const [options, setOptions] = useState(() =>
    Object.fromEntries((request.options ?? []).map((option) => [option.key, option.initial ?? false])),
  )
  const cleaned = Object.fromEntries(
    request.fields.map((field) => [field.key, field.multiline ? values[field.key]! : values[field.key]!.trim()]),
  )
  const [submitted, setSubmitted] = useState(false)
  const invalidFields = request.fields.filter((field) => !field.optional && cleaned[field.key]!.trim() === "")
  const [busy, setBusy] = useState(false)

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        setSubmitted(true)
        const firstInvalid = invalidFields[0]
        if (firstInvalid !== undefined) {
          const control = event.currentTarget.elements.namedItem(firstInvalid.key)
          if (control instanceof HTMLElement) control.focus()
          return
        }
        setBusy(true)
        void request.onSubmit(cleaned, options).then((ok) => (ok ? onDone() : setBusy(false)))
      }}
    >
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
        {request.description !== undefined && (
          <DialogDescription render={<div />}>{request.description}</DialogDescription>
        )}
      </DialogHeader>
      <FieldGroup className="gap-3">
        {request.fields.map((field, index) => {
          const fieldId = `${id}-${field.key}`
          const invalid = submitted && invalidFields.includes(field)
          const errorId = invalid ? `${fieldId}-error` : undefined
          const placeholder = typeof field.placeholder === "function" ? field.placeholder(cleaned) : field.placeholder
          const set = (value: string) => setValues((current) => ({ ...current, [field.key]: value }))
          return (
            <Field key={field.key} data-invalid={invalid}>
              <FieldLabel htmlFor={fieldId}>
                {field.label}
                {field.optional && <span className="font-normal text-muted-foreground">optional</span>}
              </FieldLabel>
              {field.choices !== undefined ? (
                <select
                  id={fieldId}
                  name={field.key}
                  autoFocus={index === 0}
                  required={!field.optional}
                  aria-invalid={invalid}
                  aria-describedby={errorId}
                  value={values[field.key]}
                  onChange={(event) => set(event.target.value)}
                  className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20"
                >
                  {field.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              ) : field.multiline ? (
                <Textarea
                  id={fieldId}
                  name={field.key}
                  aria-invalid={invalid}
                  aria-describedby={errorId}
                  autoFocus={index === 0}
                  value={values[field.key]}
                  placeholder={placeholder}
                  onChange={(event) => set(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                      event.currentTarget.form?.requestSubmit()
                  }}
                  rows={3}
                  required={!field.optional}
                  className="min-h-0 resize-none font-mono text-xs"
                />
              ) : (
                <Input
                  id={fieldId}
                  name={field.key}
                  aria-invalid={invalid}
                  aria-describedby={errorId}
                  autoFocus={index === 0}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  required={!field.optional}
                  value={values[field.key]}
                  placeholder={placeholder}
                  onChange={(event) => set(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  className="font-mono"
                />
              )}
              {invalid && <FieldError id={errorId}>{field.label} is required.</FieldError>}
            </Field>
          )
        })}
        {request.options?.map((option) => {
          const optionId = `${id}-${option.key}`
          const descriptionId = option.description === undefined ? undefined : `${optionId}-description`
          const label = (
            <FieldLabel htmlFor={optionId} className="font-normal">
              {option.label}
            </FieldLabel>
          )
          return (
            <Field key={option.key} orientation="horizontal">
              <Checkbox
                id={optionId}
                aria-describedby={descriptionId}
                checked={options[option.key]}
                onCheckedChange={(checked) => setOptions((current) => ({ ...current, [option.key]: checked }))}
              />
              {descriptionId === undefined ? (
                label
              ) : (
                <FieldContent>
                  {label}
                  <FieldDescription id={descriptionId}>{option.description}</FieldDescription>
                </FieldContent>
              )}
            </Field>
          )
        })}
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner data-icon="inline-start" />}
          {request.submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
