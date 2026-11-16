import type { JSX } from "@solidjs/web"
import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/solid/dialog"
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/solid/field"
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/solid/segmented-control"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui-sdk/solid/select"
import { Switch, SwitchThumb } from "@ui-sdk/solid/switch"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/solid/tabs"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { type DiffThemeId, diffThemeIds, diffThemes } from "@/lib/diff-themes"
import { useCommand } from "@/lib/hotkeys"
import {
  backgroundFetch,
  changeColors,
  changeMarkers,
  dateStyle,
  diffStyle,
  diffTextSize,
  diffTheme,
  fileIcons,
  iconColors,
  hideTests,
  ignoreWhitespace,
  lineNumbers,
  setBackgroundFetch,
  setChangeColors,
  setChangeMarkers,
  setDateStyle,
  setDiffTextSize,
  setDiffTheme,
  setFileIcons,
  setIconColors,
  setIgnoreWhitespace,
  setLineNumbers,
  setStatusSide,
  setSubjectGuide,
  setWordDiff,
  statusSide,
  subjectGuide,
  toggleDiffStyle,
  toggleHideTests,
  toggleWrapLines,
  wordDiff,
  wrapLines,
} from "@/lib/settings"
import { preference, setPreference } from "@/lib/theme"
import { ChevronDown, X } from "./icons"
import { SearchBar } from "./ui"
import { matchingShortcuts, ShortcutSettings } from "./shortcut-settings"

function Row(props: { label: string; description?: string | undefined; children: JSX.Element }) {
  return (
    <Field class="flex-row items-center justify-between gap-6 py-2.5">
      <div class="flex min-w-0 flex-col gap-0.5">
        <FieldLabel class="text-xs font-medium text-foreground">{props.label}</FieldLabel>
        <FieldDescription class="text-2xs text-muted-foreground">{props.description}</FieldDescription>
      </div>
      {props.children}
    </Field>
  )
}

function Choice<T extends string>(props: {
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (value: T) => void
}) {
  return (
    <SegmentedControl
      value={props.value}
      onValueChange={(next: T | null) => {
        if (next !== null && next !== props.value) props.onChange(next)
      }}
    >
      <For each={props.options}>
        {(option) => <SegmentedControlItem value={option[0]}>{option[1]}</SegmentedControlItem>}
      </For>
    </SegmentedControl>
  )
}

function Toggle(props: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Switch checked={props.checked} onCheckedChange={(checked) => checked !== props.checked && props.onChange(checked)}>
      <SwitchThumb />
    </Switch>
  )
}

function CodeTheme() {
  return (
    <Select<DiffThemeId>
      value={diffTheme()}
      onValueChange={(next) => next !== null && setDiffTheme(next)}
      itemToLabel={(id) => diffThemes[id].label}
    >
      <SelectTrigger class="inline-flex h-6 w-40 shrink-0 items-center justify-between gap-1.5 rounded-md border bg-background px-2 text-xs font-medium hover:bg-muted data-open:bg-muted">
        <SelectValue class="truncate" />
        <ChevronDown />
      </SelectTrigger>
      <SelectContent
        side="bottom"
        align="end"
        sideOffset={4}
        class="max-h-[min(20rem,var(--available-height))] w-40 overflow-y-auto overscroll-none"
      >
        <For each={diffThemeIds}>
          {(id) => (
            <SelectItem value={id} class="data-selected:font-medium">
              {diffThemes[id].label}
            </SelectItem>
          )}
        </For>
      </SelectContent>
    </Select>
  )
}

const tabs = [
  ["general", "General"],
  ["appearance", "Appearance"],
  ["diffs", "Diffs"],
  ["commits", "Commits"],
  ["shortcuts", "Keyboard shortcuts"],
] as const

type Tab = (typeof tabs)[number][0]

const isTab = (value: string | null): value is Tab => tabs.some(([id]) => id === value)

interface Entry {
  readonly tab: Exclude<Tab, "shortcuts">
  readonly group?: string
  readonly label: string
  readonly description?: string
  readonly keywords: string
  readonly control: () => JSX.Element
}

