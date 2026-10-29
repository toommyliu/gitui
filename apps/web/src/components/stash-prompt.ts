import type { RepoId, RepoPath, Status } from "@gitui/contracts"
import { basename } from "@/lib/format"
import { useGitAction } from "@/lib/git"
import { hasStaged, type StashFiles, stashFiles } from "@/lib/stash"
import { usePrompt } from "./prompt"

export type StashScope =
  | { readonly _tag: "All"; readonly keepIndex: boolean }
  | { readonly _tag: "Files"; readonly paths: ReadonlySet<RepoPath> }

const messageField = { key: "message", label: "Message", optional: true } as const

const keepStaged = (initial: boolean) =>
  ({
    key: "keepIndex",
    label: "Keep staged changes",
    description: "Staged changes stay in place. The stash saves a copy of them too.",
    initial,
  }) as const

const filesSummary = ({ files, untracked }: StashFiles) => {
  const count = files.length
  const scope =
    untracked === count
      ? count === 1
        ? "Stashes this untracked file."
        : `Stashes these ${count} untracked files.`
      : count === 1
        ? "Stashes the staged and unstaged changes in this file."
        : `Stashes the staged and unstaged changes in these ${count} files${untracked === 0 ? "" : `, including ${untracked} untracked ${untracked === 1 ? "file" : "files"}`}.`
  return `${scope} Other files stay as they are.`
}

export const useStashPrompt = (repo: RepoId) => {
  const git = useGitAction()
  const prompt = usePrompt()
  const push = (
    message: string,
    includeUntracked: boolean,
    keepIndex: boolean,
    paths: ReadonlyArray<RepoPath> | null,
  ) => git("Stash", repo, (c) => c("StashPush", { repo, message, includeUntracked, keepIndex, paths }))

  return (status: Status, scope: StashScope) => {
    if (scope._tag === "All") {
      const staged = hasStaged(status)
      prompt({
        title: "Stash changes",
        description: "Stashes the staged and unstaged changes in every tracked file.",
        fields: [messageField],
        options: [
          { key: "includeUntracked", label: "Include untracked files", initial: true },
          ...(staged ? [keepStaged(scope.keepIndex)] : []),
        ],
        submitLabel: "Stash",
        onSubmit: ({ message }, { includeUntracked, keepIndex }) =>
          push(message, includeUntracked, staged && keepIndex, null),
      })
      return
    }
    const files = stashFiles(status, scope.paths)
    const [only] = files.files
    if (only === undefined) return
    const single = files.files.length === 1
    prompt({
      title: single ? `Stash ${basename(only)}` : `Stash ${files.files.length} files`,
      description: filesSummary(files),
      fields: [messageField],
      options: files.staged ? [keepStaged(false)] : [],
      submitLabel: single ? "Stash file" : `Stash ${files.files.length} files`,
      onSubmit: ({ message }, { keepIndex }) =>
        push(message, files.untracked > 0, files.staged && keepIndex, files.paths),
    })
  }
}
