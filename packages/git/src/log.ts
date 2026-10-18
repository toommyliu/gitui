import type { CommitRow, Oid } from "@gitui/contracts"
import { GraphLayout } from "./graph.ts"
import { NulSplitter } from "./nul.ts"

export const logRevArgs = (hasHead: boolean) => [...(hasHead ? ["HEAD"] : []), "--branches", "--remotes"]

export interface LogQuery {
  readonly words: ReadonlyArray<string>
  readonly authors: ReadonlyArray<string>
  readonly paths: ReadonlyArray<string>
}

export const parseLogQuery = (query: string): LogQuery => {
  const words: Array<string> = []
  const authors: Array<string> = []
  const paths: Array<string> = []
  for (const [, key, quoted, bare] of query.matchAll(/(?:(author|path):)?(?:"([^"]*)"?|(\S+))/g)) {
    const value = quoted ?? bare ?? ""
    if (value === "") continue
    if (key === "author") authors.push(value)
    else if (key === "path") paths.push(value.replace(/^\.?\//, ""))
    else words.push(value)
  }
  return { words, authors, paths }
}

export const isEmptyQuery = (query: LogQuery) =>
  query.words.length === 0 && query.authors.length === 0 && query.paths.length === 0

export const shaCandidate = (query: LogQuery) =>
  query.authors.length === 0 &&
  query.paths.length === 0 &&
  query.words.length === 1 &&
  /^[0-9a-f]{4,40}$/i.test(query.words[0]!)
    ? query.words[0]!
    : undefined

export const hasGraph = (query: LogQuery) => query.words.length === 0 && query.authors.length === 0

export const filterArgs = (query: LogQuery) => [
  ...(query.paths.length > 0 && hasGraph(query) ? ["--parents"] : []),
  ...(query.words.length + query.authors.length > 0 ? ["--regexp-ignore-case", "--fixed-strings"] : []),
  ...(query.words.length > 1 ? ["--all-match"] : []),
  ...query.words.map((word) => `--grep=${word}`),
  ...query.authors.map((author) => `--author=${author}`),
]

export const logArgs = (revs: ReadonlyArray<string>, query: LogQuery) => [
  "log",
  "-z",
  "--topo-order",
  "--format=%H%x00%P%x00%an%x00%at%x00%s",
  ...filterArgs(query),
  ...revs,
  "--",
  ...query.paths,
]

const flat = { lane: 0, color: 0, up: [], down: [] }

const FIELDS = 5

export class LogParser {
  private readonly splitter = new NulSplitter()
  private readonly layout = new GraphLayout()
  private pending: Array<string> = []

  private readonly graph: boolean

  constructor(graph = true) {
    this.graph = graph
  }

  push(chunk: Uint8Array): Array<CommitRow> {
    return this.take(this.splitter.push(chunk))
  }

  flush(): Array<CommitRow> {
    return this.take(this.splitter.flush())
  }

  private take(tokens: Array<string>): Array<CommitRow> {
    const all = this.pending.length === 0 ? tokens : [...this.pending, ...tokens]
    const rows: Array<CommitRow> = []
    let i = 0
    for (; i + FIELDS <= all.length; i += FIELDS) {
      const oid = all[i]!.replace(/^\n/, "") as Oid
      const parents = all[i + 1] === "" ? [] : (all[i + 1]!.split(" ") as Array<Oid>)
      rows.push({
        oid,
        parents,
        author: all[i + 2]!,
        time: Number(all[i + 3]),
        subject: all[i + 4]!,
        graph: this.graph ? this.layout.push(oid, parents) : flat,
      })
    }
    this.pending = all.slice(i)
    return rows
  }
}
