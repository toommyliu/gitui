import { type Oid, RewriteAction, type RewritePlan, type RewriteResult, type RewriteStep } from "@gitui/contracts"
import { Checkbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { Dialog, DialogBackdrop, DialogContent, DialogDescription, DialogTitle } from "@ui-sdk/solid/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui-sdk/solid/select"
import { Textarea } from "@ui-sdk/solid/textarea"
import { createMemo, createSignal, For, Loading, Show } from "solid-js"
import { shortOid } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { call, describeError } from "@/lib/rpc"
import { initialSteps, isUnchanged, moveStep, rewriteActions, stepProblems } from "@/lib/rewrite"
import { ChevronDown } from "../icons"
import { Centered, Spinner } from "../state"
import { Alert, Button, Kbd } from "../ui"

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

function ActionSelect(props: { step: RewriteStep; disabled: boolean; onChange: (action: RewriteAction) => void }) {
  return (
    <Select<RewriteAction>
      value={props.step.action}
      disabled={props.disabled}
      onValueChange={(next) => next !== null && props.onChange(next)}
    >
      <SelectTrigger
        aria-label={`Action for ${shortOid(props.step.oid)}`}
        class={[
          "inline-flex h-5 w-[4.75rem] shrink-0 items-center justify-between gap-1 rounded border bg-background ps-1.5 pe-1 text-2xs font-medium hover:bg-muted data-open:bg-muted",
          props.step.action === "drop" && "text-destructive",
          props.step.action !== "pick" && props.step.action !== "drop" && "text-primary",
        ]}
      >
        <SelectValue class="truncate" />
        <ChevronDown />
      </SelectTrigger>
      <SelectContent side="bottom" align="start" sideOffset={4} class="w-96">
        <For each={RewriteAction.literals}>
          {(action) => (
            <SelectItem value={action} label={rewriteActions[action].label} class="data-selected:font-medium">
              <span class="w-12 shrink-0">{rewriteActions[action].label}</span>
              <span class="truncate text-2xs font-normal text-muted-foreground">{rewriteActions[action].hint}</span>
            </SelectItem>
          )}
        </For>
      </SelectContent>
    </Select>
  )
}

function PlanEditor(props: {
  plan: RewritePlan
  first: Oid
  running: boolean
  onRunningChange: (running: boolean) => void
  onClose: () => void
  onDone: (result: RewriteResult) => void
}) {
  const repo = useRepo()
  const [steps, setSteps] = createSignal<ReadonlyArray<RewriteStep>>(initialSteps(props.plan))
  const [allowPublished, setAllowPublished] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [announcement, setAnnouncement] = createSignal("")
  const [dragging, setDragging] = createSignal<Oid | null>(null)
  const [gap, setGap] = createSignal<number | null>(null)
  const problems = createMemo(() => stepProblems(steps()))
  const subjects = new Map(props.plan.commits.map((commit) => [commit.oid, commit.message.split("\n")[0] ?? ""]))
  const published = new Set(props.plan.commits.filter((commit) => commit.published).map((commit) => commit.oid))
  let list: HTMLOListElement | undefined

  const update = (oid: Oid, change: Partial<Pick<RewriteStep, "action" | "message">>) => {
    setSteps((current) => current.map((step) => (step.oid === oid ? { ...step, ...change } : step)))
    setError(null)
  }

  const move = (from: number, to: number, focus: boolean) => {
    const current = steps()
    const next = moveStep(current, from, to)
    if (next === current) return
    const step = current[from]
    setSteps(next)
    setError(null)
    if (step === undefined) return
    setAnnouncement(`Moved ${shortOid(step.oid)} to position ${to + 1} of ${next.length}`)
    if (focus) requestAnimationFrame(() => list?.querySelector<HTMLElement>(`[data-step="${step.oid}"]`)?.focus())
  }

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    if (event.target instanceof HTMLTextAreaElement) return
    event.preventDefault()
    event.stopPropagation()
    move(index, index + (event.key === "ArrowUp" ? -1 : 1), true)
  }

  const onDragOver = (event: DragEvent & { currentTarget: HTMLElement }, index: number) => {
    if (dragging() === null) return
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move"
    const rect = event.currentTarget.getBoundingClientRect()
    setGap(event.clientY < rect.top + rect.height / 2 ? index : index + 1)
  }

  const endDrag = () => {
    setDragging(null)
    setGap(null)
  }

  const drop = (event: DragEvent) => {
    event.preventDefault()
    const oid = dragging()
    const target = gap()
    endDrag()
    if (oid === null || target === null) return
    const from = steps().findIndex((step) => step.oid === oid)
    if (from !== -1) move(from, target > from ? target - 1 : target, false)
  }

  const blocked = () =>
    props.running ||
    problems().size > 0 ||
    isUnchanged(props.plan, steps()) ||
    (published.size > 0 && !allowPublished())

  const start = async () => {
    if (blocked()) return
    const request = {
      branch: props.plan.branch,
      head: props.plan.head,
      first: props.first,
      steps: steps(),
      allowPublished: allowPublished(),
    }
    props.onRunningChange(true)
    setError(null)
    try {
      props.onDone(
        await repo.mutate(["refs", "worktree", "index"], (git) => git.StartRewrite({ repo: repo.id, request })),
      )
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      props.onRunningChange(false)
    }
  }

  return (
    <>
      <div class="flex flex-col gap-1">
        <DialogTitle>Rewrite {props.plan.branch}</DialogTitle>
        <DialogDescription>
          {props.plan.commits.length === 1 ? "1 commit" : `${props.plan.commits.length} commits`}, oldest first. Git
          replays them from top to bottom. The original history is saved first, so Recover commits can bring it back.
        </DialogDescription>
      </div>
      <p role="status" class="sr-only">
        {announcement()}
      </p>
      <ol
        ref={list}
        aria-label="Rewrite plan, oldest commit first"
        class="max-h-[min(26rem,55dvh)] overflow-y-auto overscroll-none rounded-md border py-0.5"
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node && list?.contains(event.relatedTarget))) setGap(null)
        }}
      >
        <For each={steps()} keyed={(step) => step.oid}>
          {(step, index) => (
            <li
              class={[
                "relative",
                gap() === index() &&
                  "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-primary",
                gap() === steps().length &&
                  index() === steps().length - 1 &&
                  "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary",
              ]}
              onDragOver={(event) => onDragOver(event, index())}
              onDrop={drop}
            >
              <div
                data-step={step().oid}
                tabindex="0"
                draggable={props.running ? "false" : "true"}
                aria-label={`${rewriteActions[step().action].label} ${shortOid(step().oid)} ${subjects.get(step().oid) ?? ""}`}
                class={[
                  "flex h-6 items-center gap-2 px-1.5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  dragging() === step().oid ? "opacity-40" : "hover:bg-muted",
                ]}
                ref={(element: HTMLDivElement) => {
                  element.addEventListener("keydown", (event) => onKeyDown(event, index()), { capture: true })
                }}
                onDragStart={(event: DragEvent) => {
                  setDragging(step().oid)
                  if (event.dataTransfer !== null) {
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", step().oid)
                  }
                }}
                onDragEnd={endDrag}
              >
                <ActionSelect
                  step={step()}
                  disabled={props.running}
                  onChange={(action) => update(step().oid, { action })}
                />
                <span class="shrink-0 font-mono text-2xs text-muted-foreground">{shortOid(step().oid)}</span>
                <span
                  class={[
                    "min-w-0 flex-1 truncate text-xs",
                    step().action === "drop" && "text-muted-foreground line-through",
                    (step().action === "squash" || step().action === "fixup") && "text-muted-foreground",
                  ]}
                >
                  {step().action === "reword" ? step().message.split("\n")[0] : subjects.get(step().oid)}
                </span>
                <Show when={published.has(step().oid)}>
                  <span class="shrink-0 rounded-sm bg-change-modified/15 px-1 text-2xs font-medium text-change-modified">
                    Pushed
                  </span>
                </Show>
              </div>
              <Show when={step().action === "reword"}>
                <div class="px-1.5 ps-[5.75rem] pt-0.5 pb-1.5">
                  <Textarea
                    aria-label={`Message for ${shortOid(step().oid)}`}
                    value={step().message}
                    disabled={props.running}
                    onInput={(event) => update(step().oid, { message: event.currentTarget.value })}
                    class="min-h-16 resize-y font-mono text-xs leading-relaxed"
                  />
                </div>
              </Show>
              <Show when={problems().get(step().oid)}>
                {(problem) => <p class="px-1.5 ps-[5.75rem] pb-1 text-2xs text-destructive">{problem()}</p>}
              </Show>
            </li>
          )}
        </For>
      </ol>
      <Show when={published.size > 0}>
        <Alert
          tone="warning"
          title={`${published.size === 1 ? "1 commit is" : `${published.size} commits are`} on a remote`}
        >
          <p>Publishing the rewrite needs a force push, which affects anyone who already has these commits.</p>
          <label class="mt-1.5 flex items-center gap-2 text-foreground">
            <Checkbox
              checked={allowPublished()}
              disabled={props.running}
              onCheckedChange={(checked) => setAllowPublished(checked === true)}
            >
              <CheckboxIndicator />
            </Checkbox>
            Rewrite pushed commits
          </label>
        </Alert>
      </Show>
      <Show when={error()}>
        {(message) => (
          <Alert tone="error" title="Couldn't rewrite" class="whitespace-pre-line">
            {message()}
          </Alert>
        )}
      </Show>
      <div class="flex items-center gap-1.5">
        <span class="min-w-0 flex-1 text-2xs text-muted-foreground">
          Drag to reorder, or <Kbd>{isMac ? "⌥↑ ⌥↓" : "Alt+↑ Alt+↓"}</Kbd>
        </span>
        <Button disabled={props.running} onClick={() => props.onClose()}>
          Cancel
        </Button>
        <Button variant="primary" disabled={blocked()} onClick={() => void start()}>
          {props.running ? "Rewriting…" : "Start rewrite"}
        </Button>
      </div>
    </>
  )
}

