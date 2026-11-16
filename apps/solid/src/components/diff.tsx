import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  parsePatchFiles,
} from "@pierre/diffs"
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker"
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker"
import { createEffect, createMemo, createRoot, createSignal, For, onCleanup, onSettled, Show, untrack } from "solid-js"
import { type DiffLocation, diffMatches, type FindOptions, findPattern, hunkLocations } from "@/lib/change-search"
import { byLine, erase, type Painted, paint } from "@/lib/diff-find"
import { type DiffThemeId, diffThemes } from "@/lib/diff-themes"
import { shortcut, useCommand } from "@/lib/hotkeys"
import {
  changeMarkers,
  diffStyle,
  diffTextSize,
  diffTheme,
  lineNumbers,
  wordDiff,
  hideTests,
  ignoreWhitespace,
  setIgnoreWhitespace,
  toggleDiffStyle,
  toggleHideTests,
  toggleWrapLines,
  wrapLines,
} from "@/lib/settings"
import { theme } from "@/lib/theme"
import type { JSX } from "@solidjs/web"
import { ArrowDown, ArrowUp, CollapseAll, ExpandAll, Flask, Space, WrapText, X } from "./icons"
import { Toggle } from "@ui-sdk/solid/toggle"
import { Button, Kbd, Tip } from "./ui"

export type DiffItem = CodeViewDiffItem & { readonly binary: boolean; readonly path: string }

const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return h >>> 0
}

const binaryPaths = (patch: string) => {
  const paths = new Set<string>()
  for (const [, from, to] of patch.matchAll(
    /^Binary files (?:a\/(.+?)|\/dev\/null) and (?:b\/(.+)|\/dev\/null) differ$/gm,
  )) {
    const path = to ?? from
    if (path !== undefined) paths.add(path)
  }
  return paths
}

export const itemId = (section: string, path: string) => `${section}\n${path}`

export const patchItems = (section: string, patch: string): Array<DiffItem> => {
  const version = hash(patch)
  const binary = binaryPaths(patch)
  return parsePatchFiles(patch, `${section}:${version}`).flatMap((parsed) =>
    parsed.files.map((fileDiff) => ({
      id: itemId(section, fileDiff.name),
      type: "diff" as const,
      fileDiff,
      version,
      path: fileDiff.name,
      binary: binary.has(fileDiff.name),
    })),
  )
}

export const sectionOf = (id: string) => id.slice(0, id.indexOf("\n"))

const lineDiffTypes = { word: "word-alt", char: "char", none: "none" } as const

const renderOptions = (id: DiffThemeId, words: keyof typeof lineDiffTypes) => ({
  lineDiffType: lineDiffTypes[words],
  theme: { light: diffThemes[id].light, dark: diffThemes[id].dark },
})

const pool = getOrCreateWorkerPoolSingleton({
  poolOptions: {
    workerFactory: () => new DiffsWorker(),
    poolSize: Math.max(1, Math.min(4, navigator.hardwareConcurrency - 1)),
  },
  highlighterOptions: renderOptions(untrack(diffTheme), untrack(wordDiff)),
})

createRoot(() =>
  createEffect(
    () => renderOptions(diffTheme(), wordDiff()),
    (options) => void pool.setRenderOptions(options),
    { defer: true },
  ),
)

const HEADER_HEIGHT = 24
const SEPARATOR_HEIGHT = 24
const textSizes = {
  small: { fontSize: 11, lineHeight: 18 },
  medium: { fontSize: 12, lineHeight: 20 },
  large: { fontSize: 14, lineHeight: 22 },
} as const

const markers = {
  color: { diffIndicators: "bars", disableBackground: false },
  signs: { diffIndicators: "classic", disableBackground: true },
  both: { diffIndicators: "classic", disableBackground: false },
} as const

const separator = ':is([data-separator="line-info"], [data-separator="line-info-basic"])'
const quiet = "color-mix(in srgb, var(--diffs-fg) 50%, var(--diffs-bg))"

