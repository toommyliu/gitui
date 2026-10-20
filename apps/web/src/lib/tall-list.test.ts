import { describe, expect, it } from "vite-plus/test"
import { MAX_SCROLL_HEIGHT, type ScrollPosition, scrollHeight, scrolled, scrollTo } from "./tall-list"

const VIEWPORT = 700
const LINUX = 1_485_430 * 26

const position = (scroll: ScrollPosition) => scroll.top + scroll.offset

const wheel = (from: ScrollPosition, delta: number, total: number, steps = Number.POSITIVE_INFINITY) => {
  const max = scrollHeight(total) - VIEWPORT
  let scroll = from
  let lowest = Number.POSITIVE_INFINITY
  let highest = Number.NEGATIVE_INFINITY
  for (let i = 0; i < steps; i++) {
    const next = scrolled(scroll, Math.min(Math.max(scroll.top + delta, 0), max), total, VIEWPORT)
    lowest = Math.min(lowest, next.top)
    highest = Math.max(highest, next.top)
    if (position(next) === position(scroll)) break
    scroll = next
  }
  expect(lowest).toBeGreaterThanOrEqual(0)
  expect(highest).toBeLessThanOrEqual(max)
  return scroll
}

describe("tall list scrolling", () => {
  it("leaves lists under the browser's height cap untouched", () => {
    expect(scrollHeight(1_000_000)).toBe(1_000_000)
    expect(scrolled({ top: 0, offset: 0 }, 400_000, 1_000_000, VIEWPORT)).toEqual({ top: 400_000, offset: 0 })
  })

  it("keeps the scrollable area under the cap for a history taller than it", () => {
    expect(scrollHeight(LINUX)).toBe(MAX_SCROLL_HEIGHT)
  })

  it("moves the list exactly as far as the wheel scrolls, across page boundaries", () => {
    expect(position(wheel({ top: 0, offset: 0 }, 120, LINUX, 5_000))).toBe(600_000)
  })

  it("reaches the oldest row by dragging the scrollbar to the bottom", () => {
    const end = scrolled({ top: 0, offset: 0 }, MAX_SCROLL_HEIGHT - VIEWPORT, LINUX, VIEWPORT)
    expect(position(end)).toBe(LINUX - VIEWPORT)
  })

  it("lands near the middle of history when the scrollbar is dragged to the middle", () => {
    const middle = scrolled({ top: 0, offset: 0 }, (MAX_SCROLL_HEIGHT - VIEWPORT) / 2, LINUX, VIEWPORT)
    expect(Math.abs(position(middle) - (LINUX - VIEWPORT) / 2)).toBeLessThan(MAX_SCROLL_HEIGHT / 100)
  })

  it("wheels from 99% of the way down until it stops at the very last row, and from there back to the first", () => {
    const near = scrolled({ top: 0, offset: 0 }, Math.round((MAX_SCROLL_HEIGHT - VIEWPORT) * 0.99), LINUX, VIEWPORT)
    const bottom = wheel(near, 120, LINUX)
    expect(position(bottom)).toBe(LINUX - VIEWPORT)
    const top = wheel(bottom, -120, LINUX)
    expect(position(top)).toBe(0)
  })

  it("shows the row a jump asked for once the browser reports the new scroll position", () => {
    const target = scrollTo(20_000_000, LINUX, VIEWPORT)
    expect(position(scrolled(target, target.top, LINUX, VIEWPORT))).toBe(20_000_000)
  })
})