type Loaded = { readonly ok: true; readonly plan: RewritePlan } | { readonly ok: false; readonly message: string }

export function RewriteDialog(props: {
  entry: { readonly first: Oid } | null
  onClose: () => void
  onDone: (result: RewriteResult) => void
}) {
  const repo = useRepo()
  const [running, setRunning] = createSignal(false)
  const loaded = createMemo(() => {
    const entry = props.entry
    if (entry === null) return null
    return call((git) => git.GetRewritePlan({ repo: repo.id, first: entry.first })).then(
      (plan): Loaded => ({ ok: true, plan }),
      (error: unknown): Loaded => ({ ok: false, message: describeError(error) }),
    )
  })
  return (
    <Dialog open={props.entry !== null} onOpenChange={(open) => !open && !running() && props.onClose()}>
      <DialogBackdrop />
      <DialogContent class="w-[min(40rem,calc(100%-2rem))]">
        <Loading
          on={props.entry}
          fallback={
            <Centered>
              <Spinner />
            </Centered>
          }
        >
          <Show when={props.entry === null ? null : loaded()} keyed>
            {(result) =>
              result.ok ? (
                <PlanEditor
                  plan={result.plan}
                  first={props.entry?.first ?? result.plan.head}
                  running={running()}
                  onRunningChange={setRunning}
                  onClose={props.onClose}
                  onDone={props.onDone}
                />
              ) : (
                <>
                  <DialogTitle>Can't rewrite from this commit</DialogTitle>
                  <Alert tone="error">{result.message}</Alert>
                  <div class="flex justify-end">
                    <Button onClick={() => props.onClose()}>Close</Button>
                  </div>
                </>
              )
            }
          </Show>
        </Loading>
      </DialogContent>
    </Dialog>
  )
}
