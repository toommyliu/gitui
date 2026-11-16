import { DirectoryNotFound, RepoNotFound } from "@gitui/contracts"
import { basename } from "@/lib/format"
import { describeError } from "@/lib/rpc"
import { forgetRepo, OpenRepoFailed, type Workspace } from "@/lib/workspaces"
import { Centered } from "./state"
import { Alert, Button } from "./ui"

const explain = (name: string, error: unknown) => {
  if (error instanceof DirectoryNotFound)
    return { title: `${name}'s folder is gone`, detail: "It was moved or deleted, or its worktree was removed." }
  if (error instanceof RepoNotFound)
    return { title: `${name} isn't a Git repository`, detail: "The folder exists but has no Git repository in it." }
  return { title: `Couldn't open ${name}`, detail: describeError(error) }
}

export const shortReason = (error: unknown) => {
  const reason = error instanceof OpenRepoFailed ? error.reason : error
  if (reason instanceof DirectoryNotFound) return "Folder missing"
  if (reason instanceof RepoNotFound) return "Not a repository"
  return "Can't open"
}

export function OpenFailure(props: { workspace: Workspace; error: unknown; reset: () => void }) {
  const reason = () => explain(basename(props.workspace.path), props.error)
  return (
    <Centered>
      <div class="flex w-full max-w-md flex-col gap-2 text-start">
        <Alert tone="error" title={reason().title}>
          <span class="flex flex-col gap-1">
            <span>{reason().detail}</span>
            <span class="font-mono text-2xs break-all select-text">{props.workspace.path}</span>
          </span>
        </Alert>
        <p class="text-2xs">Removing it only takes it off this list. Nothing on disk changes.</p>
        <div class="flex justify-end gap-1.5">
          <Button
            onClick={() => {
              props.workspace.retry()
              props.reset()
            }}
          >
            Try again
          </Button>
          <Button variant="primary" onClick={() => forgetRepo(props.workspace.path)}>
            Remove from list
          </Button>
        </div>
      </div>
    </Centered>
  )
}
