import type { Oid } from "@gitui/contracts"

export const COMMIT_OUTPUT_LIMIT = 32_000

export interface CommitOutput {
  readonly text: string
  readonly trimmed: boolean
}

export const emptyOutput: CommitOutput = { text: "", trimmed: false }

export const appendLine = (output: CommitOutput, line: string, limit = COMMIT_OUTPUT_LIMIT): CommitOutput => {
  const text = `${output.text}${line}\n`
  if (text.length <= limit) return { text, trimmed: output.trimmed }
  const cut = text.length - limit
  const lineEnd = text.indexOf("\n", cut)
  return { text: text.slice(lineEnd === text.length - 1 ? cut : lineEnd + 1), trimmed: true }
}

interface RunBase {
  readonly amend: boolean
  readonly output: CommitOutput
}

export type CommitRun =
  | (RunBase & { readonly _tag: "Running" })
  | (RunBase & { readonly _tag: "Committed"; readonly oid: Oid })
  | (RunBase & { readonly _tag: "Failed"; readonly error: string })
  | (RunBase & { readonly _tag: "Cancelled" })
