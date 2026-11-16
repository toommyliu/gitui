import {
  Tree,
  TreeGroup,
  TreeItem,
  TreeItemCheckbox,
  TreeItemIndicator,
  TreeItemLabel,
  type TreeItemData,
  treeFromPaths,
} from "@ui-sdk/solid/tree"
import type { JSX } from "@solidjs/web"
import { Menu, MenuContent, MenuContextTrigger } from "@ui-sdk/solid/menu"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { ChevronDown } from "./icons"

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
  const items = createMemo(() => treeFromPaths(props.files.map((file) => file.path)))
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const expanded = () => branchesOf(items()).filter((value) => !collapsed().has(value))
  const checkable = () => props.onCheckedChange !== undefined
  const [menuPath, setMenuPath] = createSignal<string | null>(null)

  function Items(itemProps: { items: ReadonlyArray<TreeItemData> }) {
    return (
      <For each={itemProps.items} keyed={(item) => item.value}>
        {(item) => {
          const file = () => byPath().get(item().value)
          return (
            <TreeItem value={item().value} disabled={file()?.disabled === true} data-path={item().value}>
              <TreeItemLabel
                data-context={menuPath() === item().value ? "" : undefined}
                data-marked={props.marked?.has(item().value) === true ? "" : undefined}
                class="scroll-my-12 data-context:outline-1 data-context:-outline-offset-1 data-context:outline-ring"
              >
                <Show when={item().children !== undefined}>
                  <TreeItemIndicator>
                    <ChevronDown />
                  </TreeItemIndicator>
                </Show>
                <Show when={checkable()}>
                  <TreeItemCheckbox data-partial={partial(item().value) ? "" : undefined} />
                </Show>
                <Show
                  when={file()}
                  fallback={<span class="min-w-0 flex-1 truncate text-muted-foreground">{item().label}</span>}
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
                      <span class="min-w-0 flex-1 truncate">{item().label}</span>
                      <Show when={entry().additions}>
                        <span class="font-mono text-2xs text-change-added tabular-nums">+{entry().additions}</span>
                      </Show>
                      <Show when={entry().deletions}>
                        <span class="font-mono text-2xs text-change-deleted tabular-nums">−{entry().deletions}</span>
                      </Show>
                    </>
                  )}
                </Show>
              </TreeItemLabel>
              <Show when={item().children}>
                {(children) => (
                  <TreeGroup>
                    <Items items={children()} />
                  </TreeGroup>
                )}
              </Show>
            </TreeItem>
          )
        }}
      </For>
    )
  }

  let tree: HTMLDivElement | undefined
  createEffect(
    () => props.selected,
    () => {
      tree?.querySelector('[data-slot="tree-label"][data-current]')?.scrollIntoView({ block: "nearest" })
    },
  )

  return (
    <Menu onOpenChange={(open) => open || setMenuPath(null)}>
      <MenuContextTrigger
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
          ref={(element: HTMLDivElement) => (tree = element)}
          aria-label={props.label}
          items={items()}
          mode="none"
          current={props.selected}
          onAction={(value, details) => {
            if (byPath().has(value)) props.onSelect(value, howOf(details.event))
          }}
          expanded={expanded()}
          onExpandedChange={(next) => {
            const open = new Set(next)
            setCollapsed(new Set(branchesOf(items()).filter((value) => !open.has(value))))
          }}
          expandOnPress={false}
          checkable={checkable()}
          checkStrategy="leaf"
          checked={[...(props.checked ?? [])]}
          onCheckedChange={(next) => props.onCheckedChange?.(next)}
          class="p-1"
        >
          <Items items={items()} />
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
