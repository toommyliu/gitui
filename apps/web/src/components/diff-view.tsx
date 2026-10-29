import { useAtomValue } from "@effect/atom-react"
import type { FileChange, RepoId, RepoPath } from "@gitui/contracts"
import {
  type ChangeTypes,
  type CodeViewDiffItem,
  type CodeViewLineSelection,
  type DiffIndicators,
  type FileDiffMetadata,
  type LineDiffTypes,
  type SelectionSide,
  parsePatchFiles,
} from "@pierre/diffs"
import { CodeView, type CodeViewHandle, useWorkerPool, WorkerPoolContextProvider } from "@pierre/diffs/react"
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker"
import { formatForDisplay, useAppHotkeys } from "@tanstack/react-hotkeys"
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon } from "lucide-react"
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "cn"
import { copyText, copyWithToast } from "@/lib/clipboard"
import {
  type DiffLocation,
  type DiffMatch,
  diffMatches,
  hunkLocations,
  matchesFileName,
  stepMatch,
} from "@/lib/change-search"
import { type CommandId, useCommand, useCommandKeys, useOverlayOpen } from "@/lib/commands"
import { diffThemes } from "@/lib/diff-themes"
import { desktop } from "@/lib/desktop"
import { editorLine } from "@/lib/lines"
import { hiddenLocationTop, locationBeyond, nearestBeyond, READING_SLOP, sideRuns } from "@/lib/diff-nav"
import { fileStepTarget } from "@/lib/file-step"
import { type Settings, settingsAtom } from "@/lib/settings"
import { ChangeLetter } from "./change-letter"
import { CURRENT_FIND_HIGHLIGHT, FIND_HIGHLIGHT, useMatchHighlights } from "./diff-find"
import { OpenInContextMenu } from "./open-in"
import { FindField } from "./search-fields"
import { useTheme } from "./theme-provider"

export const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return h >>> 0
}

export interface DiffItemMeta {
  readonly section: string
  readonly path: RepoPath
}

export type DiffItem = CodeViewDiffItem & { readonly binary: boolean }

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

export const patchItems = (section: string, patch: string): Array<DiffItem> => {
  const version = hash(patch)
  const binary = binaryPaths(patch)
  return parsePatchFiles(patch, `${section}:${version}`).flatMap((parsed) =>
    parsed.files.map((fileDiff) => ({
      id: `${section}\n${fileDiff.name}`,
      type: "diff" as const,
      fileDiff,
      version,
      binary: binary.has(fileDiff.name),
    })),
  )
}

export const hasText = (item: DiffItem) => item.fileDiff.hunks.length > 0

export const filterItems = (items: ReadonlyArray<DiffItem>, query: string) =>
  query.trim() === ""
    ? items
    : items.filter((item) => matchesFileName(item.fileDiff.name, query, item.fileDiff.prevName))

export const expandableIds = (items: ReadonlyArray<DiffItem>) => items.filter(hasText).map((item) => item.id)

const noTextNote = (item: DiffItem) => {
  const { type } = item.fileDiff
  if (item.binary) {
    return type === "new" ? "Binary file added" : type === "deleted" ? "Binary file deleted" : "Binary file changed"
  }
  if (type === "rename-pure") return "Renamed without changes"
  if (type === "new") return "Empty file added"
  if (type === "deleted") return "Empty file deleted"
  return "File mode changed"
}

export const itemMeta = (id: string): DiffItemMeta => {
  const newline = id.indexOf("\n")
  return { section: id.slice(0, newline), path: id.slice(newline + 1) as RepoPath }
}

export interface Collapse {
  readonly ids: ReadonlySet<string>
  readonly set: (ids: ReadonlyArray<string>, collapsed: boolean) => void
}

