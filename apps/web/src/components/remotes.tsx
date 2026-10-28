import { useAtom, useAtomValue } from "@effect/atom-react"
import type { Remote, RepoId } from "@gitui/contracts"
import * as Atom from "effect/reactivity/Atom"
import * as Exit from "effect/Exit"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { describeFailure, latest, refsAtom, useRunGitAction } from "@/lib/git"

export const remotesOpenAtom = Atom.family((_repo: RepoId) => Atom.make(false))

type View = { kind: "list" } | { kind: "edit"; remote: Remote | null } | { kind: "remove"; remote: Remote }

export function RemotesDialog({ repo }: { repo: RepoId }) {
  const [open, setOpen] = useAtom(remotesOpenAtom(repo))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-lg">
        {open && <RemotesContent repo={repo} onClose={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function RemotesContent({ repo, onClose }: { repo: RepoId; onClose: () => void }) {
  const refs = latest(useAtomValue(refsAtom(repo)))
  const [view, setView] = useState<View>({ kind: "list" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useRunGitAction()
  const show = (next: View) => {
    setError(null)
    setView(next)
  }
  if (view.kind === "edit")
    return (
      <RemoteForm
        key={view.remote?.name ?? "new"}
        repo={repo}
        remote={view.remote}
        onDone={() => show({ kind: "list" })}
      />
    )
  if (view.kind === "remove")
    return (
      <>
        <DialogHeader>
          <DialogTitle>Remove {view.remote.name}?</DialogTitle>
          <DialogDescription>
            Remove this remote's configuration and local tracking references. Branches on the server stay in place.
          </DialogDescription>
        </DialogHeader>
        {error !== null && <FieldError role="alert">{error}</FieldError>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => show({ kind: "list" })}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void run(repo, (c) => c("RemoveRemote", { repo, name: view.remote.name })).then((exit) => {
                setBusy(false)
                if (Exit.isSuccess(exit)) show({ kind: "list" })
                else setError(describeFailure(exit.cause))
              })
            }}
          >
            {busy && <Spinner />}Remove remote
          </Button>
        </DialogFooter>
      </>
    )
  return (
    <>
      <DialogHeader>
        <DialogTitle>Remotes</DialogTitle>
        <DialogDescription>Manage where this repository fetches and publishes changes.</DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[min(24rem,55dvh)] gap-3 overflow-y-auto overscroll-contain pe-1 pb-1">
        {refs === undefined ? (
          <p className="text-sm text-muted-foreground">Loading remotes…</p>
        ) : refs.remotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No remotes yet. Add a remote to fetch or publish changes.</p>
        ) : (
          refs.remotes.map((remote) => (
            <div key={remote.name} className="rounded-md border p-3">
              <p className="font-mono text-sm font-medium break-all">{remote.name}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Fetch</dt>
                <dd className="min-w-0 font-mono break-all whitespace-pre-line">{remote.urls.join("\n")}</dd>
                <dt className="text-muted-foreground">Push</dt>
                <dd className="min-w-0 font-mono break-all whitespace-pre-line">
                  {(remote.pushUrls.length > 0 ? remote.pushUrls : remote.urls).join("\n")}
                </dd>
              </dl>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Edit ${remote.name}`}
                  onClick={() => show({ kind: "edit", remote })}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${remote.name}`}
                  onClick={() => show({ kind: "remove", remote })}
                >
                  Remove…
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      <DialogFooter className="border-t pt-4">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => show({ kind: "edit", remote: null })}>Add remote</Button>
      </DialogFooter>
    </>
  )
}

function RemoteForm({ repo, remote, onDone }: { repo: RepoId; remote: Remote | null; onDone: () => void }) {
  const id = useId()
  const [name, setName] = useState(remote?.name ?? "origin")
  const [urls, setUrls] = useState(remote?.urls.join("\n") ?? "")
  const [pushUrls, setPushUrls] = useState(remote?.pushUrls.join("\n") ?? "")
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useRunGitAction()
  const lines = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  const nameInvalid = submitted && name.trim() === ""
  const urlsInvalid = submitted && lines(urls).length === 0
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        setSubmitted(true)
        setError(null)
        const next = { name: name.trim(), urls: lines(urls), pushUrls: lines(pushUrls) }
        if (next.name === "" || next.urls.length === 0) {
          const control = event.currentTarget.elements.namedItem(next.name === "" ? "remote-name" : "fetch-urls")
          if (control instanceof HTMLElement) control.focus()
          return
        }
        setBusy(true)
        void run(repo, (c) =>
          remote === null
            ? c("AddRemote", { repo, remote: next })
            : c("EditRemote", { repo, name: remote.name, remote: next }),
        ).then((exit) => {
          setBusy(false)
          if (Exit.isSuccess(exit)) onDone()
          else setError(describeFailure(exit.cause))
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>{remote === null ? "Add remote" : `Edit ${remote.name}`}</DialogTitle>
        <DialogDescription>Enter one URL per line. Leave push URLs empty to use the fetch URLs.</DialogDescription>
      </DialogHeader>
      <Field data-invalid={nameInvalid}>
        <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
        <Input
          id={`${id}-name`}
          name="remote-name"
          required
          aria-invalid={nameInvalid}
          aria-describedby={nameInvalid ? `${id}-name-error` : undefined}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {nameInvalid && <FieldError id={`${id}-name-error`}>Enter a remote name.</FieldError>}
      </Field>
      <Field data-invalid={urlsInvalid}>
        <FieldLabel htmlFor={`${id}-urls`}>Fetch URLs</FieldLabel>
        <Textarea
          id={`${id}-urls`}
          name="fetch-urls"
          required
          aria-invalid={urlsInvalid}
          aria-describedby={urlsInvalid ? `${id}-urls-error` : undefined}
          value={urls}
          onChange={(event) => setUrls(event.target.value)}
          placeholder="git@github.com:owner/repository.git"
          spellCheck={false}
          rows={2}
        />
        {urlsInvalid && <FieldError id={`${id}-urls-error`}>Enter at least one fetch URL.</FieldError>}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-push-urls`}>
          Push URLs <span className="text-muted-foreground">optional</span>
        </FieldLabel>
        <Textarea
          id={`${id}-push-urls`}
          name="push-urls"
          value={pushUrls}
          onChange={(event) => setPushUrls(event.target.value)}
          spellCheck={false}
          rows={2}
        />
      </Field>
      {error !== null && (
        <FieldError role="alert" className="whitespace-pre-line">
          {error}
        </FieldError>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {remote === null ? "Add remote" : "Save remote"}
        </Button>
      </DialogFooter>
    </form>
  )
}
