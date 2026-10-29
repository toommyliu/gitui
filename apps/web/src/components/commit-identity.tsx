import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { CommitIdentity, RepoId, Signature } from "@gitui/contracts"
import * as Exit from "effect/Exit"
import { CircleAlertIcon, KeyRoundIcon, PencilIcon, UserIcon } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { identityAtom, identityKey, saveIdentityAtom } from "@/lib/commit-workflow"
import { describeFailure, latest, loadError } from "@/lib/git"
import { useRefreshOnFocus } from "@/lib/worktrees"

type SigningFormat = CommitIdentity["signingFormat"]

const formatLabels: Record<SigningFormat, string> = { openpgp: "OpenPGP", ssh: "SSH", x509: "X.509" }

const formats = ["openpgp", "ssh", "x509"] as const satisfies ReadonlyArray<SigningFormat>

const signingChoices = ["inherit", "on", "off"] as const

const keyDescriptions: Record<SigningFormat, string> = {
  openpgp: "GnuPG key ID or fingerprint.",
  ssh: "Path to a public key file, or the public key itself.",
  x509: "Certificate ID or fingerprint for gpgsm.",
}

const person = (name: string, email: string) => `${name} <${email}>`

export function IdentityLine({
  repo,
  amending,
  originalAuthor,
  onEdit,
}: {
  repo: RepoId
  amending: boolean
  originalAuthor: Signature | undefined
  onEdit: () => void
}) {
  useRefreshOnFocus([identityKey(repo)])
  const result = useAtomValue(identityAtom(repo))
  const identity = latest(result)
  const missing =
    identity !== undefined &&
    (identity.committerName === "" ||
      identity.committerEmail === "" ||
      (!amending && (identity.name === "" || identity.email === "")))
  const author = amending ? originalAuthor : identity
  const content: ReactNode =
    identity === undefined ? (
      loadError(result) === undefined ? (
        <span className="truncate text-muted-foreground">Loading author…</span>
      ) : (
        <>
          <CircleAlertIcon className="size-3 shrink-0 text-destructive" />
          <span className="truncate text-destructive">Couldn't read your Git identity</span>
        </>
      )
    ) : missing ? (
      <>
        <CircleAlertIcon className="size-3 shrink-0 text-destructive" />
        <span className="truncate text-destructive">Set a name and email to commit</span>
      </>
    ) : (
      <>
        <UserIcon className="size-3 shrink-0" />
        <span className="truncate">
          {author === undefined ? "Loading author…" : person(author.name, author.email)}
          {amending && author !== undefined && <span className="text-muted-foreground/70"> · original author</span>}
        </span>
        {identity.signing ? (
          <span className="flex shrink-0 items-center gap-1">
            <KeyRoundIcon className="size-3" />
            Sign with {formatLabels[identity.signingFormat]}
          </span>
        ) : (
          <span className="shrink-0">Signing off</span>
        )}
      </>
    )
  return (
    <button
      type="button"
      onClick={onEdit}
      className="group/identity -mx-1 flex h-5 max-w-[calc(100%+0.5rem)] min-w-0 items-center gap-1.5 rounded-sm px-1 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {content}
      <PencilIcon className="size-3 shrink-0 opacity-0 group-hover/identity:opacity-100 group-focus-visible/identity:opacity-100" />
      <span className="sr-only">Edit commit identity</span>
    </button>
  )
}

