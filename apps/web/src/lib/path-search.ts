import { basename } from "./format"

export const searchPaths = <P extends string>(paths: ReadonlyArray<P>, query: string, limit: number) => {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "")
  const last = terms.at(-1)
  if (last === undefined) return { matches: paths.slice(0, limit), total: paths.length }
  const ranked = paths.flatMap((path) => {
    const lower = path.toLowerCase()
    if (!terms.every((term) => lower.includes(term))) return []
    return [{ path, named: basename(lower).includes(last) ? 0 : 1 }]
  })
  ranked.sort((a, b) => a.named - b.named || a.path.length - b.path.length || a.path.localeCompare(b.path))
  return { matches: ranked.slice(0, limit).map((match) => match.path), total: ranked.length }
}
