import { RegistryContext, useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useContext } from "react"
import type { Branch, PullStrategy, PushContext, PushDestination, Remote, RepoId } from "@gitui/contracts"
import * as Exit from "effect/Exit"
import { toast } from "sonner"
import { latest, refsAtom, statusAtom, useFailureToast, useGitAction, useNetwork } from "@/lib/git"
import { canRememberPush, rememberPushDestination, savedPushDestination } from "@/lib/publishing-preferences"
import { loadPushContext, syncPreferencesAtom } from "@/lib/publishing-state"
import { usePrompt } from "./prompt"
import { remotesOpenAtom } from "./remotes"

export const pullChoices: ReadonlyArray<{ value: PullStrategy; label: string }> = [
  { value: "ff-only", label: "Fast-forward only" },
  { value: "merge", label: "Merge" },
  { value: "rebase", label: "Rebase" },
  { value: "configured", label: "Use Git configuration" },
]

export const pushUrls = (remote: Remote) => (remote.pushUrls.length > 0 ? remote.pushUrls : remote.urls)

const remoteChoices = (remotes: ReadonlyArray<Remote>) => [
  { value: "", label: "Choose a remote" },
  ...remotes.map((remote) => ({ value: remote.name, label: `${remote.name} · ${pushUrls(remote).join(", ")}` })),
]

const sameDestination = (saved: PushDestination, shown: PushDestination | null) =>
  shown !== null &&
  saved.branch === shown.branch &&
  saved.remote === shown.remote &&
  saved.remoteBranch === shown.remoteBranch

export function usePublishing(repo: RepoId) {
  const registry = useContext(RegistryContext)
  const prompt = usePrompt()
  const git = useGitAction()
  const network = useNetwork(repo)
  const fail = useFailureToast()
  const refs = latest(useAtomValue(refsAtom(repo)))
  const status = latest(useAtomValue(statusAtom(repo)))
  const openRemotes = useAtomSet(remotesOpenAtom(repo))
  const [preferences, setPreferences] = useAtom(syncPreferencesAtom(repo))
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

  const pushContext = async (branch: Branch, options?: { readonly quiet?: boolean }) => {
    const exit = await loadPushContext(registry, repo, branch.name)
    if (Exit.isFailure(exit)) {
      if (options?.quiet !== true) fail("Push", exit.cause)
      return null
    }
    return exit.value
  }

  const send = async (branch: Branch, context: PushContext, destination: PushDestination, setUpstream: boolean) => {
    if (await network.run({ action: "Push", destination, setUpstream, expectedContext: context.fingerprint }))
      return true
    const fresh = await pushContext(branch, { quiet: true })
    if (fresh !== null && fresh.fingerprint !== context.fingerprint) choosePushDestination(branch, fresh)
    return false
  }

  const choosePushDestination = (branch: Branch, context: PushContext) => {
    if (context.remotes.length === 0) {
      openRemotes(true)
      return
    }
    const saved = savedPushDestination(registry.get(syncPreferencesAtom(repo)), context)
    const preselected = saved?.remote ?? (context.remotes.length === 1 ? context.remotes[0]!.name : "")
    const { remote: upstreamRemote, merge } = context.upstream
    const upstreamBranch =
      merge.length === 1 && context.remotes.some((remote) => remote.name === upstreamRemote)
        ? /^refs\/heads\/(.+)$/.exec(merge[0]!)?.[1]
        : undefined
    prompt({
      title: `Push ${branch.name}`,
      description: `gitui remembers the remote and branch you choose for ${branch.name} and pushes there instead of Git's default push destination. It asks again if the upstream or remote settings change.`,
      fields: [
        { key: "remote", label: "Remote", initial: preselected, choices: remoteChoices(context.remotes) },
        {
          key: "remoteBranch",
          label: "Remote branch",
          initial: saved?.remoteBranch ?? upstreamBranch ?? branch.name,
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
      onSubmit: async ({ remote, remoteBranch }, { setUpstream }) => {
        const destination = { branch: branch.name, remote, remoteBranch }
        if (!(await send(branch, context, destination, setUpstream))) return false
        const pushed = await pushContext(branch, { quiet: true })
        if (pushed !== null && canRememberPush(context, pushed, destination, setUpstream))
          setPreferences((stored) => rememberPushDestination(stored, pushed, destination))
        return true
      },
    })
  }

  const push = async (branch: Branch | undefined, shown?: PushDestination | null) => {
    if (branch === undefined) {
      toast.error("Check out a branch with a commit before pushing.")
      return
    }
    const context = await pushContext(branch)
    if (context === null) return
    const saved = savedPushDestination(registry.get(syncPreferencesAtom(repo)), context)
    if (saved === null || (shown !== undefined && !sameDestination(saved, shown))) {
      choosePushDestination(branch, context)
      return
    }
    await send(branch, context, saved, false)
  }

  const pullFrom = () => {
    if (current === undefined) {
      toast.error("Check out a branch with a commit before pulling.")
      return undefined
    }
    if (current.upstream === null) {
      if (hasRemotes()) changeUpstream(current)
      return undefined
    }
    return { target: { branch: current.name, upstream: current.upstream.ref }, upstream: current.upstream.name }
  }

  return {
    manageRemotes: () => openRemotes(true),
    changeUpstream,
    push: (shown?: PushDestination | null) => push(current, shown),
    pushTo: (branch = current) => push(branch, null),
    pull: () => {
      const from = pullFrom()
      if (from !== undefined)
        void network.run({ action: "Pull", target: from.target, strategy: preferences.pullStrategy })
    },
    pullWith: () => {
      const from = pullFrom()
      if (from === undefined) return
      prompt({
        title: `Pull into ${from.target.branch}`,
        description: `Pull from ${from.upstream}. Fast-forward only stops if the branches diverge. Merge combines their history. Rebase replays your local commits on top. Use Git configuration follows your pull.rebase and pull.ff settings. Pull uses your choice in this repository from now on.`,
        fields: [{ key: "strategy", label: "Pull strategy", initial: preferences.pullStrategy, choices: pullChoices }],
        submitLabel: "Pull",
        onSubmit: ({ strategy }) => {
          const pullStrategy = pullChoices.find((choice) => choice.value === strategy)!.value
          setPreferences((stored) => ({ ...stored, pullStrategy }))
          return network.run({ action: "Pull", target: from.target, strategy: pullStrategy })
        },
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
