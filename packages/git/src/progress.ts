import type { Progress } from "@gitui/contracts"

export const parseProgress = (line: string): Progress => {
  const percents = [...line.matchAll(/(\d{1,3})%/g)]
  const last = percents.at(-1)?.[1]
  return { line, percent: last === undefined ? null : Math.min(100, Number(last)) }
}

export class ProgressSplitter {
  private partial = ""
  private current = ""
  private readonly lines: Array<string> = []

  push(text: string): Array<string> {
    const updates: Array<string> = []
    for (const char of text) {
      if (char !== "\r" && char !== "\n") {
        this.partial += char
        continue
      }
      const segment = this.partial.trim()
      this.partial = ""
      if (segment !== "") {
        updates.push(segment)
        this.current = segment
      }
      if (char === "\n") this.commit()
    }
    return updates
  }

  flush(): Array<string> {
    const segment = this.partial.trim()
    this.partial = ""
    if (segment !== "") this.current = segment
    this.commit()
    return segment === "" ? [] : [segment]
  }

  get transcript(): string {
    return this.lines.join("\n")
  }

  private commit() {
    if (this.current !== "") this.lines.push(this.current)
    this.current = ""
  }
}
