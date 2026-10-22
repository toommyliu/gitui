export interface TabState {
  readonly tabs: ReadonlyArray<string>
  readonly active: string | null
  readonly closed: ReadonlyArray<{ readonly path: string; readonly index: number }>
}

const CLOSED_TAB_LIMIT = 20

export const openTab = (state: TabState, path: string, family?: ReadonlyArray<string>): TabState => {
  let at = state.tabs.length
  const parent = state.active === null ? -1 : state.tabs.indexOf(state.active)
  if (family !== undefined && parent !== -1) {
    at = parent + 1
    while (at < state.tabs.length && family.includes(state.tabs[at]!)) at++
  }
  return {
    tabs: state.tabs.includes(path) ? state.tabs : [...state.tabs.slice(0, at), path, ...state.tabs.slice(at)],
    active: path,
    closed: state.closed.filter((tab) => tab.path !== path),
  }
}

export const closeTab = (state: TabState, path: string): TabState => {
  const index = state.tabs.indexOf(path)
  if (index === -1) return state
  return {
    tabs: state.tabs.filter((tab) => tab !== path),
    active: activeAfterClose(state.tabs, state.active, path),
    closed: [...state.closed, { path, index }].slice(-CLOSED_TAB_LIMIT),
  }
}

export const reopenTab = (state: TabState): TabState => {
  const tab = state.closed.at(-1)
  if (tab === undefined) return state
  return {
    tabs: [...state.tabs.slice(0, tab.index), tab.path, ...state.tabs.slice(tab.index)],
    active: tab.path,
    closed: state.closed.slice(0, -1),
  }
}

export const activeAfterClose = (tabs: ReadonlyArray<string>, active: string | null, closed: string): string | null => {
  if (active !== closed) return active
  const index = tabs.indexOf(closed)
  return tabs[index + 1] ?? tabs[index - 1] ?? null
}

export const cycleTab = (tabs: ReadonlyArray<string>, active: string | null, delta: 1 | -1): string | null => {
  if (tabs.length === 0) return active
  const index = active === null ? (delta === 1 ? -1 : 0) : tabs.indexOf(active)
  return tabs[(index + delta + tabs.length) % tabs.length]!
}

export const tabNumber = (count: number, index: number): number | undefined =>
  index === count - 1 ? Math.min(count, 9) : index < 8 ? index + 1 : undefined