const unsafeCSS = (size: (typeof textSizes)[keyof typeof textSizes]) => `
:host {
  --diffs-light: var(--foreground);
  --diffs-dark: var(--foreground);
  --diffs-light-bg: var(--background);
  --diffs-dark-bg: var(--background);
  --diffs-font-family: var(--font-mono);
  --diffs-font-size: ${size.fontSize}px;
  --diffs-line-height: ${size.lineHeight}px;
  font-variant-ligatures: none;
  --diffs-addition-color-override: var(--diff-addition);
  --diffs-deletion-color-override: var(--diff-deletion);
  --diffs-bg-addition-emphasis-override: var(--diff-addition-emphasis);
  --diffs-bg-deletion-emphasis-override: var(--diff-deletion-emphasis);
  --diffs-fg-number-addition-override: var(--change-added);
  --diffs-fg-number-deletion-override: var(--change-deleted);
}
[data-code] {
  scrollbar-gutter: auto !important;
}
::selection {
  background: color-mix(in oklab, var(--primary) 35%, transparent);
}
* {
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar) transparent;
}
*:hover {
  scrollbar-color: var(--scrollbar-hover) transparent;
}
::highlight(gitui-find) {
  background-color: color-mix(in oklch, var(--change-modified) 35%, transparent);
}
::highlight(gitui-find-current) {
  background-color: color-mix(in oklch, var(--change-modified) 75%, transparent);
}
[data-diffs-header] {
  height: ${HEADER_HEIGHT}px !important;
  min-height: ${HEADER_HEIGHT}px !important;
  padding: 0 !important;
  border-bottom: 1px solid color-mix(in srgb, var(--diffs-fg) 10%, var(--diffs-bg));
  background: color-mix(in srgb, var(--diffs-fg) 3%, var(--diffs-bg));
}
[data-diffs-header] ::slotted(*) {
  flex: 1;
  min-width: 0;
}
[data-diffs-header][data-sticky] {
  top: -1px;
}
${separator} {
  height: ${SEPARATOR_HEIGHT}px !important;
  margin-block: 0 !important;
  --diffs-bg-separator: color-mix(in srgb, var(--diffs-bg) 97%, var(--diffs-fg));
}
${separator} [data-separator-content] {
  color: ${quiet} !important;
  font-family: var(--font-sans) !important;
  font-size: 11px !important;
}
`

const letters: Record<string, { letter: string; tone: string }> = {
  new: { letter: "A", tone: "text-change-added" },
  deleted: { letter: "D", tone: "text-change-deleted" },
  "rename-pure": { letter: "R", tone: "text-change-renamed" },
  "rename-changed": { letter: "R", tone: "text-change-renamed" },
  change: { letter: "M", tone: "text-change-modified" },
}

const span = (className: string, text: string) => {
  const element = document.createElement("span")
  element.className = className
  element.textContent = text
  return element
}

const chevron = (collapsed: boolean) => {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  icon.setAttribute("viewBox", "0 0 24 24")
  icon.setAttribute("fill", "none")
  icon.setAttribute("stroke", "currentColor")
  icon.setAttribute("stroke-width", "2")
  icon.setAttribute("stroke-linecap", "round")
  icon.setAttribute("stroke-linejoin", "round")
  icon.setAttribute("aria-hidden", "true")
  icon.setAttribute("class", collapsed ? "size-3.5 -rotate-90" : "size-3.5")
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "m6 9 6 6 6-6")
  icon.append(path)
  return icon
}

