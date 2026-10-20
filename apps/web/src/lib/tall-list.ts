import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

// Browsers cap an element's height (16.7M px in the Chromium preview, 33.5M px in Electron), and a
// list past the cap silently loses its last rows, so the scrollable area stays well under it.
export const MAX_SCROLL_HEIGHT = 5_000_000
const PAGES = 100

export interface ScrollPosition {
  readonly top: number
  readonly offset: number
}

export const scrollHeight = (total: number) => Math.min(total, MAX_SCROLL_HEIGHT)

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const pagesFor = (total: number, viewport: number) => {
  const size = MAX_SCROLL_HEIGHT / PAGES
  const count = Math.ceil(total / size)
  return {
    size,
    count,
    jump: (total - MAX_SCROLL_HEIGHT) / (count - 1),
    last: total - viewport,
    reach: MAX_SCROLL_HEIGHT - viewport,
  }
}

type Pages = ReturnType<typeof pagesFor>

const offsetOf = (page: number, pages: Pages) =>
  clamp(page * pages.jump, Math.min((page + 1) * pages.size, pages.last) - pages.reach, page * pages.size)

const pageOf = (position: number, pages: Pages) => Math.min(Math.floor(position / pages.size), pages.count - 1)

export const scrollTo = (position: number, total: number, viewport: number): ScrollPosition => {
  if (total <= MAX_SCROLL_HEIGHT) return { top: position, offset: 0 }
  const pages = pagesFor(total, viewport)
  const target = clamp(position, 0, pages.last)
  const offset = offsetOf(pageOf(target, pages), pages)
  return { top: target - offset, offset }
}

export const scrolled = (previous: ScrollPosition, top: number, total: number, viewport: number): ScrollPosition => {
  if (total <= MAX_SCROLL_HEIGHT) return { top, offset: 0 }
  if (Math.abs(top - previous.top) <= viewport) return scrollTo(top + previous.offset, total, viewport)
  const pages = pagesFor(total, viewport)
  let page = pageOf((top / pages.reach) * pages.last, pages)
  while (page > 0 && top < page * pages.size - offsetOf(page, pages)) page--
  while (page < pages.count - 1 && top > Math.min((page + 1) * pages.size, pages.last) - offsetOf(page, pages)) page++
  return { top, offset: offsetOf(page, pages) }
}

export function useTallList({
  count,
  rowHeight,
  overscan,
  resetKey,
}: {
  count: number
  rowHeight: number
  overscan: number
  resetKey: unknown
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const total = count * rowHeight
  const live = useRef<{ total: number; scroll: ScrollPosition }>({ total, scroll: { top: 0, offset: 0 } })
  const [view, setView] = useState({ first: 0, end: 0, offset: 0 })

  const show = useCallback(
    (scroll: ScrollPosition) => {
      live.current.scroll = scroll
      if (element === null) return
      if (Math.abs(element.scrollTop - scroll.top) >= 1) element.scrollTo({ top: scroll.top })
      const position = scroll.top + scroll.offset
      const first = Math.max(0, Math.floor(position / rowHeight) - overscan)
      const end = Math.ceil((position + element.clientHeight) / rowHeight) + overscan
      setView((view) =>
        view.first === first && view.end === end && view.offset === scroll.offset
          ? view
          : { first, end, offset: scroll.offset },
      )
    },
    [element, rowHeight, overscan],
  )

  useEffect(() => {
    if (element === null) return
    const onScroll = () =>
      show(scrolled(live.current.scroll, element.scrollTop, live.current.total, element.clientHeight))
    element.addEventListener("scroll", onScroll, { passive: true })
    const observer = new ResizeObserver(onScroll)
    observer.observe(element)
    return () => {
      element.removeEventListener("scroll", onScroll)
      observer.disconnect()
    }
  }, [element, show])

  useLayoutEffect(() => {
    live.current.total = total
    const { top, offset } = live.current.scroll
    show(scrollTo(top + offset, total, element?.clientHeight ?? 0))
  }, [total, element, show])

  useLayoutEffect(() => {
    show(scrollTo(0, live.current.total, element?.clientHeight ?? 0))
  }, [resetKey, element, show])

  const scrollToIndex = useCallback(
    (index: number) => {
      if (element === null) return
      const { top, offset } = live.current.scroll
      const position = top + offset
      const rowTop = index * rowHeight
      const rowBottom = rowTop + rowHeight
      const viewport = element.clientHeight
      if (rowTop < position) show(scrollTo(rowTop, live.current.total, viewport))
      else if (rowBottom > position + viewport) show(scrollTo(rowBottom - viewport, live.current.total, viewport))
    },
    [element, rowHeight, show],
  )

  const rows = []
  for (let index = view.first; index < Math.min(view.end, count); index++) {
    rows.push({ index, top: index * rowHeight - view.offset })
  }
  return { ref: setElement, element, height: scrollHeight(total), rows, scrollToIndex }
}
