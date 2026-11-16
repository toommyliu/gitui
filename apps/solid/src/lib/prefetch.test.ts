import { describe, expect, it } from "vite-plus/test"
import { createCache } from "./prefetch"

describe("createCache", () => {
  it("returns a loaded value directly instead of a promise", async () => {
    const cache = createCache<number>(10)
    await cache.get("a", () => Promise.resolve(1))
    expect(cache.get("a", () => Promise.resolve(2))).toBe(1)
  })

  it("shares one request between callers while it is pending", async () => {
    const cache = createCache<number>(10)
    let calls = 0
    const load = () => Promise.resolve(++calls)
    const first = cache.get("a", load)
    const second = cache.get("a", load)
    expect(await first).toBe(1)
    expect(await second).toBe(1)
    expect(calls).toBe(1)
  })

  it("forgets the least recently used value past the limit", async () => {
    const cache = createCache<string>(2)
    await cache.get("a", () => Promise.resolve("a"))
    await cache.get("b", () => Promise.resolve("b"))
    void cache.get("a", () => Promise.resolve("stale"))
    await cache.get("c", () => Promise.resolve("c"))
    expect(cache.get("a", () => Promise.resolve("new a"))).toBe("a")
    expect(cache.get("b", () => Promise.resolve("new b"))).toBeInstanceOf(Promise)
  })

  it("retries after a failed load", async () => {
    const cache = createCache<number>(10)
    await expect(cache.get("a", () => Promise.reject(new Error("no")))).rejects.toThrow("no")
    expect(await cache.get("a", () => Promise.resolve(3))).toBe(3)
  })
})
