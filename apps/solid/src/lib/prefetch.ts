export const createCache = <V>(limit: number) => {
  const loaded = new Map<string, V>()
  const pending = new Map<string, Promise<V>>()

  const get = (key: string, load: () => Promise<V>): V | Promise<V> => {
    const hit = loaded.get(key)
    if (hit !== undefined) {
      loaded.delete(key)
      loaded.set(key, hit)
      return hit
    }
    const inflight = pending.get(key)
    if (inflight !== undefined) return inflight
    const request = load().then(
      (value) => {
        pending.delete(key)
        loaded.set(key, value)
        const oldest = loaded.keys().next()
        if (loaded.size > limit && !oldest.done) loaded.delete(oldest.value)
        return value
      },
      (error: unknown) => {
        pending.delete(key)
        throw error
      },
    )
    pending.set(key, request)
    return request
  }

  return { get }
}