const fileHeader = (options: {
  item: DiffItem
  label: string
  collapsed: boolean
  onToggle: (all: boolean) => void
}) => {
  const { fileDiff } = options.item
  const header = document.createElement("div")
  header.className =
    "flex h-6 w-full min-w-0 cursor-default items-center gap-1.5 ps-1 pe-3 font-sans text-xs text-foreground select-none"
  header.addEventListener("click", (event) => options.onToggle(event.altKey))
  const toggle = document.createElement("button")
  toggle.type = "button"
  toggle.className = "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
  toggle.setAttribute("aria-label", options.collapsed ? `Expand ${fileDiff.name}` : `Collapse ${fileDiff.name}`)
  toggle.setAttribute("aria-expanded", String(!options.collapsed))
  toggle.append(chevron(options.collapsed))
  const kind = letters[fileDiff.type] ?? { letter: "M", tone: "text-change-modified" }
  const slash = fileDiff.name.lastIndexOf("/")
  const name = document.createElement("span")
  name.className = "min-w-0 truncate"
  name.append(span("text-muted-foreground", fileDiff.name.slice(0, slash + 1)), fileDiff.name.slice(slash + 1))
  header.append(
    toggle,
    span(`w-3 shrink-0 text-center font-mono text-2xs font-semibold ${kind.tone}`, kind.letter),
    name,
  )
  if (fileDiff.prevName !== undefined && fileDiff.prevName !== fileDiff.name)
    header.append(span("shrink-0 truncate text-2xs text-muted-foreground", `from ${fileDiff.prevName}`))
  if (options.label !== "")
    header.append(
      span("shrink-0 rounded bg-foreground/10 px-1 text-2xs font-medium text-muted-foreground", options.label),
    )
  header.append(span("flex-1", ""))
  const additions = fileDiff.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0)
  const deletions = fileDiff.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0)
  if (additions > 0) header.append(span("font-mono text-2xs text-change-added tabular-nums", `+${additions}`))
  if (deletions > 0) header.append(span("font-mono text-2xs text-change-deleted tabular-nums", `−${deletions}`))
  if (options.item.binary) header.append(span("text-2xs text-muted-foreground", "Binary"))
  return header
}

const findToggles = [
  { key: "caseSensitive", label: "Match case", glyph: "Aa" },
  { key: "wholeWord", label: "Match whole word", glyph: "ab" },
  { key: "regex", label: "Use regular expression", glyph: ".*" },
] as const satisfies ReadonlyArray<{ key: keyof FindOptions; label: string; glyph: string }>

export interface DiffHandle {
  readonly scrollToItem: (id: string) => void
  readonly step: (delta: 1 | -1) => void
  readonly allCollapsed: () => boolean
  readonly collapseAll: (collapsed: boolean) => void
}

