import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteLabel,
  AutocompleteList,
} from "@ui-sdk/solid/autocomplete"
import { fuzzyScore } from "@ui-sdk/solid/text-match"
import { createMemo, createSignal, For } from "solid-js"
import type { RefOption } from "@/lib/comparison"

const LIMIT = 50

export function RefInput(props: {
  label: string
  value: string
  options: ReadonlyArray<RefOption>
  onValueChange: (value: string) => void
  autofocus?: boolean | undefined
  placeholder?: string | undefined
}) {
  const [query, setQuery] = createSignal("")
  let selecting = false
  const shown = createMemo(() => {
    const needle = query().trim()
    if (needle === "") return props.options.slice(0, LIMIT)
    return props.options
      .map((option) => ({ option, score: fuzzyScore(option.label, needle) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT)
      .map(({ option }) => option)
  })

  return (
    <Autocomplete
      value={props.value}
      onValueChange={(value) => {
        props.onValueChange(value)
        setQuery(value)
      }}
      filter={false}
      openOnFocus
      autoHighlight
    >
      <AutocompleteLabel class="section-label">{props.label}</AutocompleteLabel>
      <AutocompleteInput
        autofocus={props.autofocus}
        spellcheck={false}
        autocomplete="off"
        placeholder={props.placeholder ?? "Branch, tag or commit SHA"}
        class="h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-ring"
        onFocus={(event: FocusEvent) => {
          setQuery("")
          selecting = true
          if (event.currentTarget instanceof HTMLInputElement) event.currentTarget.select()
        }}
        onMouseUp={(event: MouseEvent) => {
          if (!selecting) return
          selecting = false
          event.preventDefault()
        }}
        onBlur={() => {
          selecting = false
        }}
      />
      <AutocompleteContent
        sideOffset={4}
        class="z-50 max-h-[min(16rem,var(--available-height))] w-(--anchor-width) overflow-y-auto overscroll-none rounded-lg border bg-popover p-1 text-xs text-popover-foreground shadow-[0_8px_24px_-8px_rgb(0_0_0/0.35)] outline-none"
      >
        <AutocompleteEmpty class="hidden px-2 py-1.5 text-muted-foreground data-empty:block">
          No matching refs. A commit SHA works too.
        </AutocompleteEmpty>
        <AutocompleteList>
          <For each={shown()} keyed={(option) => option.ref}>
            {(option) => (
              <AutocompleteItem
                value={option().label}
                label={option().label}
                class="group/row flex h-6 items-center gap-2 rounded px-2 data-highlighted:bg-selection data-highlighted:text-selection-foreground"
              >
                <span class="min-w-0 flex-1 truncate font-mono">{option().label}</span>
                <span class="shrink-0 text-2xs text-muted-foreground">{option().kind}</span>
              </AutocompleteItem>
            )}
          </For>
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  )
}
