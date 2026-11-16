import type { ConflictCode, ConflictDetail, ConflictRef, RepoPath } from "@gitui/contracts"
import { createMemo, createSignal, For, Show, useContext } from "solid-js"
import { WorkspaceContext } from "@/lib/workspaces"
import { CommitMention } from "../commit-mention"
import {
  type Block,
  type Choice,
  type Choices,
  choiceText,
  lineCount,
  normalizeNewlines,
  parseSegments,
  resultText,
  type Segment,
  segmentText,
  toDisplay,
} from "@/lib/conflict-blocks"
import { describeConflict, describeFile, refLabel } from "@/lib/conflicts"
import { basename, dirname } from "@/lib/format"
import { shortcut, useCommand } from "@/lib/hotkeys"
import { useRepo } from "@/lib/repo"
import { call } from "@/lib/rpc"
import { ArrowDown, ArrowUp } from "../icons"
import { createRunner } from "../refs/runner"
import { Boundary } from "../state"
import { Bar, Button, Empty, Failures, Tip } from "../ui"

type Side = "ours" | "theirs"

const SIDES = ["ours", "theirs"] as const

const swatches: Record<Side, string> = { ours: "bg-(--conflict-ours)", theirs: "bg-(--conflict-theirs)" }

const tints: Record<Choice, string> = {
  ours: "bg-(--conflict-ours)/10",
  theirs: "bg-(--conflict-theirs)/10",
  both: "bg-muted/50",
}

const sideNames: Record<Side, string> = { ours: "Ours", theirs: "Theirs" }

const NO_CHOICES: Choices = new Map()

const draftKey = (detail: ConflictDetail) => `${detail.path}\n${detail.version}`

export function ConflictResolver(props: { path: RepoPath; onClose: () => void }) {
  const repo = useRepo()
  const code = createMemo(() => {
    const entry = repo.status().entries.find((candidate) => candidate.path === props.path)
    return entry?._tag === "Conflicted" ? entry.code : null
  })
  const detail = createMemo(() => {
    const path = props.path
    return code() === null ? null : call((git) => git.GetConflict({ repo: repo.id, path }))
  })
  const [drafts, setDrafts] = createSignal<ReadonlyMap<string, Choices>>(new Map())
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Boundary label="Loading conflict" title="Couldn't read this conflict">
        <Show when={detail()} fallback={<Empty title="This file is resolved" />}>
          {(current) => (
            <Resolver
              detail={current()}
              code={code()}
              choices={drafts().get(draftKey(current())) ?? NO_CHOICES}
              onChoices={(choices) => {
                const key = draftKey(current())
                setDrafts((all) => new Map(all).set(key, choices))
              }}
              onClose={props.onClose}
            />
          )}
        </Show>
      </Boundary>
    </div>
  )
}