export function DiffStack(props: {
  items: ReadonlyArray<DiffItem>
  selection?: CodeViewLineSelection | null
  onSelectionChange?: (selection: CodeViewLineSelection | null) => void
  onTopItemChange?: (id: string) => void
  headerLabel?: (id: string) => string
  ref?: (handle: DiffHandle) => void
}) {
  const options = (): CodeViewOptions<undefined, undefined> => ({
    diffStyle: diffStyle(),
    themeType: theme(),
    overflow: wrapLines() ? "wrap" : "scroll",
    ...markers[changeMarkers()],
    disableLineNumbers: lineNumbers() === "off",
    stickyHeaders: true,
    unsafeCSS: unsafeCSS(textSizes[diffTextSize()]),
    itemMetrics: {
      lineHeight: textSizes[diffTextSize()].lineHeight,
      diffHeaderHeight: HEADER_HEIGHT,
      hunkSeparatorHeight: SEPARATOR_HEIGHT,
      spacing: 0,
      paddingTop: 0,
      paddingBottom: 8,
    },
    layout: { paddingTop: 0, paddingBottom: 8, gap: 0 },
    hunkSeparators: "line-info",
    enableLineSelection: true,
    controlledSelection: props.selection !== undefined,
    onSelectedLinesChange: (selection) => props.onSelectionChange?.(selection),
    onPostRender: (node: HTMLElement, _instance: unknown, phase: string, context: { item: { id: string } }) =>
      untrack(() => {
        if (phase === "unmount") return erase(painted, node)
        paint(painted, node, byItem().get(context.item.id), current())
        node.style.userSelect = selecting !== null && selecting !== context.item.id ? "none" : ""
      }),
    renderCustomHeader: (_file: unknown, context: { item: { id: string } }) =>
      untrack(() => {
        const item = props.items.find((candidate) => candidate.id === context.item.id)
        if (item === undefined) return undefined
        return fileHeader({
          item,
          label: props.headerLabel?.(item.id) ?? "",
          collapsed: collapsed().has(item.id),
          onToggle: (all) => toggle(item.id, all),
        })
      }),
  })

  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const toggle = (id: string, all: boolean) => {
    const next = !collapsed().has(id)
    setCollapsed(
      next
        ? new Set(all ? props.items.map((item) => item.id) : [...collapsed(), id])
        : new Set(all ? [] : [...collapsed()].filter((other) => other !== id)),
    )
  }
  const shown = createMemo(() =>
    props.items.map((item) => {
      const hidden = collapsed().has(item.id) || item.fileDiff.hunks.length === 0
      return { ...item, collapsed: hidden, version: (item.version ?? 0) * 2 + (collapsed().has(item.id) ? 1 : 0) }
    }),
  )

  const view = new CodeView<undefined, undefined>(undefined, pool)
  onCleanup(() => view.cleanUp())

  let scroller: HTMLDivElement | undefined
  let quietUntil = 0
  let selecting: string | null = null

  const topItem = () => {
    if (scroller !== undefined && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
      return props.items.at(-1)?.id
    }
    const scrollTop = view.getScrollTop() + HEADER_HEIGHT
    let current: string | undefined
    for (const item of props.items) {
      const top = view.getTopForItem(item.id)
      if (top !== undefined && top <= scrollTop) current = item.id
    }
    return current ?? props.items[0]?.id
  }

  const reveal = (location: DiffLocation, align: "start" | "center") => {
    if (collapsed().has(location.id)) setCollapsed(new Set([...collapsed()].filter((id) => id !== location.id)))
    quietUntil = performance.now() + 400
    view.scrollTo({ type: "line", id: location.id, lineNumber: location.lineNumber, side: location.side, align })
  }

  const open = () => shown().filter((item) => !item.collapsed)
  const hunks = createMemo(() => hunkLocations(open()))
  let hunkCursor = -1
  const stepHunk = (delta: 1 | -1) => {
    const list = hunks()
    if (list.length === 0) return
    hunkCursor = Math.max(0, Math.min(list.length - 1, hunkCursor + delta))
    const target = list[hunkCursor]
    if (target !== undefined) reveal(target, "start")
  }

  const stepFile = (delta: 1 | -1) => {
    const current = topItem()
    const index = props.items.findIndex((item) => item.id === current)
    const target = props.items[index + delta]
    if (target === undefined) return
    quietUntil = performance.now() + 400
    view.scrollTo({ type: "item", id: target.id, align: "start" })
    props.onTopItemChange?.(target.id)
  }

  const [finding, setFinding] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [current, setCurrent] = createSignal<number | null>(null)
  const [findOptions, setFindOptions] = createSignal<FindOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  })
  const invalid = () => query() !== "" && findPattern(query(), findOptions()) === null
  const matches = createMemo(() => diffMatches(open(), query(), findOptions()))
  const byItem = createMemo(() => byLine(matches()))
  const painted: Painted = new Map()
  onCleanup(() => {
    for (const element of painted.keys()) erase(painted, element)
  })
  createEffect(
    () => [byItem(), current()] as const,
    ([lines, index]) => {
      for (const rendered of view.getRenderedItems()) paint(painted, rendered.element, lines.get(rendered.id), index)
    },
  )
  const search = (text: string) => {
    setQuery(text)
    const found = diffMatches(untrack(open), text, untrack(findOptions))
    setCurrent(found.length === 0 ? null : 0)
    const first = found[0]
    if (first !== undefined) reveal(first, "center")
  }
  const stepMatch = (delta: 1 | -1) => {
    const count = matches().length
    if (count === 0) return
    const index = current()
    const next = index === null ? (delta === 1 ? 0 : count - 1) : (index + delta + count) % count
    setCurrent(next)
    const match = matches()[next]
    if (match !== undefined) reveal(match, "center")
  }
  let findInput: HTMLInputElement | undefined
  const closeFind = () => {
    setFinding(false)
    search("")
    scroller?.focus({ preventScroll: true })
  }

  const hasItems = () => props.items.length > 0
  const inHistoryList = () =>
    document.activeElement?.closest('[aria-label="Commits"], [aria-label="Search history"]') !== null &&
    document.activeElement !== null
  useCommand("diff.nextHunk", () => stepHunk(1), hasItems)
  useCommand("diff.previousHunk", () => stepHunk(-1), hasItems)
  useCommand("diff.nextFile", () => stepFile(1), hasItems)
  useCommand("diff.previousFile", () => stepFile(-1), hasItems)
  useCommand(
    "diff.find",
    () => {
      setFinding(true)
      queueMicrotask(() => {
        findInput?.focus()
        findInput?.select()
      })
    },
    () => hasItems() && !inHistoryList(),
  )

  let rendered: ReadonlySet<string> = new Set()
  let pendingScroll: string | null = null
  const scrollToItem = (id: string) => {
    if (!rendered.has(id)) {
      pendingScroll = id
      return
    }
    pendingScroll = null
    quietUntil = performance.now() + 400
    view.scrollTo({ type: "item", id, align: "start" })
  }

  onSettled(() => {
    props.ref?.({
      scrollToItem,
      step: stepFile,
      allCollapsed: () => props.items.length > 0 && props.items.every((item) => collapsed().has(item.id)),
      collapseAll: (all) => setCollapsed(new Set(all ? props.items.map((item) => item.id) : [])),
    })
  })

  createEffect(
    () => ({ options: options(), items: shown() }),
    ({ options, items }) => {
      view.setOptions(options)
      view.setItems(items)
      view.render(true)
      hunkCursor = -1
      rendered = new Set(items.map((item) => item.id))
      if (pendingScroll !== null && rendered.has(pendingScroll)) scrollToItem(pendingScroll)
    },
  )

  createEffect(
    () => props.selection,
    (selection) => {
      if (selection !== undefined) view.setSelectedLines(selection, { notify: false })
    },
  )

  return (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <Show when={finding()}>
        <div class="absolute end-4 top-1.5 z-20 flex h-8 max-w-[calc(100%-2rem)] items-center gap-0.5 rounded-lg border bg-popover ps-2.5 pe-1 text-xs text-popover-foreground shadow-lg">
          <input
            ref={findInput}
            aria-label="Find in the diff"
            placeholder="Find"
            spellcheck={false}
            autocomplete="off"
            value={query()}
            onInput={(event) => search(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                stepMatch(event.shiftKey ? -1 : 1)
              } else if (event.key === "Escape") {
                event.preventDefault()
                closeFind()
              }
            }}
            class="h-full w-44 min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
          />
          <For each={findToggles}>
            {(toggle) => (
              <Tip label={toggle.label}>
                {(trigger) => (
                  <Toggle
                    {...trigger}
                    aria-label={toggle.label}
                    pressed={findOptions()[toggle.key]}
                    onPressedChange={(pressed) => {
                      setFindOptions({ ...findOptions(), [toggle.key]: pressed })
                      search(query())
                      findInput?.focus()
                    }}
                    class="flex h-6 min-w-6 items-center justify-center rounded px-1 font-mono text-2xs text-muted-foreground hover:bg-muted hover:text-foreground data-pressed:bg-primary/20 data-pressed:text-foreground"
                  >
                    {toggle.glyph}
                  </Toggle>
                )}
              </Tip>
            )}
          </For>
          <Show when={query() !== ""}>
            <span
              class={[
                "px-1.5 text-2xs whitespace-nowrap tabular-nums",
                invalid() ? "text-destructive" : "text-muted-foreground",
              ]}
            >
              {invalid()
                ? "Invalid pattern"
                : matches().length === 0
                  ? "No results"
                  : `${(current() ?? 0) + 1} of ${matches().length}`}
            </span>
          </Show>
          <Button
            variant="ghost"
            class="w-6 justify-center px-0"
            aria-label="Previous match"
            disabled={matches().length === 0}
            onClick={() => stepMatch(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            class="w-6 justify-center px-0"
            aria-label="Next match"
            disabled={matches().length === 0}
            onClick={() => stepMatch(1)}
          >
            <ArrowDown />
          </Button>
          <Button variant="ghost" class="w-6 justify-center px-0" aria-label="Close find" onClick={closeFind}>
            <X />
          </Button>
        </div>
      </Show>
      <div
        ref={(element) => {
          scroller = element
          view.setup(element)
          element.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return
            const path = event.composedPath()
            const target = view.getRenderedItems().find((rendered) => path.includes(rendered.element))
            if (target === undefined) return
            selecting = target.id
            for (const rendered of view.getRenderedItems())
              rendered.element.style.userSelect = rendered.id === target.id ? "" : "none"
            const release = () => {
              selecting = null
              for (const rendered of view.getRenderedItems()) rendered.element.style.userSelect = ""
            }
            window.addEventListener("pointerup", release, { once: true })
          })
          element.addEventListener("scroll", () => {
            if (performance.now() < quietUntil) return
            const id = topItem()
            if (id === undefined) return
            props.onTopItemChange?.(id)
            hunkCursor = hunks().findIndex((hunk) => hunk.id === id) - 1
          })
        }}
        tabindex={-1}
        class="min-h-0 flex-1 overflow-auto overscroll-none outline-none select-text"
      />
    </div>
  )
}

