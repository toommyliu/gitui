import { describe, expect, it } from "@effect/vitest"
import { LogParser, logArgs } from "./log.ts"
import { makeRepo } from "./testRepo.ts"

describe("LogParser", () => {
  it("parses a log streamed one byte at a time", () => {
    const repo = makeRepo()
    const a = repo.commit("first")
    const b = repo.commit('second: with "quotes" and ünïcode')
    const bytes = repo.raw(...logArgs(true))
    const parser = new LogParser()
    const rows = []
    for (const byte of bytes) rows.push(...parser.push(Uint8Array.of(byte)))
    rows.push(...parser.flush())
    expect(rows.map((r) => [r.oid, r.parents, r.subject, r.author, r.time])).toEqual([
      [b, [a], 'second: with "quotes" and ünïcode', "Ada", Number(repo.git("show", "-s", "--format=%at", b))],
      [a, [], "first", "Ada", Number(repo.git("show", "-s", "--format=%at", a))],
    ])
  })
})
