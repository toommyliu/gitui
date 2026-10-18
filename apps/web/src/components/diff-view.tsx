import { useAtomValue } from "@effect/atom-react"
import { type CodeViewDiffItem, parsePatchFiles } from "@pierre/diffs"
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react"
import { type ReactNode, type Ref, useMemo } from "react"
import { settingsAtom } from "@/lib/settings"
import { useTheme } from "./theme-provider"

const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return h >>> 0
}

export interface DiffItemMeta {
  readonly section: string
  readonly path: string
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
  return { section: id.slice(0, newline), path: id.slice(newline + 1) }
}

export function DiffStack({
  items,
  header,
  actions,
  viewRef,
}: {
  items: ReadonlyArray<CodeViewDiffItem>
  header?: () => ReactNode
  actions?: (meta: DiffItemMeta) => ReactNode
  viewRef?: Ref<CodeViewHandle<undefined, undefined>>
}) {
  const { resolvedTheme } = useTheme()
  const { diffStyle, wrapLines } = useAtomValue(settingsAtom)
  const options = useMemo(
    () => ({
      diffStyle,
      themeType: resolvedTheme,
      overflow: wrapLines ? ("wrap" as const) : ("scroll" as const),
      stickyHeaders: true,
      hunkSeparators: "line-info" as const,
      lineDiffType: "word" as const,
    }),
    [resolvedTheme, diffStyle, wrapLines],
  )
  return (
    <CodeView
      {...(viewRef === undefined ? {} : { ref: viewRef })}
      items={items}
      options={options}
      className="h-full overflow-auto overscroll-contain"
      {...(header === undefined ? {} : { renderCodeViewHeader: header })}
      {...(actions === undefined ? {} : { renderHeaderMetadata: (item) => actions(itemMeta(item.id)) })}
    />
  )
}