const entries: ReadonlyArray<Entry> = [
  {
    tab: "appearance",
    label: "Theme",
    keywords: "appearance system light dark mode",
    control: () => (
      <Choice
        value={preference()}
        onChange={setPreference}
        options={[
          ["system", "System"],
          ["light", "Light"],
          ["dark", "Dark"],
        ]}
      />
    ),
  },
  {
    tab: "appearance",
    group: "Colors",
    label: "Code theme",
    description: "Syntax colors for code in diffs.",
    keywords: "syntax highlighting colors",
    control: () => <CodeTheme />,
  },
  {
    tab: "appearance",
    group: "Colors",
    label: "Change colors",
    description: "For added and removed lines, counts and file letters.",
    keywords: "red green blue orange color blind colorblind accessibility",
    control: () => (
      <Choice
        value={changeColors()}
        onChange={setChangeColors}
        options={[
          ["red-green", "Red/green"],
          ["blue-orange", "Blue/orange"],
        ]}
      />
    ),
  },
  {
    tab: "appearance",
    group: "File tree",
    label: "File icons",
    description: "Minimal shows one icon for every file. Complete adds icons for tools like Vite, ESLint and Docker.",
    keywords: "file tree type extension language",
    control: () => (
      <Choice
        value={fileIcons()}
        onChange={setFileIcons}
        options={[
          ["off", "Off"],
          ["minimal", "Minimal"],
          ["standard", "Standard"],
          ["complete", "Complete"],
        ]}
      />
    ),
  },
  {
    tab: "appearance",
    group: "File tree",
    label: "Color file icons",
    description: "Tints each icon by language.",
    keywords: "file tree icon colors",
    control: () => (
      <Toggle checked={iconColors() === "on"} onChange={(checked) => setIconColors(checked ? "on" : "off")} />
    ),
  },
  {
    tab: "appearance",
    group: "File tree",
    label: "Status letters",
    description: "Which side of the file name M, A, D and the other change letters sit on.",
    keywords: "file tree git status letter modified added deleted left right",
    control: () => (
      <Choice
        value={statusSide()}
        onChange={setStatusSide}
        options={[
          ["left", "Left"],
          ["right", "Right"],
        ]}
      />
    ),
  },
  {
    tab: "general",
    label: "Dates",
    description: "For commit times in lists and commit details.",
    keywords: "relative exact time ago",
    control: () => (
      <Choice
        value={dateStyle()}
        onChange={setDateStyle}
        options={[
          ["relative", "Relative"],
          ["exact", "Exact"],
        ]}
      />
    ),
  },
  {
    tab: "general",
    label: "Fetch in the background",
    description: "Keeps ahead and behind counts current for every open repository.",
    keywords: "remote auto fetch interval minutes",
    control: () => (
      <Choice
        value={backgroundFetch()}
        onChange={setBackgroundFetch}
        options={[
          ["off", "Off"],
          ["5", "5 min"],
          ["15", "15 min"],
          ["30", "30 min"],
        ]}
      />
    ),
  },
  {
    tab: "diffs",
    group: "Display",
    label: "Layout",
    keywords: "unified split side by side",
    control: () => (
      <Choice
        value={diffStyle()}
        onChange={toggleDiffStyle}
        options={[
          ["unified", "Unified"],
          ["split", "Split"],
        ]}
      />
    ),
  },
  {
    tab: "diffs",
    group: "Display",
    label: "Text size",
    keywords: "font zoom small medium large",
    control: () => (
      <Choice
        value={diffTextSize()}
        onChange={setDiffTextSize}
        options={[
          ["small", "Small"],
          ["medium", "Medium"],
          ["large", "Large"],
        ]}
      />
    ),
  },
  {
    tab: "diffs",
    group: "Display",
    label: "Line numbers",
    keywords: "gutter",
    control: () => (
      <Toggle checked={lineNumbers() === "on"} onChange={(checked) => setLineNumbers(checked ? "on" : "off")} />
    ),
  },
  {
    tab: "diffs",
    group: "Display",
    label: "Wrap lines",
    description: "Fit long lines to the pane.",
    keywords: "word wrap overflow scroll",
    control: () => <Toggle checked={wrapLines()} onChange={toggleWrapLines} />,
  },
  {
    tab: "diffs",
    group: "Marking changes",
    label: "Show changes with",
    description: "How added and removed lines are marked.",
    keywords: "signs plus minus markers indicators color",
    control: () => (
      <Choice
        value={changeMarkers()}
        onChange={setChangeMarkers}
        options={[
          ["color", "Color"],
          ["signs", "Signs"],
          ["both", "Both"],
        ]}
      />
    ),
  },
  {
    tab: "diffs",
    group: "Marking changes",
    label: "Highlight changed words",
    description: "Marks the exact part of a line that changed.",
    keywords: "word character inline intraline",
    control: () => (
      <Choice
        value={wordDiff()}
        onChange={setWordDiff}
        options={[
          ["word", "Words"],
          ["char", "Characters"],
          ["none", "Off"],
        ]}
      />
    ),
  },
  {
    tab: "diffs",
    group: "Filtering",
    label: "Ignore whitespace",
    description: "Applies to commits, stashes and comparisons, not uncommitted changes.",
    keywords: "spaces tabs indentation",
    control: () => <Toggle checked={ignoreWhitespace()} onChange={setIgnoreWhitespace} />,
  },
  {
    tab: "diffs",
    group: "Filtering",
    label: "Hide tests",
    description: "Covers fixtures, mocks and snapshots too. Changes still lists them so you can stage them.",
    keywords: "test files fixtures mocks snapshots",
    control: () => <Toggle checked={hideTests()} onChange={toggleHideTests} />,
  },
  {
    tab: "commits",
    label: "Subject length guide",
    description: "Shows a count beside the commit summary that turns red past the limit.",
    keywords: "message summary characters limit 50 72",
    control: () => (
      <Choice
        value={subjectGuide()}
        onChange={setSubjectGuide}
        options={[
          ["off", "Off"],
          ["50", "50"],
          ["72", "72"],
        ]}
      />
    ),
  },
]

