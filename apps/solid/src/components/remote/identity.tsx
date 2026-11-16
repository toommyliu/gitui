import type { CommitIdentity, IdentitySettings } from "@gitui/contracts"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { FieldDescription } from "@ui-sdk/solid/field"
import { Input } from "@ui-sdk/solid/input"
import { createSignal, Match, Show, Switch, untrack } from "solid-js"
import { useCommand } from "@/lib/hotkeys"
import { useRepo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import { Spinner } from "../state"
import { Alert, Button, type Failure } from "../ui"
import { Actions, FailureAlert, FormField, SelectField } from "./form"

type SigningFormat = CommitIdentity["signingFormat"]

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly identity: CommitIdentity }
  | { readonly kind: "failed"; readonly message: string }

const formatLabels: Record<SigningFormat, string> = { openpgp: "OpenPGP", ssh: "SSH", x509: "X.509" }

const formats: ReadonlyArray<SigningFormat> = ["openpgp", "ssh", "x509"]

const keyHints: Record<SigningFormat, string> = {
  openpgp: "A GnuPG key ID or fingerprint.",
  ssh: "A path to a public key file, or the public key itself.",
  x509: "A certificate ID or fingerprint for gpgsm.",
}

type Signing = "inherit" | "on" | "off"

const source = (local: unknown) => (local === null ? "Inherited" : "This repository")

const inherit = (local: unknown, effective: string) => (local === null ? `Inherit (${effective})` : "Inherit")

const person = (name: string, email: string) => (name === "" && email === "" ? "Not set" : `${name} <${email}>`)

const blank = (value: string) => (value.trim() === "" ? null : value.trim())

export function IdentityDialog() {
  const repo = useRepo()
  const [open, setOpen] = createSignal(false)
  const [load, setLoad] = createSignal<Load>({ kind: "loading" })
  const [saving, setSaving] = createSignal(false)

  const read = async () => {
    setLoad({ kind: "loading" })
    try {
      setLoad({ kind: "ready", identity: await call((git) => git.GetCommitIdentity({ repo: repo.id })) })
    } catch (error) {
      setLoad({ kind: "failed", message: describeError(error) })
    }
  }

  useCommand("repo.identity", () => {
    setOpen(true)
    void read()
  })

  const ready = () => {
    const current = load()
    return current.kind === "ready" ? current.identity : null
  }
  const failed = () => {
    const current = load()
    return current.kind === "failed" ? current.message : null
  }

  return (
    <Dialog open={open()} onOpenChange={(next) => !saving() && setOpen(next)}>
      <DialogBackdrop />
      <DialogContent class="w-[min(28rem,calc(100%-2rem))]">
        <div class="flex flex-col gap-1">
          <DialogTitle>Commit identity</DialogTitle>
          <DialogDescription>
            Applies to this repository only. Leave a field empty to inherit it from your Git config.
          </DialogDescription>
        </div>
        <Switch>
          <Match when={ready()} keyed>
            {(identity) => (
              <IdentityForm
                identity={identity}
                saving={saving()}
                onSavingChange={setSaving}
                onClose={() => setOpen(false)}
              />
            )}
          </Match>
          <Match when={failed()}>
            {(message) => (
              <>
                <Alert tone="error" title="Couldn't read your Git identity">
                  {message()}
                </Alert>
                <div class="flex justify-end gap-1.5">
                  <Button onClick={() => setOpen(false)}>Close</Button>
                  <Button variant="primary" onClick={() => void read()}>
                    Try again
                  </Button>
                </div>
              </>
            )}
          </Match>
          <Match when={load().kind === "loading"}>
            <div class="flex h-24 items-center justify-center gap-2 text-muted-foreground">
              <Spinner />
              Reading your identity
            </div>
          </Match>
        </Switch>
      </DialogContent>
    </Dialog>
  )
}

