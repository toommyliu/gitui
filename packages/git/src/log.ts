import type { CommitRow, Oid } from "@gitui/contracts"
import { GraphLayout } from "./graph.ts"
import { NulSplitter } from "./nul.ts"

export const logRevArgs = (hasHead: boolean) => [...(hasHead ? ["HEAD"] : []), "--branches", "--remotes"]

export const logArgs = (hasHead: boolean) => [
  "log",
  "-z",
  "--date-order",
  "--format=%H%x00%P%x00%an%x00%at%x00%s",
  ...logRevArgs(hasHead),
  "--",
]

const FIELDS = 5

export class LogParser {
  private readonly splitter = new NulSplitter()
  private readonly layout = new GraphLayout()
  private pending: Array<string> = []

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
        graph: this.layout.push(oid, parents),
      })
    }
    this.pending = all.slice(i)
    return rows
  }
}