const barToggle =
  "flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-pressed:bg-muted data-pressed:text-foreground aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground"

function BarToggle(props: {
  label: string
  keys?: string | undefined
  pressed: boolean
  disabled?: boolean
  onChange: (pressed: boolean) => void
  children: JSX.Element
}) {
  return (
    <Tip label={props.label} keys={props.keys}>
      {(trigger) => (
        <Toggle
          {...trigger}
          aria-label={props.label}
          aria-disabled={props.disabled === true ? "true" : undefined}
          pressed={props.pressed}
          onPressedChange={(pressed) => props.disabled !== true && props.onChange(pressed)}
          class={barToggle}
        >
          {props.children}
        </Toggle>
      )}
    </Tip>
  )
}

export function DiffControls(props: {
  handle: DiffHandle | undefined
  tests: number
  whitespace: "available" | "staging"
}) {
  const files = () => (props.tests === 1 ? "1 test file" : `${props.tests.toLocaleString()} test files`)
  return (
    <span class="flex items-center gap-0.5">
      <BarToggle
        label={
          props.tests === 0
            ? "No test files in this change"
            : hideTests()
              ? `Show ${files()}`
              : `Hide ${files()}, with fixtures, mocks and snapshots`
        }
        pressed={props.tests > 0 && hideTests()}
        disabled={props.tests === 0}
        onChange={toggleHideTests}
      >
        <Flask />
      </BarToggle>
      <Show when={props.handle}>
        {(handle) => (
          <Tip label={handle().allCollapsed() ? "Expand all files" : "Collapse all files"}>
            {(trigger) => (
              <Button
                {...trigger}
                variant="ghost"
                aria-label={handle().allCollapsed() ? "Expand all files" : "Collapse all files"}
                class="w-6 justify-center px-0"
                onClick={() => handle().collapseAll(!handle().allCollapsed())}
              >
                {handle().allCollapsed() ? <ExpandAll /> : <CollapseAll />}
              </Button>
            )}
          </Tip>
        )}
      </Show>
      <span aria-hidden="true" class="mx-1 h-3.5 w-px bg-border" />
      <BarToggle label="Wrap lines" keys={shortcut("diff.wrap")} pressed={wrapLines()} onChange={toggleWrapLines}>
        <WrapText />
      </BarToggle>
      <BarToggle
        label={props.whitespace === "staging" ? "Ignore whitespace is off while staging lines" : "Ignore whitespace"}
        pressed={props.whitespace === "available" && ignoreWhitespace()}
        disabled={props.whitespace === "staging"}
        onChange={setIgnoreWhitespace}
      >
        <Space />
      </BarToggle>
      <LayoutButton />
    </span>
  )
}

export function LayoutButton() {
  return (
    <Button variant="ghost" onClick={toggleDiffStyle}>
      {diffStyle() === "unified" ? "Unified" : "Split"}
      <Kbd>{shortcut("diff.layout")}</Kbd>
    </Button>
  )
}