function SettingGroup(props: { entries: ReadonlyArray<Entry> }) {
  const sections = () =>
    props.entries.reduce<Array<{ group: string | undefined; entries: Array<Entry> }>>((all, entry) => {
      const last = all.at(-1)
      if (last !== undefined && last.group === entry.group) last.entries.push(entry)
      else all.push({ group: entry.group, entries: [entry] })
      return all
    }, [])
  return (
    <For each={sections()}>
      {(section) => (
        <section class="flex flex-col">
          <Show when={section.group}>{(group) => <h3 class="pt-4 pb-1 section-label">{group()}</h3>}</Show>
          <Rows entries={section.entries} />
        </section>
      )}
    </For>
  )
}

const matches = (entry: Entry, needle: string) =>
  `${entry.label} ${entry.description ?? ""} ${entry.keywords}`.toLowerCase().includes(needle)

function Rows(props: { entries: ReadonlyArray<Entry> }) {
  return (
    <div class="flex flex-col divide-y">
      <For each={props.entries}>
        {(entry) => (
          <Row label={entry.label} description={entry.description}>
            {entry.control()}
          </Row>
        )}
      </For>
    </div>
  )
}

const panel = "min-h-0 flex-1 overflow-y-auto overscroll-none outline-none"

function Results(props: { query: string }) {
  const needle = () => props.query.trim().toLowerCase()
  const groups = createMemo(() =>
    tabs
      .filter(([id]) => id !== "shortcuts")
      .map(([id, label]) => [label, entries.filter((entry) => entry.tab === id && matches(entry, needle()))] as const)
      .filter(([, found]) => found.length > 0),
  )
  const shortcuts = () => matchingShortcuts(props.query).length > 0
  return (
    <div class={[panel, "px-4 pb-3"]}>
      <Show
        when={groups().length > 0 || shortcuts()}
        fallback={<p class="py-3 text-xs text-muted-foreground">No settings match “{props.query.trim()}”.</p>}
      >
        <For each={groups()}>
          {([label, found]) => (
            <section class="flex flex-col">
              <h3 class="pt-3 pb-1 section-label">{label}</h3>
              <Rows entries={found} />
            </section>
          )}
        </For>
        <Show when={shortcuts()}>
          <section class="flex flex-col">
            <h3 class="pt-3 section-label">Keyboard shortcuts</h3>
            <ShortcutSettings query={props.query} />
          </section>
        </Show>
      </Show>
    </div>
  )
}

export function Settings() {
  const [open, setOpen] = createSignal(false)
  const [tab, setTab] = createSignal<Tab>("general")
  const [query, setQuery] = createSignal("")
  let search: HTMLInputElement | undefined
  useCommand("settings.open", () => {
    setQuery("")
    setOpen(true)
  })
  const focusSearch = (event: KeyboardEvent) => {
    if (!open() || event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    if (document.querySelector("[data-recording]") !== null) return
    event.preventDefault()
    search?.focus()
  }
  window.addEventListener("keydown", focusSearch)
  onCleanup(() => window.removeEventListener("keydown", focusSearch))

  const searching = () => query().trim() !== ""

  return (
    <Dialog open={open()} onOpenChange={(next) => setOpen(next)}>
      <DialogBackdrop />
      <DialogContent class="h-[min(680px,calc(100dvh-2rem))] w-[min(860px,calc(100%-2rem))] gap-0 overflow-hidden p-0">
        <div class="flex h-9 shrink-0 items-center border-b ps-4 pe-1.5">
          <DialogTitle class="flex-1 text-xs">Settings</DialogTitle>
          <DialogClose
            aria-label="Close settings"
            class="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X />
          </DialogClose>
        </div>
        <Tabs
          value={tab()}
          onValueChange={(next) => {
            if (!isTab(next)) return
            setQuery("")
            setTab(next)
          }}
          orientation="vertical"
          class="flex min-h-0 flex-1"
        >
          <div class="flex w-48 shrink-0 flex-col border-e">
            <SearchBar
              label="Search settings"
              placeholder="Search settings"
              value={query()}
              onInput={setQuery}
              ref={(element) => (search = element)}
            />
            <TabsList aria-label="Settings sections" class="flex flex-col gap-0.5 p-1.5">
              <For each={tabs}>
                {([id, label]) => (
                  <TabsTab
                    value={id}
                    onClick={() => setQuery("")}
                    class={[
                      "flex h-7 flex-row items-center rounded-md px-2 text-start text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
                      !searching() && "data-selected:bg-muted data-selected:font-medium data-selected:text-foreground",
                    ]}
                  >
                    {label}
                  </TabsTab>
                )}
              </For>
            </TabsList>
          </div>
          <Show when={!searching()} fallback={<Results query={query()} />}>
            <For each={tabs}>
              {([id]) =>
                id === "shortcuts" ? (
                  <TabsPanel value={id} class={[panel, "px-4 pb-3"]}>
                    <ShortcutSettings query="" />
                  </TabsPanel>
                ) : (
                  <TabsPanel value={id} class={[panel, "px-4"]}>
                    <SettingGroup entries={entries.filter((entry) => entry.tab === id)} />
                  </TabsPanel>
                )
              }
            </For>
          </Show>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
