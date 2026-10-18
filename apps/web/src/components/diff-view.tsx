import { useAtomValue } from "@effect/atom-react"
import type { RepoPath } from "@gitui/contracts"
import { type CodeViewDiffItem, type CodeViewLineSelection, type SelectionSide, parsePatchFiles } from "@pierre/diffs"
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react"
import { type ReactNode, type Ref, useCallback, useLayoutEffect, useMemo, useRef } from "react"
import { settingsAtom } from "@/lib/settings"
import { useTheme } from "./theme-provider"

const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return h >>> 0
}

// Pierre truncates header paths with direction: rtl; the marks keep a leading "." of a dotfile path in place.
const headerCSS = `[data-title]::before,[data-title]::after,[data-prev-name]::before,[data-prev-name]::after{content:"\\200E"}`

export interface DiffItemMeta {
  readonly section: string
  readonly path: RepoPath
}

export const patchItems = (section: string, patch: string): Array<CodeViewDiffItem> => {
  const version = hash(patch)
  return parsePatchFiles(patch, `${section}:${version}`).flatMap((parsed) =>
    parsed.files.map((fileDiff) => ({
      id: `${section}\n${fileDiff.name}`,
      type: "diff" as const,
      fileDiff,
      version,
    })),
  )
}

export const itemMeta = (id: string): DiffItemMeta => {
  const newline = id.indexOf("\n")
  return { section: id.slice(0, newline), path: id.slice(newline + 1) as RepoPath }
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

export function DiffStack({
  items,
  header,
  actions,
  viewRef,
  lines,
}: {
  items: ReadonlyArray<CodeViewDiffItem>
  header?: () => ReactNode
  actions?: (meta: DiffItemMeta) => ReactNode
  viewRef?: Ref<CodeViewHandle<undefined, undefined>>
  lines?: LineSelectionProps
}) {
  const { resolvedTheme } = useTheme()
  const { diffStyle, wrapLines } = useAtomValue(settingsAtom)
  const selectable = lines !== undefined
  const options = useMemo(
    () => ({
      diffStyle,
      themeType: resolvedTheme,
      overflow: wrapLines ? ("wrap" as const) : ("scroll" as const),
      stickyHeaders: true,
      hunkSeparators: "line-info" as const,
      lineDiffType: "word" as const,
      enableLineSelection: selectable,
      enableGutterUtility: selectable,
      unsafeCSS: headerCSS,
    }),
    [resolvedTheme, diffStyle, wrapLines, selectable],
  )
  return (
    <CodeView
      {...(viewRef === undefined ? {} : { ref: viewRef })}
      items={items}
      options={options}
      className="h-full overflow-auto overscroll-contain"
      {...(header === undefined ? {} : { renderCodeViewHeader: header })}
      {...(actions === undefined ? {} : { renderHeaderMetadata: (item) => actions(itemMeta(item.id)) })}
      {...(lines === undefined
        ? {}
        : {
            selectedLines: lines.selection,
            onSelectedLinesChange: lines.onSelectionChange,
            renderGutterUtility: (getHovered, item) => {
              const hovered = getHovered()
              if (hovered === undefined || item.type !== "diff" || !("side" in hovered)) return null
              const side = hovered.side === "deletions" ? "deletions" : "additions"
              return lines.gutter({ lineNumber: hovered.lineNumber, side }, item)
            },
          })}
    />
  )
}
