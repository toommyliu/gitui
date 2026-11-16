import { allRefsVisible, type CommitRow, type GraphRow, LogExpired, type LogHandle, type Oid } from "@gitui/contracts"
import { createEffect, createSignal } from "solid-js"
import type { Repo } from "./repo"
import { call, subscribe } from "./rpc"

const PAGE_SIZE = 200

export const lanesUsed = (row: GraphRow) => {
  let widest = row.lane
  for (const flat of [row.up, row.down])
    for (let i = 0; i < flat.length; i += 3) widest = Math.max(widest, flat[i] ?? 0, flat[i + 1] ?? 0)
  return widest + 1
}

interface Cache {
  readonly logId: string
  readonly requests: Map<number, Promise<ReadonlyArray<CommitRow> | undefined>>
  readonly pages: Map<number, ReadonlyArray<CommitRow>>
}

const emptyCache = (logId: string): Cache => ({ logId, requests: new Map(), pages: new Map() })

const pagesIn = (start: number, end: number) => {
  const pages: number[] = []
  for (let page = Math.floor(start / PAGE_SIZE); page * PAGE_SIZE < end; page++) pages.push(page)
  return pages
}

export const createLog = (repo: Repo, query: () => string) => {
  const [handle, setHandle] = createSignal<LogHandle | null>(null)
  const [error, setError] = createSignal<unknown>(null)
  const [opened, setOpened] = createSignal(0)
  const [version, setVersion] = createSignal(0)
  let cache = emptyCache("")
  let next: { readonly cache: Cache; handle: LogHandle } | null = null
  let visible = { start: 0, end: 0 }

  const show = (target: Cache, log: LogHandle | null) => {
    cache = target
    next = null
    setVersion((count) => count + 1)
    setHandle(log)
  }

  const fail = (failure: unknown) => {
    if (failure instanceof LogExpired) setOpened((count) => count + 1)
    else setError(failure)
  }

  const load = (page: number, owner = cache) => {
    const existing = owner.requests.get(page)
    if (existing !== undefined) return existing
    const request = call((git) =>
      git.GetLogPage({ repo: repo.id, logId: owner.logId, start: page * PAGE_SIZE, count: PAGE_SIZE }),
    ).then(
      (rows) => {
        owner.pages.set(page, rows)
        if (owner === cache) setVersion((count) => count + 1)
        if (owner === next?.cache) promote()
        return rows
      },
      (failure: unknown) => {
        owner.requests.delete(page)
        if (owner === cache || owner === next?.cache) fail(failure)
        return undefined
      },
    )
    owner.requests.set(page, request)
    return request
  }

  const promote = () => {
    if (next === null) return
    const staged = next
    const needed = new Set([0, ...pagesIn(visible.start, visible.end)])
    for (const page of needed) void load(page, staged.cache)
    const reached = staged.handle.done || staged.handle.loaded >= visible.end
    if (reached && [...needed].every((page) => staged.cache.pages.has(page))) show(staged.cache, staged.handle)
  }

  createEffect(
    () => ({ query: query(), refs: repo.track("refs"), opened: opened() }),
    (current, previous) => {
      if (previous !== undefined && current.query !== previous.query) show(emptyCache(""), null)
      return subscribe(
        (git) => git.OpenLog({ repo: repo.id, query: current.query, refs: allRefsVisible }),
        (log) => {
          setError(null)
          if (log.logId === cache.logId) {
            next = null
            setHandle(log)
          } else if (handle() === null) show(emptyCache(log.logId), log)
          else {
            if (next?.cache.logId === log.logId) next.handle = log
            else next = { cache: emptyCache(log.logId), handle: log }
            promote()
          }
        },
        fail,
      )
    },
  )

  const row = (index: number): CommitRow | undefined => {
    version()
    return cache.pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE]
  }

  const indexOf = (oid: Oid) => {
    version()
    for (const [page, rows] of cache.pages) {
      const index = rows.findIndex((candidate) => candidate.oid === oid)
      if (index !== -1) return page * PAGE_SIZE + index
    }
    return -1
  }

  return {
    handle,
    error,
    row,
    indexOf,
    ensure: (start: number, end: number) => {
      visible = { start, end }
      if (cache.logId === "") return
      for (const page of pagesIn(start, end)) void load(page)
      promote()
    },
    rowAt: async (index: number) =>
      cache.logId === "" ? undefined : (await load(Math.floor(index / PAGE_SIZE)))?.[index % PAGE_SIZE],
    retry: () => {
      setError(null)
      setOpened((count) => count + 1)
    },
  }
}

export type Log = ReturnType<typeof createLog>
