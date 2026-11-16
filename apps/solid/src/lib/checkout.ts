import { GitError } from "@gitui/contracts"

export interface LocalChangesBlock {
  readonly includeUntracked: boolean
}

export const localChangesBlock = (error: unknown): LocalChangesBlock | null =>
  error instanceof GitError && /would be (?:overwritten|removed) by checkout:/.test(error.stderr)
    ? { includeUntracked: error.stderr.includes("untracked working tree files would be") }
    : null