function Resolver(props: {
  detail: ConflictDetail
  code: ConflictCode | null
  choices: Choices
  onChoices: (choices: Choices) => void
  onClose: () => void
}) {
  const repo = useRepo()
  const runner = createRunner()
  const [waiting, setWaiting] = createSignal(false)
  const segments = createMemo((): ReadonlyArray<Segment> | null => {
    const { ours, theirs, result, editable } = props.detail
    return editable && ours._tag === "Text" && theirs._tag === "Text" && result._tag === "Text"
      ? parseSegments(normalizeNewlines(result.content), props.detail)
      : null
  })
  const left = () =>
    segments()?.filter((segment, index) => segment._tag === "Block" && !props.choices.has(index)).length ?? 0

  const finish = async (request: Parameters<typeof runner.run>[0]) => {
    if (await runner.run(request)) props.onClose()
  }

  const keep = (side: Side) => {
    const path = props.detail.path
    void finish({
      scopes: ["worktree", "index"],
      request: (git) => git.ResolveConflict({ repo: repo.id, paths: [path], side }),
      failure: `Couldn't keep ${side}`,
    })
  }

  const markResolved = (resolved: ReadonlyArray<Segment>) => {
    const { path, version } = props.detail
    const content = resultText(resolved, props.choices)
    void finish({
      scopes: ["worktree", "index"],
      request: (git) => git.SaveConflictResult({ repo: repo.id, path, content, expectedVersion: version, stage: true }),
      failure: "Couldn't mark it resolved",
    })
  }

  const openTool = async () => {
    const path = props.detail.path
    setWaiting(true)
    await runner.run({
      scopes: ["worktree", "index"],
      request: (git) => git.RunMergeTool({ repo: repo.id, path }),
      failure: "The merge tool failed",
    })
    setWaiting(false)
  }

  const keepTip = (side: Side) =>
    props.detail[side]._tag === "Missing"
      ? `Delete the file, as ${side} did, and mark it resolved`
      : `Use ${side} for the whole file and mark it resolved`

  return (
    <>
      <Bar class="ps-3">
        <span class="min-w-0 truncate">
          <span class="text-muted-foreground">{dirname(props.detail.path)}</span>
          {basename(props.detail.path)}
        </span>
        <Show when={props.code}>
          {(code) => <span class="shrink-0 text-change-modified">{describeConflict(code())}</span>}
        </Show>
        <div class="flex-1" />
        <Show when={props.detail.mergeTool}>
          {(tool) => (
            <Button variant="ghost" disabled={runner.running()} onClick={() => void openTool()}>
              {waiting() ? `Waiting for ${tool()}…` : `Open in ${tool()}`}
            </Button>
          )}
        </Show>
        <Show when={segments()}>
          {(resolved) => (
            <>
              <For each={SIDES}>
                {(side) => (
                  <Tip label={keepTip(side)}>
                    {(trigger) => (
                      <Button {...trigger} variant="ghost" disabled={runner.running()} onClick={() => keep(side)}>
                        <Swatch side={side} />
                        Keep {side}
                      </Button>
                    )}
                  </Tip>
                )}
              </For>
              <Button
                variant="primary"
                disabled={runner.running() || left() > 0}
                onClick={() => markResolved(resolved())}
              >
                Mark resolved
              </Button>
            </>
          )}
        </Show>
      </Bar>
      <Failures failure={runner.failure()} onDismiss={runner.dismiss} />
      <Show when={segments()} fallback={<WholeFile detail={props.detail} running={runner.running()} onKeep={keep} />}>
        {(resolved) => (
          <TextConflict
            detail={props.detail}
            segments={resolved()}
            choices={props.choices}
            left={left()}
            running={runner.running()}
            onChoices={props.onChoices}
          />
        )}
      </Show>
    </>
  )
}

function Swatch(props: { side: Side }) {
  return <span aria-hidden="true" class={["size-2 shrink-0 rounded-xs", swatches[props.side]]} />
}

function SideLabel(props: { side: Side; reference: ConflictRef | null; class?: string }) {
  const workspace = useContext(WorkspaceContext)
  return (
    <span class={["flex min-w-0 items-center gap-1.5", props.class]}>
      <Swatch side={props.side} />
      <span class="shrink-0 text-muted-foreground">{sideNames[props.side]}</span>
      <Show when={props.reference}>
        {(reference) => (
          <Show
            when={workspace}
            fallback={
              <>
                <span class="shrink-0 font-medium">{refLabel(reference())}</span>
                <span class="min-w-0 truncate text-muted-foreground">{reference().subject}</span>
              </>
            }
          >
            {(current) => (
              <CommitMention
                workspace={current()}
                hash={reference().oid}
                class="-mx-1 flex min-w-0 items-center gap-1.5 rounded px-1 hover:bg-muted data-open:bg-muted"
              >
                <span class="shrink-0 font-medium">{refLabel(reference())}</span>
                <span class="min-w-0 truncate text-muted-foreground">{reference().subject}</span>
              </CommitMention>
            )}
          </Show>
        )}
      </Show>
    </span>
  )
}

