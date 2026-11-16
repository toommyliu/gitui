import {
  Tree,
  TreeItem,
  TreeItemCheckbox,
  TreeItemIndicator,
  TreeItemLabel,
  type TreeItemData,
  treeFromPaths,
  visibleTreeRows,
} from "@ui-sdk/solid/tree"
import type { JSX } from "@solidjs/web"
import { createVirtualizer } from "@ui-sdk/core"
import { Menu, MenuContent, MenuContextTrigger } from "@ui-sdk/solid/menu"
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js"
import { ChevronDown } from "./icons"
import { ROW } from "./ui"

export type Letter = "M" | "A" | "D" | "R" | "C" | "T" | "?" | "!"

export interface FileEntry {
  readonly path: string
  readonly letter: Letter
  readonly additions?: number | null
  readonly deletions?: number | null
  readonly partial?: boolean
  readonly disabled?: boolean
}

const letterClass: Record<Letter, string> = {
  M: "text-change-modified",
  A: "text-change-added",
  D: "text-change-deleted",
  R: "text-change-renamed",
  C: "text-change-renamed",
  T: "text-change-modified",
  "?": "text-change-added",
  "!": "text-destructive",
}

export const letterOf = (change: string): Letter => {
  switch (change) {
    case "added":
      return "A"
    case "deleted":
      return "D"
    case "renamed":
      return "R"
    case "copied":
      return "C"
    case "typechange":
      return "T"
    default:
      return "M"
  }
}

const branchesOf = (items: ReadonlyArray<TreeItemData>): Array<string> =>
  items.flatMap((item) => (item.children === undefined ? [] : [item.value, ...branchesOf(item.children)]))

export type SelectHow = "replace" | "toggle" | "range"

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

export const howOf = (event: Event | undefined): SelectHow => {
  if (!(event instanceof MouseEvent) && !(event instanceof KeyboardEvent)) return "replace"
  if (event.shiftKey) return "range"
  return (isMac ? event.metaKey : event.ctrlKey) ? "toggle" : "replace"
}

const leavesOf = (items: ReadonlyArray<TreeItemData>): Array<string> =>
  items.flatMap((item) => (item.children === undefined ? [item.value] : leavesOf(item.children)))

export const fileOrder = (paths: ReadonlyArray<string>) => leavesOf(treeFromPaths([...paths]))

export const samePaths = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((path, index) => path === b[index])

