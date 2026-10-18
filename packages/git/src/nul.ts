const decoder = new TextDecoder()

export class NulSplitter {
  private rest: Buffer = Buffer.alloc(0)

  push(chunk: Uint8Array): Array<string> {
    const buf = this.rest.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.rest, chunk])
    const tokens: Array<string> = []
    let start = 0
    let end = buf.indexOf(0, start)
    while (end !== -1) {
      tokens.push(decoder.decode(buf.subarray(start, end)))
      start = end + 1
      end = buf.indexOf(0, start)
    }
    this.rest = buf.subarray(start)
    return tokens
  }

  flush(): Array<string> {
    if (this.rest.length === 0) return []
    const last = decoder.decode(this.rest)
    this.rest = Buffer.alloc(0)
    return [last]
  }
}

export const splitNul = (bytes: Uint8Array): Array<string> => {
  const splitter = new NulSplitter()
  return [...splitter.push(bytes), ...splitter.flush()]
}

export const groups = <T>(tokens: ReadonlyArray<string>, size: number, make: (fields: ReadonlyArray<string>) => T) => {
  const out: Array<T> = []
  for (let i = 0; i + size <= tokens.length; i += size) out.push(make(tokens.slice(i, i + size)))
  return out
}
