import type { RepoPath } from "@gitui/contracts"

export type Side = "unstaged" | "staged"

export interface FileSelection {
  readonly side: Side
  readonly paths: ReadonlySet<RepoPath>
  readonly anchor: RepoPath
  readonly lead: RepoPath
  readonly leadIndex: number
  readonly next: RepoPath | null
}

export type ClickMode = "only" | "toggle" | "extend"

type Lists<R> = Readonly<Record<Side, ReadonlyArray<R>>>
type Row = { readonly path: RepoPath; readonly area: string }

const make = (
  side: Side,
  list: ReadonlyArray<Row>,
  paths: ReadonlySet<RepoPath>,
  anchor: RepoPath,
  leadIndex: number,
): FileSelection => {
  const lead = list[leadIndex]!
  const unselected = (row: Row) => !paths.has(row.path) && (lead.area !== "conflicted" || row.area === "conflicted")
  const next = list.slice(leadIndex + 1).find(unselected) ?? list.slice(0, leadIndex).findLast(unselected)
  return { side, paths, anchor, lead: lead.path, leadIndex, next: next?.path ?? null }
}

const single = (side: Side, list: ReadonlyArray<Row>, index: number): FileSelection | null => {
  const row = list[index]
  return row === undefined ? null : make(side, list, new Set([row.path]), row.path, index)
}

const range = (selection: FileSelection, list: ReadonlyArray<Row>, index: number): FileSelection | null => {
  const from = list.findIndex((row) => row.path === selection.anchor)
  if (from === -1) return single(selection.side, list, index)
  const paths = new Set(list.slice(Math.min(from, index), Math.max(from, index) + 1).map((row) => row.path))
  return make(selection.side, list, paths, selection.anchor, index)
}

export const selectedRows = <R extends Row>(selection: FileSelection | null, lists: Lists<R>): ReadonlyArray<R> =>
  selection === null ? [] : lists[selection.side].filter((row) => selection.paths.has(row.path))

export const reconcile = (selection: FileSelection | null, lists: Lists<Row>): FileSelection | null => {
  if (selection === null) return null
  const list = lists[selection.side]
  const paths = new Set(list.filter((row) => selection.paths.has(row.path)).map((row) => row.path))
  const leadIndex = list.findIndex((row) => row.path === selection.lead)
  if (paths.size === selection.paths.size && leadIndex === selection.leadIndex) return selection
  const next = list.findIndex((row) => row.path === selection.next)
  const fallback = next === -1 ? Math.min(selection.leadIndex, list.length - 1) : next
  if (paths.size === 0) return single(selection.side, list, fallback)
  return make(selection.side, list, paths, selection.anchor, leadIndex === -1 ? fallback : leadIndex)
}

export const visibleSelection = (selection: FileSelection | null, lists: Lists<Row>): FileSelection | null => {
  if (selection === null) return null
  const list = lists[selection.side]
  const paths = new Set(list.filter((row) => selection.paths.has(row.path)).map((row) => row.path))
  if (paths.size === 0) return null
  const lead = list.findIndex((row) => row.path === selection.lead)
  if (paths.size === selection.paths.size && lead === selection.leadIndex) return selection
  const index = lead === -1 ? list.findIndex((row) => paths.has(row.path)) : lead
  const anchor = paths.has(selection.anchor) ? selection.anchor : list[index]!.path
  return make(selection.side, list, paths, anchor, index)
}

export const click = (
  selection: FileSelection | null,
  lists: Lists<Row>,
  side: Side,
  path: RepoPath,
  mode: ClickMode,
): FileSelection | null => {
  const list = lists[side]
  const index = list.findIndex((row) => row.path === path)
  if (selection === null || selection.side !== side || mode === "only") return single(side, list, index)
  if (mode === "extend") return range(selection, list, index)
  const paths = new Set(selection.paths)
  if (!paths.delete(path)) paths.add(path)
  return paths.size === 0 ? null : make(side, list, paths, path, index)
}

export const move = (
  selection: FileSelection | null,
  lists: Lists<Row>,
  side: Side,
  delta: 1 | -1,
  extend: boolean,
): FileSelection | null => {
  const { unstaged, staged } = lists
  if (selection === null) return single(side, lists[side], delta === 1 ? 0 : lists[side].length - 1)
  const list = lists[selection.side]
  const index = selection.leadIndex + delta
  if (index >= 0 && index < list.length) {
    return extend ? range(selection, list, index) : single(selection.side, list, index)
  }
  if (extend) return selection
  const next =
    selection.side === "unstaged" && delta === 1
      ? single("staged", staged, 0)
      : selection.side === "staged" && delta === -1
        ? single("unstaged", unstaged, unstaged.length - 1)
        : null
  return next ?? selection
}

export const selectAll = (lists: Lists<Row>, side: Side): FileSelection | null => {
  const list = lists[side]
  if (list.length === 0) return null
  return make(side, list, new Set(list.map((row) => row.path)), list[0]!.path, list.length - 1)
}
