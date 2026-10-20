import type { CommitRow, GraphRow, Oid } from "@gitui/contracts"
import { GraphLayout, type GraphState } from "./graph.ts"
import { NulSplitter } from "./nul.ts"

const FIELDS = 5
const CHECKPOINT_ROWS = 1024
const flat: GraphRow = { lane: 0, color: 0, up: [], down: [] }

class ByteColumn {
  private buffer = Buffer.allocUnsafe(1 << 16)
  length = 0

  write(text: string, encoding: "hex" | "utf8") {
    const bytes = Buffer.byteLength(text, encoding)
    if (this.length + bytes > this.buffer.length) {
      const next = Buffer.allocUnsafe(Math.max(this.buffer.length * 2, this.length + bytes))
      this.buffer.copy(next, 0, 0, this.length)
      this.buffer = next
    }
    this.length += this.buffer.write(text, this.length, encoding)
  }

  read(start: number, end: number, encoding: "hex" | "utf8") {
    return this.buffer.toString(encoding, start, end)
  }

  indexOf(bytes: Uint8Array, from: number) {
    return this.buffer.subarray(0, this.length).indexOf(bytes, from)
  }
}

class NumberColumn {
  private values = new Float64Array(1 << 12)
  length = 0

  push(value: number) {
    if (this.length === this.values.length) {
      const next = new Float64Array(this.values.length * 2)
      next.set(this.values)
      this.values = next
    }
    this.values[this.length++] = value
  }

  at(index: number) {
    return this.values[index]!
  }
}

export class LogStore {
  private readonly splitter = new NulSplitter()
  private pending: Array<string> = []
  private readonly layout: GraphLayout | null
  private readonly checkpoints: Array<GraphState> = []
  private oidBytes = 0
  private readonly oids = new ByteColumn()
  private readonly parents = new ByteColumn()
  private readonly parentEnds = new NumberColumn()
  private readonly subjects = new ByteColumn()
  private readonly subjectEnds = new NumberColumn()
  private readonly times = new NumberColumn()
  private readonly authorIds = new NumberColumn()
  private readonly authors: Array<string> = []
  private readonly authorIndex = new Map<string, number>()

  constructor(graph: boolean) {
    this.layout = graph ? new GraphLayout() : null
  }

  get length() {
    return this.times.length
  }

  push(chunk: Uint8Array) {
    this.take(this.splitter.push(chunk))
  }

  flush() {
    this.take(this.splitter.flush())
  }

  page(start: number, count: number): Array<CommitRow> {
    const end = Math.min(start + count, this.length)
    const rows: Array<CommitRow> = []
    if (start >= end) return rows
    const from = this.layout === null ? start : start - (start % CHECKPOINT_ROWS)
    const layout = this.layout === null ? null : new GraphLayout(this.checkpoints[from / CHECKPOINT_ROWS])
    for (let row = from; row < end; row++) {
      const oid = this.oids.read(row * this.oidBytes, (row + 1) * this.oidBytes, "hex") as Oid
      const parents: Array<Oid> = []
      for (let at = row === 0 ? 0 : this.parentEnds.at(row - 1); at < this.parentEnds.at(row); at += this.oidBytes) {
        parents.push(this.parents.read(at, at + this.oidBytes, "hex") as Oid)
      }
      const graph = layout === null ? flat : layout.push(oid, parents)
      if (row < start) continue
      rows.push({
        oid,
        parents,
        author: this.authors[this.authorIds.at(row)]!,
        time: this.times.at(row),
        subject: this.subjects.read(row === 0 ? 0 : this.subjectEnds.at(row - 1), this.subjectEnds.at(row), "utf8"),
        graph,
      })
    }
    return rows
  }

  indexOf(oid: Oid, from = 0) {
    const bytes = Buffer.from(oid, "hex")
    if (bytes.length !== this.oidBytes) return -1
    for (let at = this.oids.indexOf(bytes, from * this.oidBytes); at !== -1; at = this.oids.indexOf(bytes, at + 1)) {
      if (at % this.oidBytes === 0) return at / this.oidBytes
    }
    return -1
  }

  private take(tokens: Array<string>) {
    const all = this.pending.length === 0 ? tokens : [...this.pending, ...tokens]
    let i = 0
    for (; i + FIELDS <= all.length; i += FIELDS) {
      const oid = all[i]!.replace(/^\n/, "")
      const parents = all[i + 1] === "" ? [] : all[i + 1]!.split(" ")
      if (this.layout !== null) {
        if (this.length % CHECKPOINT_ROWS === 0) this.checkpoints.push(this.layout.state())
        this.layout.push(oid, parents)
      }
      this.oidBytes = oid.length / 2
      this.oids.write(oid, "hex")
      for (const parent of parents) this.parents.write(parent, "hex")
      this.parentEnds.push(this.parents.length)
      this.subjects.write(all[i + 4]!, "utf8")
      this.subjectEnds.push(this.subjects.length)
      this.authorIds.push(this.authorId(all[i + 2]!))
      this.times.push(Number(all[i + 3]))
    }
    this.pending = all.slice(i)
  }

  private authorId(name: string) {
    let id = this.authorIndex.get(name)
    if (id === undefined) {
      id = this.authors.push(name) - 1
      this.authorIndex.set(name, id)
    }
    return id
  }
}