function TextConflict(props: {
  detail: ConflictDetail
  segments: ReadonlyArray<Segment>
  choices: Choices
  left: number
  running: boolean
  onChoices: (choices: Choices) => void
}) {
  const blocks = createMemo(() => props.segments.flatMap((segment, index) => (segment._tag === "Block" ? [index] : [])))
  const starts = createMemo(() => {
    let line = 1
    return props.segments.map((segment, index) => {
      const start = line
      line += lineCount(segmentText(segment, props.choices.get(index)))
      return start
    })
  })
  const choose = (index: number, choice: Choice | null) => {
    const next = new Map(props.choices)
    if (choice === null) next.delete(index)
    else next.set(index, choice)
    props.onChoices(next)
  }

  const [current, setCurrent] = createSignal(0)
  const [preview, setPreview] = createSignal(false)
  let scroller: HTMLDivElement | undefined
  const position = () => Math.min(current(), Math.max(blocks().length - 1, 0))
  const step = (delta: 1 | -1) => {
    const count = blocks().length
    if (count === 0) return
    const next = (position() + delta + count) % count
    setCurrent(next)
    const header = scroller?.querySelector<HTMLElement>(`[data-conflict="${next + 1}"]`)
    if (header) scroller?.scrollTo({ top: header.offsetTop - 4 })
  }
  const navigable = () => blocks().length > 0 && !preview()
  useCommand("diff.nextHunk", () => step(1), navigable)
  useCommand("diff.previousHunk", () => step(-1), navigable)

  return (
    <>
      <Bar class="ps-3">
        <SideLabel side="ours" reference={props.detail.labels.ours} class="max-w-1/3" />
        <SideLabel side="theirs" reference={props.detail.labels.theirs} class="max-w-1/3" />
        <div class="flex-1" />
        <Show when={blocks().length > 0} fallback={<span class="text-muted-foreground">No conflict markers</span>}>
          <span class={["tabular-nums", props.left > 0 ? "text-muted-foreground" : "text-change-added"]}>
            {props.left === 0 ? "All resolved" : `${props.left} of ${blocks().length} left`}
          </span>
        </Show>
        <Show when={navigable()}>
          <div class="flex items-center">
            <Tip label="Previous conflict" keys={shortcut("diff.previousHunk")}>
              {(trigger) => (
                <Button
                  {...trigger}
                  variant="ghost"
                  class="px-1"
                  aria-label="Previous conflict"
                  onClick={() => step(-1)}
                >
                  <ArrowUp />
                </Button>
              )}
            </Tip>
            <Tip label="Next conflict" keys={shortcut("diff.nextHunk")}>
              {(trigger) => (
                <Button {...trigger} variant="ghost" class="px-1" aria-label="Next conflict" onClick={() => step(1)}>
                  <ArrowDown />
                </Button>
              )}
            </Tip>
          </div>
        </Show>
        <Tip label="Show the file as it will be saved">
          {(trigger) => (
            <Button
              {...trigger}
              variant={preview() ? "outline" : "ghost"}
              aria-pressed={preview() ? "true" : "false"}
              onClick={() => setPreview(!preview())}
            >
              Result
            </Button>
          )}
        </Tip>
      </Bar>
      <div
        ref={(element) => (scroller = element)}
        tabindex={-1}
        aria-label="Merge result"
        class="relative min-h-0 flex-1 overflow-y-auto overscroll-none pb-2 font-mono text-xs leading-5 outline-none"
      >
        <For each={props.segments}>
          {(segment, index) => (
            <Show
              when={segment._tag === "Block" && !preview() ? segment : null}
              fallback={
                <Lines
                  start={starts()[index()] ?? 1}
                  text={segmentText(segment, props.choices.get(index()))}
                  tint={segment._tag === "Block" && !props.choices.has(index()) ? "bg-destructive/10" : undefined}
                />
              }
            >
              {(block) => (
                <BlockView
                  block={block()}
                  number={blocks().indexOf(index()) + 1}
                  start={starts()[index()] ?? 1}
                  choice={props.choices.get(index())}
                  current={blocks()[position()] === index()}
                  disabled={props.running}
                  onChoose={(choice) => {
                    setCurrent(blocks().indexOf(index()))
                    choose(index(), choice)
                  }}
                />
              )}
            </Show>
          )}
        </For>
      </div>
    </>
  )
}

