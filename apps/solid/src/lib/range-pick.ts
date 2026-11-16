export const rangeKeys = (
  order: ReadonlyArray<string>,
  anchor: string | null,
  key: string,
  extend: boolean,
): ReadonlyArray<string> => {
  const from = anchor === null ? -1 : order.indexOf(anchor)
  const to = order.indexOf(key)
  if (!extend || from === -1 || to === -1) return [key]
  return order.slice(Math.min(from, to), Math.max(from, to) + 1)
}