function IdentityForm(props: {
  identity: CommitIdentity
  saving: boolean
  onSavingChange: (saving: boolean) => void
  onClose: () => void
}) {
  const repo = useRepo()
  const identity = untrack(() => props.identity)
  const { local } = identity
  const [name, setName] = createSignal(local.name ?? "")
  const [email, setEmail] = createSignal(local.email ?? "")
  const [signing, setSigning] = createSignal<Signing>(local.signing === null ? "inherit" : local.signing ? "on" : "off")
  const [format, setFormat] = createSignal<SigningFormat | "inherit">(local.signingFormat ?? "inherit")
  const [signingKey, setSigningKey] = createSignal(local.signingKey ?? "")
  const [submitted, setSubmitted] = createSignal(false)
  const [failure, setFailure] = createSignal<Failure | null>(null)

  const committerDiffers = identity.committerName !== identity.name || identity.committerEmail !== identity.email
  const overridden = [
    local.name !== null && local.name !== identity.name ? "name" : null,
    local.email !== null && local.email !== identity.email ? "email" : null,
  ].filter((field) => field !== null)

  const nameProblem = () => (/[<>\n]/.test(name()) ? "Leave out angle brackets." : null)
  const emailProblem = () => {
    const value = email().trim()
    if (/[<>\s]/.test(value)) return "Leave out spaces and angle brackets."
    return value === "" || value.includes("@") ? null : "Enter an email address like ada@example.com."
  }

  const nameError = () => (submitted() ? nameProblem() : null)
  const emailError = () => (submitted() ? emailProblem() : null)

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (props.saving) return
    setSubmitted(true)
    setFailure(null)
    if (nameProblem() !== null || emailProblem() !== null) return
    const chosenFormat = format()
    const settings: IdentitySettings = {
      name: blank(name()),
      email: blank(email()),
      signing: signing() === "inherit" ? null : signing() === "on",
      signingKey: blank(signingKey()),
      signingFormat: chosenFormat === "inherit" ? null : chosenFormat,
    }
    props.onSavingChange(true)
    try {
      await call((git) => git.SetCommitIdentity({ repo: repo.id, settings }))
      props.onClose()
    } catch (error) {
      setFailure({ title: "Couldn't save your identity", message: describeError(error) })
    } finally {
      props.onSavingChange(false)
      repo.invalidate(["refs"])
    }
  }

  const effectiveFormat = () => {
    const chosen = format()
    return chosen === "inherit" ? identity.signingFormat : chosen
  }

  return (
    <form novalidate class="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border px-2.5 py-2">
        <dt class="text-muted-foreground">Author</dt>
        <dd class="min-w-0 font-mono break-all">{person(identity.name, identity.email)}</dd>
        <Show when={committerDiffers}>
          <dt class="text-muted-foreground">Committer</dt>
          <dd class="min-w-0 font-mono break-all">{person(identity.committerName, identity.committerEmail)}</dd>
        </Show>
        <dt class="text-muted-foreground">Signing</dt>
        <dd class="min-w-0 break-all">
          <Show when={identity.signing} fallback="Off">
            {formatLabels[identity.signingFormat]} with <span class="font-mono">{identity.signingProgram}</span>
            <Show when={identity.signingKey !== ""}>
              <span class="block font-mono text-muted-foreground">{identity.signingKey}</span>
            </Show>
          </Show>
        </dd>
      </dl>
      <Show when={overridden.length > 0}>
        <Alert tone="warning">
          An environment variable or another Git setting overrides the saved {overridden.join(" and ")}.
        </Alert>
      </Show>
      <div class="grid grid-cols-2 gap-3">
        <FormField label="Name" source={source(local.name)} error={nameError()}>
          <Input
            autofocus
            autocomplete="off"
            spellcheck={false}
            value={name()}
            placeholder={local.name === null ? identity.name : ""}
            onValueChange={(value) => setName(value)}
            class="aria-invalid:border-destructive"
          />
        </FormField>
        <FormField label="Email" source={source(local.email)} error={emailError()}>
          <Input
            type="email"
            autocomplete="off"
            spellcheck={false}
            value={email()}
            placeholder={local.email === null ? identity.email : ""}
            onValueChange={(value) => setEmail(value)}
            class="aria-invalid:border-destructive"
          />
        </FormField>
        <SelectField<Signing>
          label="Signing"
          source={source(local.signing)}
          value={signing()}
          options={[
            { value: "inherit", label: inherit(local.signing, identity.signing ? "on" : "off") },
            { value: "on", label: "Sign commits" },
            { value: "off", label: "Don't sign" },
          ]}
          onChange={setSigning}
        />
        <SelectField<SigningFormat | "inherit">
          label="Signature format"
          source={source(local.signingFormat)}
          value={format()}
          options={[
            { value: "inherit", label: inherit(local.signingFormat, formatLabels[identity.signingFormat]) },
            ...formats.map((value) => ({ value, label: formatLabels[value] })),
          ]}
          onChange={setFormat}
        />
      </div>
      <FormField label="Signing key" source={source(local.signingKey)}>
        <Input
          autocomplete="off"
          spellcheck={false}
          value={signingKey()}
          placeholder={local.signingKey === null ? identity.signingKey : ""}
          onValueChange={(value) => setSigningKey(value)}
          class="font-mono"
        />
        <FieldDescription class="text-2xs text-muted-foreground">{keyHints[effectiveFormat()]}</FieldDescription>
      </FormField>
      <FailureAlert failure={failure()} onDismiss={() => setFailure(null)} />
      <Actions pending={props.saving} submitLabel="Save identity" onCancel={props.onClose} />
    </form>
  )
}
