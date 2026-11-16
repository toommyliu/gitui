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

export const createLog = (repo: Repo, query: () => string) => {
  const [handle, setHandle] = createSignal<LogHandle | null>(null)
  const [error, setError] = createSignal<unknown>(null)
  const [opened, setOpened] = createSignal(0)
  const [version, setVersion] = createSignal(0)
  let cache: Cache = { logId: "", requests: new Map(), pages: new Map() }

  const reset = (logId: string) => {
    cache = { logId, requests: new Map(), pages: new Map() }
    setVersion((count) => count + 1)
  }

  const fail = (failure: unknown) => {
    if (failure instanceof LogExpired) setOpened((count) => count + 1)
    else setError(failure)
  }

  createEffect(
    () => ({ query: query(), refs: repo.track("refs"), opened: opened() }),
    (next, previous) => {
      if (previous !== undefined && next.query !== previous.query) {
        reset("")
        setHandle(null)
      }
      return subscribe(
        (git) => git.OpenLog({ repo: repo.id, query: next.query, refs: allRefsVisible }),
        (log) => {
          if (log.logId !== cache.logId) reset(log.logId)
          setError(null)
          setHandle(log)
        },
        fail,
      )
    },
  )

  const load = (page: number) => {
    const owner = cache
    const existing = owner.requests.get(page)
    if (existing !== undefined) return existing
    const request = call((git) =>
      git.GetLogPage({ repo: repo.id, logId: owner.logId, start: page * PAGE_SIZE, count: PAGE_SIZE }),
    ).then(
      (rows) => {
        owner.pages.set(page, rows)
        if (owner === cache) setVersion((count) => count + 1)
        return rows
      },
      (failure: unknown) => {
        owner.requests.delete(page)
        if (owner === cache) fail(failure)
        return undefined
      },
    )
    owner.requests.set(page, request)
    return request
  }

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
      if (cache.logId === "") return
      for (let page = Math.floor(start / PAGE_SIZE); page * PAGE_SIZE < end; page++) void load(page)
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
