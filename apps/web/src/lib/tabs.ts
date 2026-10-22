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
