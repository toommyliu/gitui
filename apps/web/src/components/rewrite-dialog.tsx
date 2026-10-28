import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { RewriteAction, type RepoId, type RewritePlan, type RewriteStep } from "@gitui/contracts"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { describeFailure, latest, loadError, statusAtom } from "@/lib/git"
import { shortOid } from "@/lib/format"
import { rewriteOpenAtom, rewritePlanAtom, startRewriteAtom, type RewriteEntry } from "@/lib/rewrite"

const labels: Record<RewriteAction, string> = {
  pick: "Pick",
  reword: "Reword",
  squash: "Squash",
  fixup: "Fixup",
  edit: "Edit / split",
  drop: "Drop",
}
const parseAction = Schema.decodeUnknownSync(RewriteAction)

export function RewriteDialog({ repo, onWorktree }: { repo: RepoId; onWorktree: () => void }) {
  const [entry, setEntry] = useAtom(rewriteOpenAtom(repo))
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) setEntry(null)
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-2xl">
        {entry !== null && (
          <LoadPlan repo={repo} entry={entry} onClose={() => setEntry(null)} onWorktree={onWorktree} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function LoadPlan({
  repo,
  entry,
  onClose,
  onWorktree,
}: {
  repo: RepoId
  entry: RewriteEntry
  onClose: () => void
  onWorktree: () => void
}) {
  const atom = rewritePlanAtom(`${repo}\n${entry.first}`)
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const plan = latest(result)
  const error = loadError(result)
  if (plan !== undefined)
    return <PlanEditor repo={repo} plan={plan} entry={entry} onClose={onClose} onWorktree={onWorktree} />
  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit commits</DialogTitle>
        <DialogDescription>Edit this commit and every later commit on the checked-out branch.</DialogDescription>
      </DialogHeader>
      {error === undefined ? <p role="status">Loading commits…</p> : <FieldError role="alert">{error}</FieldError>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        {error !== undefined && <Button onClick={refresh}>Try again</Button>}
      </DialogFooter>
    </>
  )
}

function PlanEditor({
  repo,
  plan: latestPlan,
  entry,
  onClose,
  onWorktree,
}: {
  repo: RepoId
  plan: RewritePlan
  entry: RewriteEntry
  onClose: () => void
  onWorktree: () => void
}) {
  const [plan] = useState(latestPlan)
  const [steps, setSteps] = useState<ReadonlyArray<RewriteStep>>(() =>
    plan.commits.map((commit) => ({
      oid: commit.oid,
      message: commit.message,
      action: commit.oid === entry.target ? entry.action : "pick",
    })),
  )
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moved, setMoved] = useState("")
  const run = useAtomSet(startRewriteAtom, { mode: "promiseExit" })
  const status = latest(useAtomValue(statusAtom(repo)))
  const paused = status?.operation === "rebase"
  const published = plan.commits.filter((commit) => commit.published)
  const commitById = new Map(plan.commits.map((commit) => [commit.oid, commit]))
  const update = (index: number, change: Partial<RewriteStep>) => {
    setSteps(steps.map((step, i) => (i === index ? { ...step, ...change } : step)))
    setError(null)
  }
  const move = (index: number, delta: number) => {
    const next = [...steps]
    const step = next.splice(index, 1)[0]!
    next.splice(index + delta, 0, step)
    setSteps(next)
    setMoved(`Moved ${shortOid(step.oid)} to position ${index + delta + 1} of ${steps.length}.`)
    setError(null)
  }
  const submit = async () => {
    setBusy(true)
    setError(null)
    const exit = await run({
      repo,
      request: {
        branch: plan.branch,
        head: plan.head,
        first: entry.first,
        steps,
        allowPublished: acknowledged,
      },
    })
    setBusy(false)
    if (Exit.isFailure(exit)) {
      setError(describeFailure(exit.cause))
      return
    }
    toast.success(exit.value.paused ? "Rebase paused" : "History updated", {
      description: `Original history saved at ${exit.value.backupRef}`,
      duration: 10000,
    })
    if (exit.value.paused) onWorktree()
    onClose()
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit commits on {plan.branch}</DialogTitle>
        <DialogDescription>
          Git applies this plan from top to bottom. Editing a commit rewrites its later commits too. The original
          history is saved in a recovery ref before starting.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 text-muted-foreground">
        <p>
          Squash combines both messages. Fixup keeps the previous message. Edit / split pauses so you can amend or
          create replacement commits.
        </p>
        <p className="font-mono text-[11px]">
          {plan.base === null ? "Root" : shortOid(plan.base)} → {shortOid(plan.head)} · {steps.length}{" "}
          {steps.length === 1 ? "commit" : "commits"}
        </p>
      </div>
      <p role="status" className="sr-only">
        {moved}
      </p>
      <fieldset disabled={busy} className="max-h-[45dvh] min-w-0 space-y-2 overflow-y-auto overscroll-contain p-1">
        <legend className="sr-only">Rebase plan, oldest commit first</legend>
        {steps.map((step, index) => (
          <div key={step.oid} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`rewrite-action-${step.oid}`}>
                Action for {shortOid(step.oid)}
              </label>
              <select
                id={`rewrite-action-${step.oid}`}
                className="min-h-8 rounded-md border bg-background px-2 text-xs"
                value={step.action}
                onChange={(event) => update(index, { action: parseAction(event.target.value) })}
              >
                {Object.entries(labels).map(([action, label]) => (
                  <option key={action} value={action}>
                    {label}
                  </option>
                ))}
              </select>
              <code className="text-muted-foreground">{shortOid(step.oid)}</code>
              {commitById.get(step.oid)?.published && (
                <span className="rounded border px-1 text-[11px]">Published</span>
              )}
              <span className="ms-auto flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={index === 0}
                  aria-label={`Move ${shortOid(step.oid)} earlier`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={index === steps.length - 1}
                  aria-label={`Move ${shortOid(step.oid)} later`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
              </span>
            </div>
            {step.action === "reword" ? (
              <Field className="mt-2">
                <FieldLabel htmlFor={`rewrite-message-${step.oid}`}>Commit message</FieldLabel>
                <Textarea
                  id={`rewrite-message-${step.oid}`}
                  value={step.message}
                  onChange={(event) => update(index, { message: event.target.value })}
                  rows={3}
                  className="font-mono text-xs"
                />
              </Field>
            ) : (
              <p className={`mt-1.5 break-words ${step.action === "drop" ? "text-muted-foreground line-through" : ""}`}>
                {commitById.get(step.oid)?.message.split("\n")[0]}
              </p>
            )}
          </div>
        ))}
      </fieldset>
      {published.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <p>
            {published.length} selected {published.length === 1 ? "commit is" : "commits are"} reachable from a
            remote-tracking branch. Publishing the rewritten branch may require a force push. Coordinate with anyone
            using it.
          </p>
          <Field orientation="horizontal">
            <Checkbox
              id="rewrite-published"
              checked={acknowledged}
              disabled={busy}
              onCheckedChange={(value) => setAcknowledged(value === true)}
            />
            <FieldLabel htmlFor="rewrite-published" className="font-normal">
              Rewrite published history
            </FieldLabel>
          </Field>
        </div>
      )}
      {error !== null && (
        <FieldError role="alert" className="whitespace-pre-line">
          {error}
        </FieldError>
      )}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {paused && !busy ? (
          <Button
            onClick={() => {
              onWorktree()
              onClose()
            }}
          >
            Review paused rebase
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void submit()}>
            {busy && <Spinner />}Start rebase
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
