export const fileStepTarget = (tops: ReadonlyArray<number>, scrollTop: number, delta: 1 | -1): number | null => {
  const current = tops.findLastIndex((top) => top <= scrollTop + 1)
  const withinCurrent = current >= 0 && (tops[current] ?? 0) < scrollTop - 1
  const target = delta === -1 && withinCurrent ? current : current + delta
  return target >= 0 && target < tops.length ? target : null
}
