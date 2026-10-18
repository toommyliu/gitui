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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
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
}

export interface PromptOption<O extends string> {
  readonly key: O
  readonly label: string
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
              onDone={() => setRequest((current) => (current?.id === request.id ? null : current))}
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
  const valid = request.fields.every((field) => field.optional || cleaned[field.key]!.trim() !== "")
  const [busy, setBusy] = useState(false)

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid || busy) return
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
          const placeholder = typeof field.placeholder === "function" ? field.placeholder(cleaned) : field.placeholder
          const set = (value: string) => setValues((current) => ({ ...current, [field.key]: value }))
          return (
            <Field key={field.key}>
              <FieldLabel htmlFor={fieldId}>
                {field.label}
                {field.optional && <span className="font-normal text-muted-foreground">optional</span>}
              </FieldLabel>
              {field.multiline ? (
                <Textarea
                  id={fieldId}
                  autoFocus={index === 0}
                  value={values[field.key]}
                  placeholder={placeholder}
                  onChange={(event) => set(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                      event.currentTarget.form?.requestSubmit()
                  }}
                  rows={3}
                  className="min-h-0 resize-none font-mono text-xs"
                />
              ) : (
                <Input
                  id={fieldId}
                  autoFocus={index === 0}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={values[field.key]}
                  placeholder={placeholder}
                  onChange={(event) => set(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  className="font-mono"
                />
              )}
            </Field>
          )
        })}
        {request.options?.map((option) => {
          const optionId = `${id}-${option.key}`
          return (
            <Field key={option.key} orientation="horizontal">
              <Checkbox
                id={optionId}
                checked={options[option.key]}
                onCheckedChange={(checked) => setOptions((current) => ({ ...current, [option.key]: checked }))}
              />
              <FieldLabel htmlFor={optionId} className="font-normal">
                {option.label}
              </FieldLabel>
            </Field>
          )
        })}
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={!valid || busy}>
          {busy && <Spinner data-icon="inline-start" />}
          {request.submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
