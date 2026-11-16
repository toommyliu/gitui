export const load = <A>(key: string, decode: (input: unknown) => A, fallback: A): A => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : decode(JSON.parse(raw))
  } catch {
    return fallback
  }
}

export const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}
