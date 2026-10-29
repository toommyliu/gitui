import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { FileIdentity, Oid, RepoId, RepoPath } from "@gitui/contracts"
import * as Exit from "effect/Exit"
import { InfoIcon, TriangleAlertIcon } from "lucide-react"
import { useId, useState } from "react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { restorePreviewAtom, restorePreviewKey } from "@/lib/file-investigation"
import { literalPath } from "@/lib/literal-path"
import { basename, shortOid } from "@/lib/format"
import { describeFailure, useRunGitAction } from "@/lib/git"

interface RestoreProps {
  readonly repo: RepoId
  readonly source: FileIdentity
  readonly deletedIn: Oid | null
  readonly defaultDestination: RepoPath
}

export function RestoreDialog({
  open,
  onOpenChange,
  ...props
}: RestoreProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg">
        {open && <RestoreForm {...props} onClose={() => onOpenChange(false)} />}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function RestoreForm({ repo, source, deletedIn, defaultDestination, onClose }: RestoreProps & { onClose: () => void }) {
  const id = useId()
  const destinations = source.path === defaultDestination ? [defaultDestination] : [defaultDestination, source.path]
  const [destination, setDestination] = useState(defaultDestination)
  const atom = restorePreviewAtom(restorePreviewKey(repo, source, destination))
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const preview = result._tag === "Success" ? result.value : undefined
  const previewError = result._tag === "Failure" && !result.waiting ? describeFailure(result.cause) : undefined
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const run = useRunGitAction()
  const ready = preview !== undefined && preview.unavailable === null && !result.waiting && !busy
  const overwrite = preview?.overwrite === true

  const restore = async () => {
    if (preview === undefined || !ready) return
    setBusy(true)
    setFailure(null)
    const exit = await run(repo, (client) =>
      client("RestoreFile", {
        repo,
        source: preview.source,
        destination: preview.destination,
        expectedVersion: preview.version,
        overwrite: preview.overwrite,
      }),
    )
    setBusy(false)
    if (Exit.isSuccess(exit)) {
      toast.success(`Restored ${preview.destination}`, {
        description: `From commit ${shortOid(preview.source.revision)}. The index is unchanged.`,
      })
      onClose()
      return
    }
    setFailure(describeFailure(exit.cause))
    refresh()
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="break-all">
          Restore {basename(source.path)} from {shortOid(source.revision)}?
        </AlertDialogTitle>
        <AlertDialogDescription>
          This writes the file from that commit into your working tree. The index isn't changed, so anything you've
          staged stays staged.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 select-text [&_dt]:text-muted-foreground">
        <dt>Source commit</dt>
        <dd className="font-mono break-all select-all">{source.revision}</dd>
        {deletedIn !== null && (
          <>
            <dt>Deleted in</dt>
            <dd className="font-mono break-all select-all">{deletedIn}</dd>
          </>
        )}
        <dt>Source path</dt>
        <dd className="break-all">{literalPath(source.path)}</dd>
        {destinations.length === 1 && (
          <>
            <dt>Destination</dt>
            <dd className="break-all">{literalPath(destination)}</dd>
          </>
        )}
      </dl>
      {destinations.length > 1 && (
        <fieldset className="grid gap-2" disabled={busy}>
          <legend className="mb-2 text-xs font-medium">Destination in the working tree</legend>
          {destinations.map((path, index) => (
            <label key={path} className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name={`${id}-destination`}
                value={path}
                checked={destination === path}
                onChange={() => {
                  setDestination(path)
                  setFailure(null)
                }}
                className="mt-1 accent-primary"
              />
              <span className="min-w-0">
                <span className="block break-all">{literalPath(path)}</span>
                <span className="block text-muted-foreground">
                  {index === 0 ? "The path you're investigating" : "The file's path in this commit"}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {preview === undefined ? (
        previewError === undefined ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Spinner />
            Checking {destination}…
          </p>
        ) : (
          <div className="grid justify-items-start gap-2">
            <p role="alert" className="whitespace-pre-line text-destructive">
              Couldn't check the destination. {previewError}
            </p>
            <Button size="sm" variant="outline" onClick={refresh}>
              Check again
            </Button>
          </div>
        )
      ) : preview.unavailable !== null ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>This version can't be restored</AlertTitle>
          <AlertDescription>{preview.unavailable}</AlertDescription>
        </Alert>
      ) : overwrite ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Your local work will be overwritten</AlertTitle>
          <AlertDescription className="break-words">
            Restoring replaces {literalPath(preview.destination)} in your working tree. Its current contents will be
            replaced. Any unstaged changes will be lost. Staged content stays in the index.
          </AlertDescription>
        </Alert>
      ) : null}
      {failure !== null && (
        <p role="alert" className="whitespace-pre-line text-destructive">
          {failure}
        </p>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
        <Button variant={overwrite ? "destructive" : "default"} disabled={!ready} onClick={() => void restore()}>
          {busy && <Spinner data-icon="inline-start" />}
          {overwrite ? "Overwrite and restore" : "Restore file"}
        </Button>
      </AlertDialogFooter>
    </>
  )
}
