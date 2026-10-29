import type { Progress } from "@gitui/contracts"

export const parseProgress = (line: string): Progress => {
  const percents = [...line.matchAll(/(\d{1,3})%/g)]
  const last = percents.at(-1)?.[1]
  return { line, percent: last === undefined ? null : Math.min(100, Number(last)) }
}

export class ProgressSplitter {
  private partial = ""
  private current = ""
  private retained = ""
  private oversized = false

  private readonly transcriptLimit: number
  private readonly sanitize: (line: string) => string

  constructor(transcriptLimit = 8 * 1024, sanitize: (line: string) => string = (line) => line) {
    this.transcriptLimit = transcriptLimit
    this.sanitize = sanitize
  }

  push(text: string): Array<string> {
    const updates: Array<string> = []
    for (const char of text) {
      if (char !== "\r" && char !== "\n") {
        if (!this.oversized) {
          if (this.partial.length < 64 * 1024) this.partial += char
          else {
            this.partial = ""
            this.oversized = true
          }
        }
        continue
      }
      const segment = this.oversized ? "[Output line omitted: too long]" : this.partial.trim()
      this.partial = ""
      this.oversized = false
      if (segment !== "") {
        updates.push(segment)
        this.current = segment
      }
      if (char === "\n") this.commit()
    }
    return updates
  }

  flush(): Array<string> {
    const segment = this.oversized ? "[Output line omitted: too long]" : this.partial.trim()
    this.partial = ""
    this.oversized = false
    if (segment !== "") this.current = segment
    this.commit()
    return segment === "" ? [] : [segment]
  }

  get transcript(): string {
    return this.retained
  }

  private commit() {
    if (this.current !== "" && this.transcriptLimit > 0) {
      const line = this.sanitize(this.current)
      this.retained = (this.retained === "" ? line : `${this.retained}\n${line}`).slice(-this.transcriptLimit)
    }
    this.current = ""
  }
}
