import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Branch, PullStrategy, Remote, RepoId } from "@gitui/contracts"
import { toast } from "sonner"
import { latest, refsAtom, statusAtom, useGitAction, useNetwork } from "@/lib/git"
import { usePrompt } from "./prompt"
import { remotesOpenAtom } from "./remotes"

const pullChoices: ReadonlyArray<{ value: PullStrategy; label: string }> = [
  { value: "ff-only", label: "Fast-forward only" },
  { value: "merge", label: "Merge" },
  { value: "rebase", label: "Rebase" },
  { value: "configured", label: "Use Git configuration" },
]

const remoteChoices = (remotes: ReadonlyArray<Remote>) => [
  { value: "", label: "Choose a remote" },
  ...remotes.map((remote) => ({
    value: remote.name,
    label: `${remote.name} · ${(remote.pushUrls.length > 0 ? remote.pushUrls : remote.urls).join(", ")}`,
  })),
]

export function usePublishing(repo: RepoId) {
  const prompt = usePrompt()
  const git = useGitAction()
  const network = useNetwork(repo)
  const refs = latest(useAtomValue(refsAtom(repo)))
  const status = latest(useAtomValue(statusAtom(repo)))
  const openRemotes = useAtomSet(remotesOpenAtom(repo))
  const remotes = refs?.remotes ?? []
  const currentName = status?.head._tag === "Branch" ? status.head.name : undefined
  const current = refs?.branches.find((branch) => branch.name === currentName)
  const hasRemotes = () => {
    if (remotes.length > 0) return true
    openRemotes(true)
    return false
  }
  const changeUpstream = (branch: Branch) =>
    prompt({
      title: `Change upstream for ${branch.name}`,
      description: "Pull uses this branch. Fetch first if the branch you need is missing.",
      fields: [
        {
          key: "upstream",
          label: "Upstream branch",
          optional: true,
          initial: branch.upstream?.ref ?? "",
          choices: [
            { value: "", label: "No upstream" },
            ...(branch.upstream?._tag === "Gone"
              ? [{ value: branch.upstream.ref, label: `${branch.upstream.name} (gone)` }]
              : []),
            ...(refs?.branches ?? [])
              .filter((local) => local.name !== branch.name)
              .map((local) => ({
                value: `refs/heads/${local.name}`,
                label: `${local.name} (local)`,
              })),
            ...(refs?.remoteBranches ?? []).map((remote) => ({
              value: `refs/remotes/${remote.name}`,
              label: remote.name,
            })),
          ],
        },
      ],
      submitLabel: "Save upstream",
      onSubmit: ({ upstream }) =>
        upstream === (branch.upstream?.ref ?? "")
          ? Promise.resolve(true)
          : git("Change upstream", repo, (c) =>
              c("SetUpstream", { repo, branch: branch.name, upstream: upstream || null }),
            ),
    })

  return {
    manageRemotes: () => openRemotes(true),
    changeUpstream,
    push: (branch = current) => {
      if (branch === undefined) {
        toast.error("Check out a branch with a commit before pushing.")
        return
      }
      if (!hasRemotes()) return
      const upstream = branch.upstream?.ref
      const remote = [...remotes]
        .sort((a, b) => b.name.length - a.name.length)
        .find((remote) => upstream?.startsWith(`refs/remotes/${remote.name}/`))
      prompt({
        title: `Push ${branch.name}`,
        description: "Publish this branch to the selected remote. The remote's push URLs are shown below.",
        fields: [
          {
            key: "remote",
            label: "Remote",
            initial: remote?.name ?? (remotes.length === 1 ? remotes[0]!.name : ""),
            choices: remoteChoices(remotes),
          },
          {
            key: "remoteBranch",
            label: "Remote branch",
            initial: remote === undefined ? branch.name : upstream!.slice(`refs/remotes/${remote.name}/`.length),
          },
        ],
        options: [
          {
            key: "setUpstream",
            label: "Use this destination as the upstream for pull",
            initial: branch.upstream === null,
          },
        ],
        submitLabel: "Push branch",
        onSubmit: ({ remote, remoteBranch }, { setUpstream }) =>
          network.run({ action: "Push", destination: { branch: branch.name, remote, remoteBranch }, setUpstream }),
      })
    },
    pull: () => {
      if (current === undefined) {
        toast.error("Check out a branch with a commit before pulling.")
        return
      }
      if (current.upstream === null) {
        if (hasRemotes()) changeUpstream(current)
        return
      }
      const target = { branch: current.name, upstream: current.upstream.ref }
      prompt({
        title: `Pull into ${current.name}`,
        description: `Pull from ${current.upstream.name}. Fast-forward only stops if the branches diverge. Merge combines their history. Rebase replays your local commits on top.`,
        fields: [{ key: "strategy", label: "Pull strategy", initial: "ff-only", choices: pullChoices }],
        submitLabel: "Pull",
        onSubmit: ({ strategy }) =>
          network.run({
            action: "Pull",
            target,
            strategy: pullChoices.find((choice) => choice.value === strategy)!.value,
          }),
      })
    },
    pushTags: (tags = refs?.tags.map((tag) => tag.name) ?? []) => {
      if (!hasRemotes()) return
      if (tags.length === 0) {
        toast.error("Create a tag before pushing tags.")
        return
      }
      prompt({
        title: tags.length === 1 ? `Push tag ${tags[0]}` : `Push ${tags.length} tags`,
        description: (
          <div className="max-h-32 overflow-auto break-all">
            Tags to publish: {tags.join(", ")}. Existing remote tags will not be replaced.
          </div>
        ),
        fields: [
          {
            key: "remote",
            label: "Remote",
            initial: remotes.length === 1 ? remotes[0]!.name : "",
            choices: remoteChoices(remotes),
          },
        ],
        submitLabel: tags.length === 1 ? "Push tag" : "Push tags",
        onSubmit: ({ remote }) => network.run({ action: "PushTags", remote, tags }),
      })
    },
  }
}