export function IdentityDialog({
  repo,
  open,
  onOpenChange,
}: {
  repo: RepoId
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-md">
        {open && <IdentityContent repo={repo} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function IdentityContent({ repo, onClose }: { repo: RepoId; onClose: () => void }) {
  const result = useAtomValue(identityAtom(repo))
  const refresh = useAtomRefresh(identityAtom(repo))
  const identity = latest(result)
  if (identity !== undefined) return <IdentityForm repo={repo} identity={identity} onClose={onClose} />
  const error = loadError(result)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Commit identity</DialogTitle>
      </DialogHeader>
      {error === undefined ? (
        <p className="text-muted-foreground">Loading identity…</p>
      ) : (
        <>
          <p role="alert" className="whitespace-pre-line text-destructive">
            {error}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={refresh}>Try again</Button>
          </DialogFooter>
        </>
      )}
    </>
  )
}

const selectClassName =
  "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"

const inherited = (local: unknown, effective: string) =>
  local === null ? `Use inherited setting (${effective})` : "Use inherited setting"

const blank = (value: string) => (value.trim() === "" ? null : value.trim())

function IdentityForm({ repo, identity, onClose }: { repo: RepoId; identity: CommitIdentity; onClose: () => void }) {
  const id = useId()
  const { local } = identity
  const [name, setName] = useState(local.name ?? "")
  const [email, setEmail] = useState(local.email ?? "")
  const [signing, setSigning] = useState<(typeof signingChoices)[number]>(
    local.signing === null ? "inherit" : local.signing ? "on" : "off",
  )
  const [signingKey, setSigningKey] = useState(local.signingKey ?? "")
  const [format, setFormat] = useState<"inherit" | SigningFormat>(local.signingFormat ?? "inherit")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = useAtomSet(saveIdentityAtom, { mode: "promiseExit" })
  const committerDiffers = identity.committerName !== identity.name || identity.committerEmail !== identity.email
  const overridden = [
    local.name !== null && local.name !== identity.name ? "name" : null,
    local.email !== null && local.email !== identity.email ? "email" : null,
  ].filter((field) => field !== null)

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy) return
        setBusy(true)
        setError(null)
        void save({
          repo,
          settings: {
            name: blank(name),
            email: blank(email),
            signing: signing === "inherit" ? null : signing === "on",
            signingKey: blank(signingKey),
            signingFormat: format === "inherit" ? null : format,
          },
        }).then((exit) => {
          setBusy(false)
          if (Exit.isSuccess(exit)) onClose()
          else setError(describeFailure(exit.cause))
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>Commit identity</DialogTitle>
        <DialogDescription>
          These settings apply to this repository only. Leave a field empty to inherit your Git config.
        </DialogDescription>
      </DialogHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-3">
        <dt className="text-muted-foreground">Author</dt>
        <dd className="min-w-0 font-mono break-all">
          {identity.name === "" && identity.email === "" ? "Not set" : person(identity.name, identity.email)}
        </dd>
        {committerDiffers && (
          <>
            <dt className="text-muted-foreground">Committer</dt>
            <dd className="min-w-0 font-mono break-all">{person(identity.committerName, identity.committerEmail)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Signing</dt>
        <dd className="min-w-0 break-all">
          {identity.signing ? (
            <>
              {formatLabels[identity.signingFormat]} with <span className="font-mono">{identity.signingProgram}</span>
              {identity.signingKey !== "" && (
                <span className="block font-mono text-muted-foreground">{identity.signingKey}</span>
              )}
            </>
          ) : (
            "Off"
          )}
        </dd>
      </dl>
      {overridden.length > 0 && (
        <p className="text-muted-foreground">Another Git setting overrides the saved {overridden.join(" and ")}.</p>
      )}
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={name}
            placeholder={local.name === null ? identity.name : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            placeholder={local.email === null ? identity.email : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-signing`}>Signing</FieldLabel>
          <select
            id={`${id}-signing`}
            value={signing}
            onChange={(event) =>
              setSigning(signingChoices.find((choice) => choice === event.target.value) ?? "inherit")
            }
            className={selectClassName}
          >
            <option value="inherit">{inherited(local.signing, identity.signing ? "on" : "off")}</option>
            <option value="on">Sign commits</option>
            <option value="off">Don't sign commits</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-format`}>Signature format</FieldLabel>
          <select
            id={`${id}-format`}
            value={format}
            onChange={(event) => setFormat(formats.find((value) => value === event.target.value) ?? "inherit")}
            className={selectClassName}
          >
            <option value="inherit">{inherited(local.signingFormat, formatLabels[identity.signingFormat])}</option>
            {formats.map((value) => (
              <option key={value} value={value}>
                {formatLabels[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-key`}>Signing key</FieldLabel>
          <Input
            id={`${id}-key`}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            value={signingKey}
            placeholder={local.signingKey === null && identity.signingKey !== "" ? identity.signingKey : undefined}
            aria-describedby={`${id}-key-description`}
            onChange={(event) => setSigningKey(event.target.value)}
          />
          <FieldDescription id={`${id}-key-description`}>
            {keyDescriptions[format === "inherit" ? identity.signingFormat : format]}
          </FieldDescription>
        </Field>
      </FieldGroup>
      {error !== null && (
        <FieldError role="alert" className="whitespace-pre-line">
          {error}
        </FieldError>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner data-icon="inline-start" />}
          Save identity
        </Button>
      </DialogFooter>
    </form>
  )
}