function Lines(props: { start: number; text: string; tint?: string | undefined }) {
  const numbers = () => Array.from({ length: lineCount(props.text) }, (_, index) => props.start + index).join("\n")
  return (
    <div class={["flex", props.tint]}>
      <pre aria-hidden="true" class="w-10 shrink-0 pe-2 text-end text-muted-foreground/60 select-none">
        {numbers()}
      </pre>
      <pre class="min-w-0 flex-1 [scrollbar-width:none] overflow-x-auto pe-3 select-text">{toDisplay(props.text)}</pre>
    </div>
  )
}

function SideText(props: { side: Side; text: string }) {
  const inset = () => (props.side === "ours" ? "pe-2" : "px-2")
  return (
    <Show
      when={props.text !== ""}
      fallback={
        <div class={["font-sans text-2xs text-muted-foreground italic", inset(), tints[props.side]]}>No lines</div>
      }
    >
      <pre class={["min-w-0 overflow-x-auto select-text", inset(), tints[props.side]]}>{toDisplay(props.text)}</pre>
    </Show>
  )
}

function BlockView(props: {
  block: Block
  number: number
  start: number
  choice: Choice | undefined
  current: boolean
  disabled: boolean
  onChoose: (choice: Choice | null) => void
}) {
  const option = (choice: Choice) => (
    <Button
      variant={props.choice === choice ? "outline" : "ghost"}
      aria-pressed={props.choice === choice ? "true" : "false"}
      disabled={props.disabled}
      onClick={() => props.onChoose(choice)}
    >
      <Show when={choice !== "both"}>
        <Swatch side={choice === "ours" ? "ours" : "theirs"} />
      </Show>
      Use {choice}
    </Button>
  )
  return (
    <section aria-label={`Conflict ${props.number}`}>
      <div
        data-conflict={props.number}
        class={[
          "flex h-7 items-center gap-1 border-y ps-3 pe-2 font-sans",
          props.current ? "bg-selection" : "bg-muted/40",
        ]}
      >
        <span class="font-medium">Conflict {props.number}</span>
        <span class={props.choice === undefined ? "text-destructive" : "text-muted-foreground"}>
          {props.choice === undefined ? "Unresolved" : `Uses ${props.choice}`}
        </span>
        <div class="flex-1" />
        {option("ours")}
        {option("theirs")}
        {option("both")}
        <Show when={props.choice !== undefined}>
          <Button variant="ghost" disabled={props.disabled} onClick={() => props.onChoose(null)}>
            Reset
          </Button>
        </Show>
      </div>
      <Show
        when={props.choice}
        fallback={
          <div class="flex">
            <div class="w-10 shrink-0" />
            <div class="grid min-w-0 flex-1 grid-cols-2 divide-x">
              <SideText side="ours" text={props.block.ours} />
              <SideText side="theirs" text={props.block.theirs} />
            </div>
          </div>
        }
      >
        {(choice) => <Lines start={props.start} text={choiceText(props.block, choice())} tint={tints[choice()]} />}
      </Show>
    </section>
  )
}

function WholeFile(props: { detail: ConflictDetail; running: boolean; onKeep: (side: Side) => void }) {
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center p-6">
      <div class="flex w-full max-w-md flex-col gap-2 text-xs">
        <p class="text-muted-foreground">
          This file can't be merged line by line. Keep one side for the whole file; it's staged right away.
        </p>
        <For each={SIDES}>
          {(side) => (
            <div class="flex h-9 items-center gap-2 rounded-md border px-2">
              <SideLabel side={side} reference={props.detail.labels[side]} class="flex-1" />
              <span class="shrink-0 text-muted-foreground">{describeFile(props.detail[side])}</span>
              <Button disabled={props.running} onClick={() => props.onKeep(side)}>
                {props.detail[side]._tag === "Missing" ? "Delete file" : `Keep ${side}`}
              </Button>
            </div>
          )}
        </For>
        <Show when={props.detail.mergeTool === null}>
          <p class="text-muted-foreground">
            Set <code class="font-mono">merge.tool</code> in your Git config to open conflicts in a merge tool.
          </p>
        </Show>
      </div>
    </div>
  )
}
