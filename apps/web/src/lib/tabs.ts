export const activeAfterClose = (tabs: ReadonlyArray<string>, active: string | null, closed: string): string | null => {
  if (active !== closed) return active
  const index = tabs.indexOf(closed)
  return tabs[index + 1] ?? tabs[index - 1] ?? null
}