export function FileTree(props: {
  label: string
  files: ReadonlyArray<FileEntry>
  selected: string | null
  onSelect: (path: string, how: SelectHow) => void
  marked?: ReadonlySet<string> | undefined
  checked?: ReadonlyArray<string>
  onCheckedChange?: (checked: Array<string>) => void
  menu?: (path: string) => JSX.Element
}) {
  const byPath = createMemo(() => new Map(props.files.map((file) => [file.path, file])))
  const partialFolders = createMemo(() => {
    const folders = new Set<string>()
    for (const file of props.files) {
      if (file.partial !== true) continue
      for (let slash = file.path.indexOf("/"); slash !== -1; slash = file.path.indexOf("/", slash + 1)) {
        folders.add(file.path.slice(0, slash))
      }
    }
    return folders
  })
  const partial = (value: string) => byPath().get(value)?.partial === true || partialFolders().has(value)
  const paths = createMemo(() => props.files.map((file) => file.path), { equals: samePaths })
  const items = createMemo(() => treeFromPaths([...paths()]))
  const checked = createMemo(() => [...(props.checked ?? [])], { equals: samePaths })
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const expanded = createMemo(() => branchesOf(items()).filter((value) => !collapsed().has(value)))
  const rows = createMemo(() => visibleTreeRows(items(), expanded()))
  const checkable = () => props.onCheckedChange !== undefined
  const [menuPath, setMenuPath] = createSignal<string | null>(null)

  const indexOf = (path: string | null) => untrack(rows).find((row) => row.item.value === path)?.index
  const virtual = createVirtualizer({
    count: () => untrack(rows).length,
    estimate: () => ROW,
    key: (index) => untrack(rows)[index]?.item.value ?? String(index),
    keep: () => {
      const index = indexOf(untrack(() => props.selected))
      return index === undefined ? [] : [index]
    },
    scrollMargin: 4,
  })
  const [visible, setVisible] = createSignal(virtual.items())
  let scroller: HTMLDivElement | undefined

  onSettled(() => {
    if (scroller === undefined) return
    const disconnect = virtual.connect(scroller)
    const unsubscribe = virtual.subscribe(() => setVisible(virtual.items()))
    setVisible(virtual.items())
    return () => {
      unsubscribe()
      disconnect()
    }
  })

  createEffect(rows, () => virtual.refresh())

  createEffect(
    () => props.selected,
    (path) => {
      const index = indexOf(path)
      if (index !== undefined) virtual.scrollToIndex(index)
    },
  )

  return (
    <Menu onOpenChange={(open) => open || setMenuPath(null)}>
      <MenuContextTrigger
        ref={(element: HTMLDivElement) => (scroller = element)}
        class="min-h-0 flex-1 overflow-y-auto overscroll-none p-1"
        disabled={props.menu === undefined}
        onContextMenu={(event: MouseEvent) => {
          if (props.menu === undefined) return
          const row = event.target instanceof Element ? event.target.closest("[data-path]") : null
          const path = row?.getAttribute("data-path") ?? null
          if (path === null) return event.preventDefault()
          setMenuPath(path)
        }}
      >
        <Tree
          aria-label={props.label}
          items={items()}
          mode="none"
          current={props.selected}
          onAction={(value, details) => {
            if (byPath().has(value)) props.onSelect(value, howOf(details.event))
          }}
          onHighlight={(_value, details) => {
            if (details.index >= 0) virtual.scrollToIndex(details.index)
          }}
          expanded={expanded()}
          onExpandedChange={(next) => {
            const open = new Set(next)
            setCollapsed(new Set(branchesOf(items()).filter((value) => !open.has(value))))
          }}
          expandOnPress={false}
          checkable={checkable()}
          checkStrategy="leaf"
          checked={checked()}
          onCheckedChange={(next) => props.onCheckedChange?.(next)}
          class="relative"
          style={{ height: `${rows().length * ROW}px` }}
        >
          <For each={visible()} keyed={(virtualRow) => virtualRow.key}>
            {(virtualRow) => (
              <Show when={rows()[virtualRow().index]}>
                {(row) => {
                  const value = () => row().item.value
                  const file = () => byPath().get(value())
                  return (
                    <TreeItem
                      value={value()}
                      disabled={file()?.disabled === true}
                      data-path={value()}
                      class="absolute inset-x-0"
                      style={{ top: `${virtualRow().start}px` }}
                    >
                      <TreeItemLabel
                        data-context={menuPath() === value() ? "" : undefined}
                        data-marked={props.marked?.has(value()) === true ? "" : undefined}
                        class="data-context:outline-1 data-context:-outline-offset-1 data-context:outline-ring"
                      >
                        <Show when={row().item.children !== undefined}>
                          <TreeItemIndicator>
                            <ChevronDown />
                          </TreeItemIndicator>
                        </Show>
                        <Show when={checkable()}>
                          <TreeItemCheckbox data-partial={partial(value()) ? "" : undefined} />
                        </Show>
                        <Show
                          when={file()}
                          fallback={
                            <span class="min-w-0 flex-1 truncate text-muted-foreground">{row().item.label}</span>
                          }
                        >
                          {(entry) => (
                            <>
                              <span
                                class={[
                                  "w-3 shrink-0 text-center font-mono text-2xs font-semibold",
                                  letterClass[entry().letter],
                                ]}
                              >
                                {entry().letter}
                              </span>
                              <span class="min-w-0 flex-1 truncate">{row().item.label}</span>
                              <Show when={entry().additions}>
                                <span class="font-mono text-2xs text-change-added tabular-nums">
                                  +{entry().additions}
                                </span>
                              </Show>
                              <Show when={entry().deletions}>
                                <span class="font-mono text-2xs text-change-deleted tabular-nums">
                                  −{entry().deletions}
                                </span>
                              </Show>
                            </>
                          )}
                        </Show>
                      </TreeItemLabel>
                    </TreeItem>
                  )
                }}
              </Show>
            )}
          </For>
        </Tree>
      </MenuContextTrigger>
      <MenuContent class="min-w-48">
        <Show when={menuPath()} keyed>
          {(path) => props.menu?.(path)}
        </Show>
      </MenuContent>
    </Menu>
  )
}
