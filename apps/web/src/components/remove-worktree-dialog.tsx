import type { RepoId, Worktree } from "@gitui/contracts"
import { useId, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { useGitAction } from "@/lib/git"

export function RemoveWorktreeDialog({
  repo,
  worktree,
  force,
  onClose,
}: {
  repo: RepoId
  worktree: Worktree
  force: boolean
  onClose: () => void
}) {
  const git = useGitAction()
  const [deleteBranch, setDeleteBranch] = useState(false)
  const checkboxId = useId()
  const action = force ? "Force remove" : "Remove"
  return (
    <AlertDialog open onOpenChange={(open) => open || onClose()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{action} worktree?</AlertDialogTitle>
          <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
            <p className="font-mono text-xs break-all">{worktree.path}</p>
            {force && (
              <p>
                Uncommitted and untracked files in this worktree will be deleted
                {deleteBranch ? ", along with any unmerged commits on the branch." : "."}
              </p>
            )}
            {worktree.head._tag === "Branch" && (
              <Field orientation="horizontal">
                <Checkbox id={checkboxId} checked={deleteBranch} onCheckedChange={setDeleteBranch} />
                <FieldLabel htmlFor={checkboxId} className="min-w-0 font-normal">
                  <span>
                    Also delete branch <span className="font-mono break-all">{worktree.head.name}</span>
                  </span>
                </FieldLabel>
              </Field>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onClose()
              void git("Remove worktree", repo, (c) =>
                c("RemoveWorktree", { repo, path: worktree.path, force, deleteBranch }),
              )
            }}
          >
            {deleteBranch ? `${action} and delete branch` : `${action} worktree`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
