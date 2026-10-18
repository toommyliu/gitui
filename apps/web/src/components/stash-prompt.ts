import type { RepoId } from "@gitui/contracts"
import { useGitAction } from "@/lib/git"
import { usePrompt } from "./prompt"

export const useStashPrompt = (repo: RepoId) => {
  const git = useGitAction()
  const prompt = usePrompt()
  return () =>
    prompt({
      title: "Stash changes",
      fields: [{ key: "message", label: "Message", optional: true }],
      options: [{ key: "includeUntracked", label: "Include untracked files", initial: true }],
      submitLabel: "Stash",
      onSubmit: ({ message }, { includeUntracked }) =>
        git("Stash", repo, (c) => c("StashPush", { repo, message, includeUntracked })),
    })
}