export const useCollapse = (): Collapse => {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set())
  const set = useCallback((targets: ReadonlyArray<string>, collapsed: boolean) => {
    setIds((previous) => {
      const next = new Set(previous)
      for (const id of targets) {
        if (collapsed) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])
  return useMemo(() => ({ ids, set }), [ids, set])
}

export interface HoveredLine {
  readonly lineNumber: number
  readonly side: SelectionSide
}

export interface LineSelectionProps {
  readonly selection: CodeViewLineSelection | null
  readonly onSelectionChange: (selection: CodeViewLineSelection | null) => void
  readonly gutter: (line: HoveredLine, item: CodeViewDiffItem) => ReactNode
}

export function GutterButton({
  label,
  onPress,
  children,
}: {
  label: string
  onPress: () => void
  children: ReactNode
}) {
  const press = useRef(onPress)
  useLayoutEffect(() => {
    press.current = onPress
  })
  const attach = useCallback((node: HTMLButtonElement | null) => {
    if (node === null) return
    const shield = (event: Event) => event.stopPropagation()
    const handle = (event: MouseEvent) => {
      event.stopPropagation()
      press.current()
    }
    node.addEventListener("pointerdown", shield)
    node.addEventListener("click", handle)
    return () => {
      node.removeEventListener("pointerdown", shield)
      node.removeEventListener("click", handle)
    }
  }, [])
  return (
    <button
      ref={attach}
      type="button"
      aria-label={label}
      title={label}
      className="relative z-10 flex size-4 items-center justify-center rounded-sm bg-secondary font-medium text-secondary-foreground hover:bg-primary hover:text-primary-foreground"
    >
      {children}
    </button>
  )
}

const changeOf: Record<ChangeTypes, FileChange["change"]> = {
  new: "added",
  deleted: "deleted",
  change: "modified",
  "rename-pure": "renamed",
  "rename-changed": "renamed",
}

const HEADER_HEIGHT = 32
export const SEPARATOR_HEIGHT = 24

const separator = ':is([data-separator="line-info"], [data-separator="line-info-basic"])'
const quiet = "color-mix(in srgb, var(--diffs-fg) 50%, var(--diffs-bg))"

export const UNSAFE_CSS = `
:host {
  --diffs-light: var(--foreground);
  --diffs-dark: var(--foreground);
  --diffs-light-bg: var(--background);
  --diffs-dark-bg: var(--background);
  --diffs-addition-color-override: var(--diff-addition);
  --diffs-deletion-color-override: var(--diff-deletion);
  --diffs-bg-addition-emphasis-override: var(--diff-addition-emphasis);
  --diffs-bg-deletion-emphasis-override: var(--diff-deletion-emphasis);
  --diffs-fg-number-addition-override: var(--change-added);
  --diffs-fg-number-deletion-override: var(--change-deleted);
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
  text-decoration: none !important;
}
${separator} [data-expand-button] {
  color: ${quiet} !important;
}
${separator}[data-expand-index] :is([data-separator-content], [data-expand-button]):hover {
  color: var(--diffs-fg) !important;
  background-color: color-mix(in srgb, var(--diffs-bg) 92%, var(--diffs-fg)) !important;
}
[data-diff] {
  transition: opacity 200ms ease-out;
}
@starting-style {
  [data-diff] {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-diff] {
    transition: none;
  }
}
::highlight(${FIND_HIGHLIGHT}) {
  background-color: color-mix(in oklch, var(--change-modified) 35%, transparent);
}
::highlight(${CURRENT_FIND_HIGHLIGHT}) {
  background-color: color-mix(in oklch, var(--change-modified) 75%, transparent);
  text-decoration: underline 2px;
}
`

const scrollToEnd = (node: HTMLDivElement | null) => {
  if (node !== null) node.scrollLeft = node.scrollWidth
}

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="text-muted-foreground"
      aria-label={copied ? "Path copied" : "Copy path"}
      title="Copy path"
      onClick={() =>
        copyText(path).then(
          () => setCopied(true),
          () => toast.error("Couldn't copy", { description: "This browser blocked clipboard access." }),
        )
      }
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

function FileHeader({
  repo,
  line,
  fileDiff,
  note,
  fullPath,
  first,
  collapsed,
  onToggle,
  onSetAll,
  actions,
}: {
  repo: RepoId
  line: number | undefined
  fileDiff: FileDiffMetadata
  note: string | null
  fullPath: string
  first: boolean
  collapsed: boolean
  onToggle: () => void
  onSetAll: ((collapsed: boolean) => void) | null
  actions: ReactNode
}) {
  let additions = 0
  let deletions = 0
  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionLines
    deletions += hunk.deletionLines
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={{ height: HEADER_HEIGHT }}
        onClick={(event) => {
          if (note === null && !(event.target as HTMLElement).closest("button")) onToggle()
        }}
        className={cn(
          "flex items-center gap-2 bg-background pr-3 pl-1.5 font-sans text-xs",
          note === null && "hover:shadow-[inset_3px_0_color-mix(in_srgb,var(--foreground)_24%,transparent)]",
          !first && "border-t",
        )}
      >
        {note === null ? (
          <Button
            size="icon-sm"
            variant="ghost"
            className="-mr-1 text-muted-foreground"
            aria-label={collapsed ? "Expand diff" : "Collapse diff"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand diff" : "Collapse diff"}
            onClick={onToggle}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
          </Button>
        ) : (
          <span className="-mr-1 size-6 shrink-0" />
        )}
        <ChangeLetter change={changeOf[fileDiff.type]} />
        <div ref={scrollToEnd} className="min-w-0 [scrollbar-width:none] overflow-x-auto font-medium whitespace-nowrap">
          {fileDiff.prevName !== undefined && fileDiff.prevName !== fileDiff.name && (
            <span className="text-muted-foreground">{fileDiff.prevName} → </span>
          )}
          {fileDiff.name}
        </div>
        <CopyPathButton path={fileDiff.name} />
        {note === null ? (
          <span className="ml-auto shrink-0 tabular-nums">
            {deletions > 0 && <span className="text-change-deleted">-{deletions} </span>}
            {additions > 0 && <span className="text-change-added">+{additions}</span>}
          </span>
        ) : (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{note}</span>
        )}
        {actions}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <OpenInContextMenu
          repo={repo}
          file={{ path: fileDiff.name, ...(line === undefined ? {} : { line }) }}
          disabled={fileDiff.type === "deleted"}
        />
        <ContextMenuItem onClick={() => void copyWithToast(fileDiff.name, "Path copied")}>Copy path</ContextMenuItem>
        <ContextMenuItem onClick={() => void copyWithToast(fullPath, "Full path copied")}>
          Copy full path
        </ContextMenuItem>
        {onSetAll !== null && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onSetAll(true)}>Collapse all files</ContextMenuItem>
            <ContextMenuItem onClick={() => onSetAll(false)}>Expand all files</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

const changeMarkers = {
  color: { diffIndicators: "bars", disableBackground: false },
  signs: { diffIndicators: "classic", disableBackground: true },
  both: { diffIndicators: "classic", disableBackground: false },
} as const satisfies Record<
  Settings["changeMarkers"],
  { readonly diffIndicators: DiffIndicators; readonly disableBackground: boolean }
>

const textSizes = {
  small: { fontSize: 12, lineHeight: 18 },
  medium: { fontSize: 13, lineHeight: 20 },
  large: { fontSize: 14, lineHeight: 22 },
} as const satisfies Record<Settings["diffTextSize"], { readonly fontSize: number; readonly lineHeight: number }>

export const useDiffAppearance = () => {
  const { resolvedTheme } = useTheme()
  const { diffStyle, wrapLines, changeMarkers: markers, lineNumbers, diffTextSize } = useAtomValue(settingsAtom)
  return useMemo(() => {
    const { fontSize, lineHeight } = textSizes[diffTextSize]
    return {
      options: {
        ...changeMarkers[markers],
        diffStyle,
        themeType: resolvedTheme,
        overflow: wrapLines ? ("wrap" as const) : ("scroll" as const),
        disableLineNumbers: !lineNumbers,
      },
      style: { "--diffs-font-size": `${fontSize}px`, "--diffs-line-height": `${lineHeight}px` } as CSSProperties,
      lineHeight,
    }
  }, [markers, diffStyle, resolvedTheme, wrapLines, lineNumbers, diffTextSize])
}

const lineDiffTypes = {
  word: "word-alt",
  char: "char",
  none: "none",
} as const satisfies Record<Settings["wordDiff"], LineDiffTypes>

const poolSize = Math.max(1, Math.min(4, navigator.hardwareConcurrency - 1))

type RenderSettings = Pick<Settings, "wordDiff" | "diffTheme">

const renderOptions = ({ wordDiff, diffTheme }: RenderSettings) => {
  const { light, dark } = diffThemes[diffTheme]
  return { lineDiffType: lineDiffTypes[wordDiff], theme: { light, dark } }
}

function SyncRenderOptions({ wordDiff, diffTheme }: RenderSettings) {
  const pool = useWorkerPool()
  useEffect(() => {
    void pool?.setRenderOptions(renderOptions({ wordDiff, diffTheme }))
  }, [pool, wordDiff, diffTheme])
  return null
}

export function DiffWorkerPool({ children }: { children: ReactNode }) {
  const { wordDiff, diffTheme } = useAtomValue(settingsAtom)
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffsWorker(), poolSize }}
      highlighterOptions={renderOptions({ wordDiff, diffTheme })}
    >
      <SyncRenderOptions wordDiff={wordDiff} diffTheme={diffTheme} />
      {children}
    </WorkerPoolContextProvider>
  )
}

type ViewInstance = NonNullable<ReturnType<CodeViewHandle<undefined, undefined>["getInstance"]>>

interface Reveal {
  readonly location: DiffLocation
  readonly align: "start" | "center"
}

interface Find {
  readonly query: string
  readonly items: ReadonlyArray<DiffItem>
  readonly matches: ReadonlyArray<DiffMatch>
  readonly current: number | null
}

const sameMatch = (a: DiffMatch, b: DiffMatch) =>
  a.id === b.id && a.side === b.side && a.lineNumber === b.lineNumber && a.start === b.start

export function DiffStack({
  repo,
  items,
  header,
  actions,
  viewRef,
  lines,
  collapse,
}: {
  repo: RepoId
  items: ReadonlyArray<DiffItem>
  header?: () => ReactNode
  actions?: (meta: DiffItemMeta) => ReactNode
  viewRef?: RefObject<CodeViewHandle<undefined, undefined> | null>
  lines?: LineSelectionProps
  collapse?: Collapse
}) {
  const ownCollapse = useCollapse()
  const { ids: collapsedIds, set: setCollapsed } = collapse ?? ownCollapse
  const shown = useMemo(
    () =>
      items.map((item) => {
        const collapsed = !hasText(item) || collapsedIds.has(item.id)
        return { ...item, collapsed, version: (item.version ?? 0) * 2 + (collapsed ? 1 : 0) }
      }),
    [items, collapsedIds],
  )
  const expandable = useMemo(() => expandableIds(items), [items])
  const notes = useMemo(() => new Map(items.map((item) => [item.id, hasText(item) ? null : noTextNote(item)])), [items])
  const { options: look, style, lineHeight } = useDiffAppearance()
  const [ownSelection, setOwnSelection] = useState<CodeViewLineSelection | null>(null)
  const selection = lines === undefined ? ownSelection : lines.selection
  const lineActions = lines !== undefined
  const selectable = lineActions || desktop !== undefined
  const [view, setView] = useState<CodeViewHandle<undefined, undefined> | null>(null)
  const [find, setFind] = useState<Find>({ query: "", items, matches: [], current: null })
  if (find.items !== items) {
    const matches = find.query === "" ? find.matches : diffMatches(items, find.query)
    const previous = find.current === null ? undefined : find.matches[find.current]
    const index = previous === undefined ? -1 : matches.findIndex((match) => sameMatch(match, previous))
    setFind({ query: find.query, items, matches, current: index === -1 ? null : index })
  }
  const { query, matches, current } = find
  const paintMatches = useMatchHighlights(view, matches, current)
  const options = useMemo(
    () => ({
      ...look,
      stickyHeaders: true,
      unsafeCSS: UNSAFE_CSS,
      itemMetrics: {
        lineHeight,
        diffHeaderHeight: HEADER_HEIGHT,
        hunkSeparatorHeight: SEPARATOR_HEIGHT,
        spacing: 0,
        paddingTop: 0,
        paddingBottom: 8,
      },
      layout: { paddingTop: 0, paddingBottom: 8, gap: 0 },
      hunkSeparators: "line-info" as const,
      enableLineSelection: selectable,
      enableGutterUtility: lineActions,
      onPostRender: paintMatches,
    }),
    [look, lineHeight, selectable, lineActions, paintMatches],
  )
  const attachView = useCallback(
    (handle: CodeViewHandle<undefined, undefined> | null) => {
      setView(handle)
      if (viewRef !== undefined) viewRef.current = handle
    },
    [viewRef],
  )
  const fileStep = (delta: 1 | -1) => () => {
    const instance = view?.getInstance()
    if (instance === undefined) return
    const tops = shown.map((item) => instance.getTopForItem(item.id) ?? Number.POSITIVE_INFINITY)
    const index = fileStepTarget(tops, instance.getScrollTop(), delta)
    const target = index === null ? undefined : shown[index]
    if (target !== undefined) view?.scrollTo({ type: "item", id: target.id, align: "start" })
  }

  const [revealing, setRevealing] = useState<Reveal | null>(null)
  useEffect(() => {
    if (revealing === null) return
    const { location, align } = revealing
    view?.scrollTo({ type: "line", id: location.id, lineNumber: location.lineNumber, side: location.side, align })
  }, [view, revealing])
  const reveal = (location: DiffLocation, align: Reveal["align"]) => {
    if (collapsedIds.has(location.id)) setCollapsed([location.id], false)
    setRevealing({ location, align })
  }
  const locate = (instance: ViewInstance) => {
    const rendered = new Map(instance.getRenderedItems().map((item) => [item.id, item]))
    return (location: DiffLocation) => {
      const top = instance.getTopForItem(location.id) ?? 0
      const item = collapsedIds.has(location.id) ? undefined : rendered.get(location.id)
      const line = item?.type === "diff" ? item.instance.getLinePosition(location.lineNumber, location.side) : undefined
      return line === undefined
        ? { top: hiddenLocationTop(top, HEADER_HEIGHT), exact: false }
        : { top: top + line.top, exact: true }
    }
  }
  const readingLine = (instance: ViewInstance) => instance.getScrollTop() + HEADER_HEIGHT

  const hunks = useMemo(() => hunkLocations(items), [items])
  const hunkStep = (delta: 1 | -1) => () => {
    const instance = view?.getInstance()
    if (instance === undefined) return
    const position = locate(instance)
    const edge = readingLine(instance) + delta * READING_SLOP
    const index = locationBeyond(hunks.length, (i) => position(hunks[i]!).top, edge, delta)
    const hunk = index === null ? undefined : hunks[index]
    if (hunk !== undefined) reveal(hunk, "start")
  }

  const showMatch = (instance: ViewInstance, match: DiffMatch) => {
    const { top, exact } = locate(instance)(match)
    const scrollTop = instance.getScrollTop()
    const visible = exact && top >= scrollTop + HEADER_HEIGHT && top + lineHeight <= scrollTop + instance.getHeight()
    if (!visible) reveal(match, "center")
  }
  const nearestMatch = (instance: ViewInstance, list: ReadonlyArray<DiffMatch>, delta: 1 | -1) => {
    const position = locate(instance)
    const top = (index: number) => position(list[index]!).top
    const runs = sideRuns(list)
    const wrap = delta === 1 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
    return (
      nearestBeyond(runs, top, readingLine(instance) - READING_SLOP, delta) ?? nearestBeyond(runs, top, wrap, delta)
    )
  }
  const search = (next: string) => {
    const instance = view?.getInstance()
    const found = diffMatches(items, next)
    const index = instance === undefined ? null : nearestMatch(instance, found, 1)
    setFind({ query: next, items, matches: found, current: index })
    const match = index === null ? undefined : found[index]
    if (instance !== undefined && match !== undefined) showMatch(instance, match)
  }
  const findStep = (delta: 1 | -1) => {
    const instance = view?.getInstance()
    if (instance === undefined) return
    const index = current === null ? nearestMatch(instance, matches, delta) : stepMatch(matches.length, current, delta)
    const match = index === null ? undefined : matches[index]
    if (match === undefined) return
    setFind({ ...find, current: index })
    showMatch(instance, match)
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useCommand(
    "diff.find",
    () => {
      const active = document.activeElement
      if (active !== findRef.current) {
        returnFocus.current = active instanceof HTMLElement && rootRef.current?.contains(active) ? active : null
      }
      findRef.current?.focus()
      findRef.current?.select()
    },
    { target: rootRef },
  )
  const closeFind = () => {
    search("")
    const back = returnFocus.current
    returnFocus.current = null
    ;(back?.isConnected === true ? back : scrollRef.current)?.focus({ preventScroll: true })
  }

  const overlayOpen = useOverlayOpen()
  useCommandKeys(
    [
      { id: "diff.nextFile", run: fileStep(1) },
      { id: "diff.previousFile", run: fileStep(-1) },
      { id: "diff.nextHunk", run: hunkStep(1) },
      { id: "diff.previousHunk", run: hunkStep(-1) },
    ],
    { enabled: !overlayOpen },
  )
  const keys = useAppHotkeys()
  const described = (label: string, id: CommandId) => {
    const { hotkey } = keys[id]
    return hotkey === null ? label : `${label} (${formatForDisplay(hotkey)})`
  }
  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col"
      onPointerDownCapture={() => {
        if (!rootRef.current?.contains(document.activeElement)) scrollRef.current?.focus({ preventScroll: true })
      }}
    >
      <div className="flex shrink-0 items-center gap-0.5 border-b pr-1.5">
        <FindField
          inputRef={findRef}
          query={query}
          onQueryChange={search}
          results={query === "" ? null : { count: matches.length, current }}
          onStep={findStep}
          onClose={closeFind}
          hotkey={keys["diff.find"].hotkey}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label="Previous hunk"
          title={described("Previous hunk", "diff.previousHunk")}
          disabled={hunks.length === 0}
          onClick={hunkStep(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label="Next hunk"
          title={described("Next hunk", "diff.nextHunk")}
          disabled={hunks.length === 0}
          onClick={hunkStep(1)}
        >
          <ArrowDownIcon />
        </Button>
      </div>
      <CodeView
        ref={attachView}
        containerRef={scrollRef}
        items={shown}
        options={options}
        style={style}
        className="min-h-0 flex-1 overflow-auto overscroll-contain select-text"
        {...(header === undefined ? {} : { renderCodeViewHeader: header })}
        renderCustomHeader={(item) =>
          item.type === "diff" ? (
            <FileHeader
              repo={repo}
              line={selection?.id === item.id ? editorLine(item.fileDiff, selection.range) : undefined}
              fileDiff={item.fileDiff}
              note={notes.get(item.id) ?? null}
              fullPath={`${repo}/${item.fileDiff.name}`}
              first={item.id === shown[0]?.id}
              collapsed={item.collapsed === true}
              onToggle={() => setCollapsed([item.id], item.collapsed !== true)}
              onSetAll={expandable.length > 1 ? (collapsed) => setCollapsed(expandable, collapsed) : null}
              actions={actions?.(itemMeta(item.id))}
            />
          ) : null
        }
        selectedLines={selection}
        onSelectedLinesChange={lines?.onSelectionChange ?? setOwnSelection}
        {...(lines === undefined
          ? {}
          : {
              renderGutterUtility: (getHovered, item) => {
                const hovered = getHovered()
                if (hovered === undefined || item.type !== "diff" || !("side" in hovered)) return null
                const side = hovered.side === "deletions" ? "deletions" : "additions"
                return lines.gutter({ lineNumber: hovered.lineNumber, side }, item)
              },
            })}
      />
    </div>
  )
}
