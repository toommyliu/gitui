import { type CommitRow, Oid } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { refLabel, resolveRef, walkRange } from "./comparison"

const row = (oid: string, ...parents: Array<string>): CommitRow => ({
  oid: Oid.make(oid),
  parents: parents.map((parent) => Oid.make(parent)),
  subject: oid,
  author: "Ada",
  time: 0,
  graph: { lane: 0, color: 0, up: [], down: [] },
})

const reader = (rows: ReadonlyArray<CommitRow>) => {
  const reads: Array<number> = []
  return {
    reads,
    read: async (start: number, count: number) => {
      reads.push(start)
      return rows.slice(start, start + count)
    },
  }
}

const oids = (range: { commits: ReadonlyArray<CommitRow> }) => range.commits.map((commit) => commit.oid)

describe("listing the commits a comparison adds", () => {
  const log = [row("f2", "f1"), row("m3", "m2"), row("f1", "m1"), row("m2", "m1"), row("m1", "m0"), row("m0")]

  it("lists the head's commits that the base doesn't have", async () => {
    expect(oids(await walkRange(reader(log).read, Oid.make("f2"), Oid.make("m3")))).toEqual(["f2", "f1"])
  })

  it("lists nothing when the head is already in the base", async () => {
    expect(oids(await walkRange(reader(log).read, Oid.make("m1"), Oid.make("m3")))).toEqual([])
  })

  it("follows both sides of a merge until they reach the base", async () => {
    const merged = [
      row("x", "f2", "s1"),
      row("s1", "m1"),
      row("f2", "f1"),
      row("f1", "m2"),
      row("m2", "m1"),
      row("m1", "m0"),
      row("m0"),
    ]
    expect(oids(await walkRange(reader(merged).read, Oid.make("x"), Oid.make("m2")))).toEqual(["x", "s1", "f2", "f1"])
  })

  it("stops reading once every listed commit is accounted for", async () => {
    const long = [row("f1", "m0"), ...Array.from({ length: 3000 }, (_, index) => row(`m${index}`, `m${index + 1}`))]
    const source = reader(long)
    expect(oids(await walkRange(source.read, Oid.make("f1"), Oid.make("m0")))).toEqual(["f1"])
    expect(source.reads).toEqual([0])
  })

  it("marks the list truncated at the commit limit", async () => {
    const range = await walkRange(reader(log).read, Oid.make("f2"), Oid.make("m0"), { commits: 1, rows: 10_000 })
    expect(range).toMatchObject({ truncated: true })
    expect(oids(range)).toEqual(["f2"])
  })
})

describe("naming a compared ref", () => {
  it("drops the ref namespace and shortens full hashes", () => {
    expect(refLabel("refs/heads/feature/a")).toBe("feature/a")
    expect(refLabel("refs/remotes/origin/main")).toBe("origin/main")
    expect(refLabel("a".repeat(40))).toBe("aaaaaaa")
    expect(refLabel("HEAD~2")).toBe("HEAD~2")
  })

  it("resolves a typed name to its ref and keeps anything else as typed", () => {
    const options = [{ ref: "refs/heads/main", label: "main", kind: "branch" as const }]
    expect(resolveRef(" main ", options)).toBe("refs/heads/main")
    expect(resolveRef("abc123", options)).toBe("abc123")
  })
})
