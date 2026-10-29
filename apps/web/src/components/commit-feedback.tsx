import { useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { cn } from "cn"
import { CheckIcon, CircleAlertIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { useId, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { CommitRun } from "@/lib/commit-run"
import { commitRunAtom, useCommit } from "@/lib/commit-workflow"
import { failureHint, hintMessages } from "@/lib/failure-hints"
import { shortOid } from "@/lib/format"

const headline = (run: CommitRun) => {
  switch (run._tag) {
    case "Running":
      return run.amend ? "Amending…" : "Committing…"
    case "Committed":
      return `${run.amend ? "Amended" : "Committed"} ${shortOid(run.oid)}`
    case "Failed":
      return run.amend ? "Amend failed" : "Commit failed"
    case "Stopped":
      return run.amend ? "Amend stopped" : "Commit stopped"
  }
}

const openByDefault = (run: CommitRun) => run._tag !== "Committed"

export function CommitFeedback({ repo, onEditIdentity }: { repo: RepoId; onEditIdentity: () => void }) {
  const run = useAtomValue(commitRunAtom(repo))
  const commit = useCommit(repo)
  const outputId = useId()
  const [expanded, setExpanded] = useState({ tag: run?._tag, open: run !== null && openByDefault(run) })
  if (run !== null && expanded.tag !== run._tag) setExpanded({ tag: run._tag, open: openByDefault(run) })
  if (run === null) return null

  const hint = run._tag === "Failed" ? failureHint(`${run.error}\n${run.output.text}`) : null
  const hasOutput = run.output.text !== ""
  const showOutput = hasOutput && (run._tag === "Running" || expanded.open)
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
      <div className="flex items-start gap-2">
        <span className="flex h-6 shrink-0 items-center">
          {run._tag === "Running" ? (
            <Spinner className="size-3.5" />
          ) : run._tag === "Committed" ? (
            <CheckIcon className="size-3.5 text-muted-foreground" />
          ) : run._tag === "Failed" ? (
            <CircleAlertIcon className="size-3.5 text-destructive" />
          ) : (
            <TriangleAlertIcon className="size-3.5" />
          )}
        </span>
        <div role="status" className="min-w-0 flex-1 space-y-1 py-1 break-words">
          <p className={cn("font-medium", run._tag === "Failed" && "text-destructive")}>{headline(run)}</p>
          {run._tag === "Stopped" && (
            <>
              {run.reason !== null && <p className="whitespace-pre-line text-muted-foreground">{run.reason}</p>}
              <p>
                {run.amend
                  ? "Git may already have amended the commit. Check the history before you retry."
                  : "Git may already have created the commit. Check the history before you retry."}{" "}
                Your message is kept.
              </p>
            </>
          )}
        </div>
        {run._tag === "Running" ? (
          <Button size="xs" variant="outline" onClick={commit.cancel}>
            Cancel
          </Button>
        ) : (
          <>
            {hasOutput && (
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={expanded.open}
                aria-controls={outputId}
                onClick={() => setExpanded({ tag: run._tag, open: !expanded.open })}
              >
                {expanded.open ? "Hide output" : "Show output"}
              </Button>
            )}
            <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={commit.dismiss}>
              <XIcon />
            </Button>
          </>
        )}
      </div>
      {run._tag === "Failed" && (
        <div className="space-y-1.5">
          <p className="whitespace-pre-line text-destructive">{run.error}</p>
          {hint !== null && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-muted-foreground">{hintMessages[hint]}</p>
              {(hint === "identity" || hint === "signing") && (
                <Button size="xs" variant="outline" onClick={onEditIdentity}>
                  {hint === "identity" ? "Set name and email…" : "Edit signing settings…"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {showOutput && <Output id={outputId} text={run.output.text} trimmed={run.output.trimmed} />}
    </div>
  )
}

function Output({ id, text, trimmed }: { id: string; text: string; trimmed: boolean }) {
  const ref = useRef<HTMLPreElement>(null)
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const element = ref.current
    if (element !== null && pinned.current) element.scrollTop = element.scrollHeight
  }, [text])
  return (
    <pre
      ref={ref}
      id={id}
      tabIndex={0}
      aria-label="Git output"
      onScroll={(event) => {
        const element = event.currentTarget
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8
      }}
      className="max-h-40 overflow-auto rounded-sm bg-background/60 p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {trimmed && <span className="block text-muted-foreground">Earlier output was trimmed.</span>}
      {text}
    </pre>
  )
}
