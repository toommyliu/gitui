import type { PushContext, PushDestination, Refs, RemoteBranch } from "@gitui/contracts"
import type { Outcome, Repo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import {
  canRememberPush,
  pushPlan,
  rememberPushDestination,
  syncPreferences,
  updateSyncPreferences,
} from "@/lib/sync-preferences"
import type { Failure } from "../ui"

export interface ForcePush {
  readonly destination: PushDestination
  readonly expected: RemoteBranch["oid"]
  readonly target: string
}

export const loadPushContext = (repo: Repo, branch: string) =>
  call((git) => git.GetPushContext({ repo: repo.id, branch }))

export const readPushContext = async (
  repo: Repo,
  branch: string,
): Promise<{ readonly context: PushContext } | { readonly failure: Failure }> => {
  try {
    return { context: await loadPushContext(repo, branch) }
  } catch (error) {
    return { failure: { title: "Couldn't read the push settings", message: describeError(error) } }
  }
}

export const sendPush = async (
  repo: Repo,
  context: PushContext,
  destination: PushDestination,
  setUpstream: boolean,
): Promise<{ readonly outcome: Outcome; readonly changed: PushContext | null }> => {
  const outcome = await repo.stream("push", (git) =>
    git.Push({ repo: repo.id, destination, setUpstream, expectedContext: context.fingerprint }),
  )
  const after = await loadPushContext(repo, context.branch).catch(() => null)
  if (outcome.ok && after !== null && canRememberPush(context, after, destination, setUpstream))
    updateSyncPreferences(repo.id, (stored) => rememberPushDestination(stored, after, destination))
  return { outcome, changed: after !== null && after.fingerprint !== context.fingerprint ? after : null }
}

export const pushBranch = async (
  repo: Repo,
  branch: string,
): Promise<{ readonly failure: Failure | null; readonly choose: PushContext | null }> => {
  const read = await readPushContext(repo, branch)
  if ("failure" in read) return { failure: read.failure, choose: null }
  const plan = pushPlan(syncPreferences(repo.id), read.context)
  if (plan === null) return { failure: null, choose: read.context }
  const { outcome, changed } = await sendPush(repo, read.context, plan.destination, plan.setUpstream)
  return { failure: outcome.ok ? null : { title: "Push failed", message: outcome.message }, choose: changed }
}

export const forcePushTarget = (refs: Refs, branch: string): ForcePush | null => {
  const upstream = refs.branches.find((candidate) => candidate.name === branch)?.upstream ?? null
  if (upstream?._tag !== "Tracking") return null
  const remote = refs.remoteBranches.find((candidate) => `refs/remotes/${candidate.name}` === upstream.ref)
  if (remote === undefined) return null
  return {
    target: upstream.name,
    expected: remote.oid,
    destination: { branch, remote: remote.remote, remoteBranch: remote.name.slice(remote.remote.length + 1) },
  }
}
