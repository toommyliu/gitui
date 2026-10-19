import { describe, expect, it } from "@effect/vitest"
import { GraphLayout } from "./graph.ts"
import { logArgs, logRevArgs, parseLogQuery } from "./log.ts"
import { LogStore } from "./log-store.ts"
import { makeRepo } from "./testRepo.ts"

describe("LogStore", () => {
  it("parses a log streamed one byte at a time", () => {
    const repo = makeRepo()
    const a = repo.commit("first")
    const b = repo.commit('second: with "quotes" and ünïcode')
    const bytes = repo.raw(...logArgs(logRevArgs(true), parseLogQuery("")))
    const store = new LogStore(true)
    for (const byte of bytes) store.push(Uint8Array.of(byte))
    store.flush()
    const rows = store.page(0, 10)
    expect(rows.map((r) => [r.oid, r.parents, r.subject, r.author, r.time])).toEqual([
      [b, [a], 'second: with "quotes" and ünïcode', "Ada", Number(repo.git("show", "-s", "--format=%at", b))],
      [a, [], "first", "Ada", Number(repo.git("show", "-s", "--format=%at", a))],
    ])
  })

  it("pages from layout checkpoints exactly as one pass over the whole history draws it", () => {
    const count = 3000
    const main = (i: number) => `a${i.toString(16).padStart(39, "0")}`
    const side = (i: number) => `b${i.toString(16).padStart(39, "0")}`
    const merges = (i: number) => i % 7 === 0 && i + 3 < count
    const commits: Array<[string, Array<string>]> = []
    for (let i = 0; i < count; i++) {
      commits.push([main(i), i + 1 < count ? [main(i + 1), ...(merges(i) ? [side(i)] : [])] : []])
      if (i > 0 && merges(i - 1)) commits.push([side(i - 1), [main(i + 2)]])
    }
    const bytes = Buffer.from(
      commits
        .map(([oid, parents], i) => `${oid}\0${parents.join(" ")}\0Ada\0${1_700_000_000 + i}\0change ${i} ü\0`)
        .join(""),
    )
    const store = new LogStore(true)
    for (let at = 0; at < bytes.length; at += 777) store.push(bytes.subarray(at, at + 777))
    store.flush()
    const layout = new GraphLayout()
    const expected = commits.map(([oid, parents], i) => ({
      oid,
      parents,
      author: "Ada",
      time: 1_700_000_000 + i,
      subject: `change ${i} ü`,
      graph: layout.push(oid, parents),
    }))

    expect(store.length).toBe(commits.length)
    expect(store.page(1100, 200)).toEqual(expected.slice(1100, 1300))
    expect(store.page(1100, 200)).toEqual(expected.slice(1100, 1300))
    expect(store.page(0, 200)).toEqual(expected.slice(0, 200))
    expect(store.page(commits.length - 50, 200)).toEqual(expected.slice(-50))
  })
})
