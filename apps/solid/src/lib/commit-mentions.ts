export type ProsePart = { readonly kind: "text" | "hash"; readonly text: string }

const candidate = /(?<![\w/@-])[0-9a-f]{7,40}(?![\w/@-])/g

const looksLikeHash = (text: string) => /\d/.test(text)

export const splitMentions = (text: string): ReadonlyArray<ProsePart> => {
  const parts: Array<ProsePart> = []
  let start = 0
  for (const match of text.matchAll(candidate)) {
    if (!looksLikeHash(match[0])) continue
    if (match.index > start) parts.push({ kind: "text", text: text.slice(start, match.index) })
    parts.push({ kind: "hash", text: match[0] })
    start = match.index + match[0].length
  }
  if (start < text.length) parts.push({ kind: "text", text: text.slice(start) })
  return parts
}
