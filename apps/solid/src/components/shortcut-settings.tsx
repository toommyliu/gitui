import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import {
  chordOf,
  type CommandId,
  configurableIds,
  commands,
  commandsUsing,
  formatChord,
  isChord,
  isCustomized,
  keysOf,
  resetAllKeys,
  setKeys,
} from "@/lib/hotkeys"
import { Plus, Refresh } from "./icons"
import { Button, Tip } from "./ui"

const groups: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["General", ["palette", "settings", "theme", "view", "log"]],
  ["Repositories", ["repo", "rail"]],
  ["Lists", ["list"]],
  ["History", ["history", "commit"]],
  ["Changes", ["files", "lines"]],
  ["Diffs", ["diff"]],
]

const groupOf = (id: CommandId) => {
  const prefix = id.slice(0, id.indexOf("."))
  return groups.find(([, prefixes]) => prefixes.includes(prefix))?.[0] ?? "Other"
}

const modifierKeys = new Set(["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn"])

type Slot = number | "new"

interface Recording {
  readonly id: CommandId
  readonly slot: Slot
}

function Recorder(props: {
  onKey: (event: KeyboardEvent) => void
  onPointer: (event: PointerEvent) => void
  adding: boolean
}) {
  const onKey = (event: KeyboardEvent) => props.onKey(event)
  const onPointer = (event: PointerEvent) => props.onPointer(event)
  window.addEventListener("keydown", onKey, true)
  window.addEventListener("pointerdown", onPointer, true)
  onCleanup(() => {
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("pointerdown", onPointer, true)
  })
  return (
    <p class="text-end text-2xs text-muted-foreground">
      {props.adding
        ? "Press the shortcut to add. Esc cancels."
        : "Press the new shortcut. Delete removes it, Esc cancels."}
    </p>
  )
}

const chip =
  "inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 text-2xs tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring"

function ShortcutRow(props: {
  id: CommandId
  recording: Slot | null
  onRecord: (recording: Recording | null) => void
}) {
  const [notice, setNotice] = createSignal<string | null>(null)
  const keys = () => keysOf(props.id)
  const name = () => commands[props.id].name

  const stop = () => props.onRecord(null)
  const plain = (event: KeyboardEvent) => !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
  const onKey = (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const slot = props.recording
    if (slot === null || modifierKeys.has(event.key)) return
    if (event.key === "Escape" && plain(event)) return stop()
    if ((event.key === "Delete" || event.key === "Backspace") && plain(event) && slot !== "new") {
      setKeys(
        props.id,
        keys().filter((_, index) => index !== slot),
      )
      setNotice(null)
      return stop()
    }
    const chord = chordOf(event)
    if (!isChord(chord)) {
      setNotice(`${event.key} can't be used in a shortcut.`)
      return
    }
    const others = commandsUsing(chord).filter((other) => other !== props.id)
    const next = slot === "new" ? [...keys(), chord] : keys().map((key, index) => (index === slot ? chord : key))
    setKeys(
      props.id,
      next.filter((key, index) => next.indexOf(key) === index),
    )
    setNotice(
      others.length === 0
        ? null
        : `Also used by ${others.map((other) => commands[other].name).join(", ")}. Each runs only where it applies.`,
    )
    stop()
  }
  const onPointer = (event: PointerEvent) => {
    if (!(event.target instanceof Element) || event.target.closest("[data-recording]") === null) stop()
  }
  const toggle = (slot: Slot) => props.onRecord(props.recording === slot ? null : { id: props.id, slot })

  return (
    <div class="flex flex-col gap-0.5 py-1.5">
      <div class="flex min-w-0 items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs">{name()}</span>
        <Show when={isCustomized(props.id)}>
          <Tip
            label={
              commands[props.id].keys.length === 0
                ? "Reset to no shortcut"
                : `Reset to ${commands[props.id].keys.map(formatChord).join(", ")}`
            }
          >
            {(trigger) => (
              <Button
                {...trigger}
                variant="ghost"
                aria-label={`Reset ${name()} to its default shortcut`}
                class="w-6 justify-center px-0"
                onClick={() => {
                  setKeys(props.id, null)
                  setNotice(null)
                }}
              >
                <Refresh />
              </Button>
            )}
          </Tip>
        </Show>
        <For each={keys()}>
          {(chord, index) => (
            <button
              type="button"
              data-recording={props.recording === index() ? "" : undefined}
              aria-label={`Change ${formatChord(chord)} for ${name()}`}
              onClick={() => toggle(index())}
              class={[
                chip,
                props.recording === index()
                  ? "bg-selection text-selection-foreground"
                  : "bg-muted text-foreground hover:bg-muted-foreground/20",
              ]}
            >
              {props.recording === index() ? "Press keys" : formatChord(chord)}
            </button>
          )}
        </For>
        <Show
          when={props.recording === "new"}
          fallback={
            <Tip label="Add a shortcut">
              {(trigger) => (
                <button
                  {...trigger}
                  type="button"
                  aria-label={`Add a shortcut for ${name()}`}
                  onClick={() => toggle("new")}
                  class={[chip, "min-w-6 px-0 text-muted-foreground hover:bg-muted hover:text-foreground"]}
                >
                  <Plus />
                </button>
              )}
            </Tip>
          }
        >
          <span data-recording class={[chip, "bg-selection text-selection-foreground"]}>
            Press keys
          </span>
        </Show>
      </div>
      <Show when={props.recording !== null}>
        <Recorder onKey={onKey} onPointer={onPointer} adding={props.recording === "new"} />
      </Show>
      <Show when={notice()}>{(text) => <p class="text-end text-2xs text-change-modified">{text()}</p>}</Show>
    </div>
  )
}

export const matchingShortcuts = (query: string) => {
  const needle = query.trim().toLowerCase()
  return needle === ""
    ? configurableIds
    : configurableIds.filter(
        (id) =>
          commands[id].name.toLowerCase().includes(needle) ||
          keysOf(id).some((chord) => formatChord(chord).toLowerCase().includes(needle)),
      )
}

export function ShortcutSettings(props: { query: string }) {
  const [recording, setRecording] = createSignal<Recording | null>(null)
  const grouped = createMemo(() => {
    const visible = matchingShortcuts(props.query)
    return [...groups.map(([name]) => name), "Other"]
      .map((name) => [name, visible.filter((id) => groupOf(id) === name)] as const)
      .filter(([, ids]) => ids.length > 0)
  })
  const customized = () => configurableIds.some(isCustomized)

  return (
    <div class="flex flex-col">
      <Show when={props.query === "" && customized()}>
        <div class="flex justify-end pt-2">
          <Button variant="ghost" onClick={resetAllKeys}>
            Reset all shortcuts
          </Button>
        </div>
      </Show>
      <For each={grouped()}>
        {([name, ids]) => (
          <div class="flex flex-col">
            <h4 class="pt-2 text-2xs font-medium text-muted-foreground">{name}</h4>
            <div class="flex flex-col divide-y">
              <For each={ids}>
                {(id) => (
                  <ShortcutRow
                    id={id}
                    recording={recording()?.id === id ? (recording()?.slot ?? null) : null}
                    onRecord={setRecording}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}
