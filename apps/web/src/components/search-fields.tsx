import type { Hotkey } from "@tanstack/react-hotkeys"
import { ChevronDownIcon, ChevronUpIcon, ListFilterIcon, SearchIcon, XIcon } from "lucide-react"
import { type RefObject, useRef } from "react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { cn } from "cn"
import { Shortcut } from "./shortcut"

const barField =
  "h-8 shrink-0 rounded-none border-0 bg-transparent ring-inset has-[[data-slot=input-group-control]:focus-visible]:border-border has-[[data-slot=input-group-control]:focus-visible]:ring-ring dark:bg-transparent"

const plainText = { autoComplete: "off", autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const

export function FileFilter({
  value,
  onChange,
  shown,
  total,
}: {
  value: string
  onChange: (value: string) => void
  shown: number
  total: number
}) {
  const input = useRef<HTMLInputElement>(null)
  const filtering = value.trim() !== ""
  return (
    <InputGroup className={cn(barField, "border-b border-border")}>
      <InputGroupAddon>
        <ListFilterIcon />
      </InputGroupAddon>
      <InputGroupInput
        ref={input}
        {...plainText}
        aria-label="Filter files by path"
        placeholder="Filter files by path"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || value === "") return
          event.preventDefault()
          event.stopPropagation()
          onChange("")
        }}
      />
      <span role="status" className="sr-only">
        {filtering ? `${shown} of ${total} files match` : ""}
      </span>
      {filtering && (
        <InputGroupAddon align="inline-end">
          <InputGroupText aria-hidden className="tabular-nums">
            {shown} of {total}
          </InputGroupText>
          <InputGroupButton
            size="xs"
            onClick={() => {
              onChange("")
              input.current?.focus()
            }}
          >
            Clear
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

const matchStatus = (count: number, current: number | null) =>
  count === 0
    ? "No matches"
    : current === null
      ? `${count.toLocaleString()} ${count === 1 ? "match" : "matches"}`
      : `${(current + 1).toLocaleString()} of ${count.toLocaleString()}`

export interface FindResults {
  readonly count: number
  readonly current: number | null
}

export function FindField({
  inputRef,
  query,
  onQueryChange,
  results,
  onStep,
  onClose,
  hotkey,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (query: string) => void
  results: FindResults | null
  onStep: (delta: 1 | -1) => void
  onClose: () => void
  hotkey: Hotkey | null
}) {
  const status = results === null ? null : matchStatus(results.count, results.current)
  const found = results !== null && results.count > 0
  return (
    <InputGroup className={cn(barField, "min-w-0 flex-1")}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        {...plainText}
        aria-label="Find in the diff"
        placeholder="Find in the diff"
        enterKeyHint="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === "Enter") {
            event.preventDefault()
            onStep(event.shiftKey ? -1 : 1)
          } else if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      />
      <span role="status" className="sr-only">
        {found && results.current !== null ? `Match ${status}` : status}
      </span>
      {status === null ? (
        query === "" &&
        hotkey !== null && (
          <InputGroupAddon align="inline-end" className="max-md:hidden">
            <Shortcut hotkey={hotkey} />
          </InputGroupAddon>
        )
      ) : (
        <InputGroupAddon align="inline-end" className="gap-0.5">
          <InputGroupText aria-hidden className="mr-1 tabular-nums">
            {status}
          </InputGroupText>
          <InputGroupButton
            size="icon-xs"
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            disabled={!found}
            onClick={() => onStep(-1)}
          >
            <ChevronUpIcon />
          </InputGroupButton>
          <InputGroupButton
            size="icon-xs"
            aria-label="Next match"
            title="Next match (Enter)"
            disabled={!found}
            onClick={() => onStep(1)}
          >
            <ChevronDownIcon />
          </InputGroupButton>
          <InputGroupButton size="icon-xs" aria-label="Clear find" title="Clear find (Escape)" onClick={onClose}>
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
