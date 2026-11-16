import type { CommitDetail, FileDiff, Oid, Stash } from "@gitui/contracts"
import { Listbox, ListboxItem } from "@ui-sdk/solid/listbox"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { relativeDate } from "@/lib/format"
import { useCommand } from "@/lib/hotkeys"
import { useRepo } from "@/lib/repo"
import { ignoreWhitespace } from "@/lib/settings"
import { call, describeError } from "@/lib/rpc"
import { FilesPane, PaneBoundary } from "./files-pane"
import { Prose } from "./commit-mention"
import { Confirm } from "./refs/confirm"
import { createRunner } from "./refs/runner"
import { StashButton } from "./refs/stash-dialog"
import { Split } from "./split"
import { Bar, Button, Count, Empty, Failures, ROW } from "./ui"
import { listDate } from "@/lib/dates"
import { createCache } from "@/lib/prefetch"

const stashName = (index: number) => `stash@{${index}}`

const describe = (message: string) => {
  const match = /^(?:WIP on|On) ([^:]+): (.*)$/s.exec(message)
  return match === null ? { branch: null, text: message } : { branch: match[1] ?? null, text: match[2] ?? message }
}

function StashBar(props: { stash: Stash; index: number }) {
  const repo = useRepo()
  const { running, run, failure, dismiss } = createRunner()
  const [dropping, setDropping] = createSignal(false)
  const [dropError, setDropError] = createSignal<string | null>(null)
  const [dropPending, setDropPending] = createSignal(false)
  const parsed = () => describe(props.stash.message)

  const apply = (drop: boolean) => {
    const oid = props.stash.oid
    return run({
      scopes: ["refs", "worktree", "index"],
      request: (git) => git.StashApply({ repo: repo.id, oid, drop }),
      failure: drop ? "Couldn't pop the stash" : "Couldn't apply the stash",
    })
  }

  const drop = async () => {
    const oid = props.stash.oid
    setDropPending(true)
    try {
      await repo.mutate(["refs"], (git) => git.StashDrop({ repo: repo.id, oid }))
      setDropping(false)
    } catch (error) {
      setDropError(describeError(error))
    } finally {
      setDropPending(false)
    }
  }

  return (
    <>
      <Bar class="gap-2">
        <span class="shrink-0 font-mono text-2xs text-muted-foreground">{stashName(props.index)}</span>
        <span class="min-w-0 truncate font-medium select-text">
          <Prose text={parsed().text} />
        </span>
        <span class="shrink-0 text-2xs text-muted-foreground">
          <Show when={parsed().branch}>{(branch) => <>on {branch()} · </>}</Show>
          <span>{relativeDate(props.stash.time)}</span>
        </span>
        <div class="flex-1" />
        <div class="flex shrink-0 items-center gap-1.5">
          <Button variant="primary" disabled={running()} onClick={() => void apply(false)}>
            Apply
          </Button>
          <Button disabled={running()} onClick={() => void apply(true)}>
            Pop
          </Button>
          <Button
            variant="danger"
            disabled={running()}
            onClick={() => {
              setDropError(null)
              setDropping(true)
            }}
          >
            Drop…
          </Button>
        </div>
        <Confirm
          open={dropping()}
          onOpenChange={(open) => !dropPending() && setDropping(open)}
          title={`Drop ${stashName(props.index)}?`}
          description={`“${parsed().text}” is deleted. You can only get it back from the reflog.`}
          error={dropError()}
          confirmLabel="Drop"
          pending={dropPending()}
          onConfirm={() => void drop()}
        />
      </Bar>
      <Failures failure={failure()} onDismiss={dismiss} />
    </>
  )
}

const PRELOADED = 20

interface StashDetail {
  readonly files: CommitDetail["files"]
  readonly diff: FileDiff
}

export function StashesView(props: { focused: boolean }) {
  const repo = useRepo()
  const [selected, setSelected] = createSignal<string | null>(null)
  const [allowLarge, setAllowLarge] = createSignal(false)

  const stashes = () => repo.refs().stashes
  const changes = () => repo.status().entries.length
  const index = createMemo(() => {
    const found = stashes().findIndex((stash) => stash.oid === selected())
    return found === -1 ? 0 : found
  })
  const stash = () => stashes()[index()]

  const cache = createCache<StashDetail>(PRELOADED * 2)
  const load = (oid: Oid, large: boolean, whitespace: boolean) =>
    cache.get(`${oid}:${large}:${whitespace}`, () =>
      Promise.all([
        call((git) => git.GetCommit({ repo: repo.id, oid })),
        call((git) =>
          git.GetDiff({
            repo: repo.id,
            target: { _tag: "Commit", oid },
            paths: [],
            ignoreWhitespace: whitespace,
            allowLarge: large,
          }),
        ),
      ]).then(([commit, diff]) => ({ files: commit.files, diff })),
    )

  createEffect(
    () => ({
      oids: stashes()
        .slice(0, PRELOADED)
        .map((entry) => entry.oid),
      whitespace: ignoreWhitespace(),
    }),
    ({ oids, whitespace }) => {
      for (const oid of oids) void Promise.resolve(load(oid, false, whitespace)).catch(() => undefined)
    },
  )

  const detail = createMemo(() => {
    const oid = stash()?.oid
    return oid === undefined ? null : load(oid, allowLarge(), ignoreWhitespace())
  })

  const select = (oid: string) => {
    setSelected(oid)
    setAllowLarge(false)
    document.querySelector(`[data-stash="${CSS.escape(oid)}"]`)?.scrollIntoView({ block: "nearest" })
  }

  const step = (delta: 1 | -1) => {
    const next = stashes()[Math.max(0, Math.min(stashes().length - 1, index() + delta))]
    if (next !== undefined) select(next.oid)
  }
  useCommand("list.next", () => step(1))
  useCommand("list.previous", () => step(-1))

  return (
    <Show
      when={stashes().length > 0}
      fallback={
        <Empty title="No stashes">
          <p>Stash your changes to set them aside and get a clean working tree.</p>
          <div class="mt-3 flex justify-center">
            <StashButton changes={changes()} variant="primary" />
          </div>
        </Empty>
      }
    >
      <Split
        id="stashes"
        listLabel="stashes"
        collapsed={props.focused}
        list={
          <>
            <Bar>
              <span class="font-medium">Stashes</span>
              <Count value={stashes().length} />
              <div class="flex-1" />
              <StashButton changes={changes()} variant="ghost" />
            </Bar>
            <div class="min-h-0 flex-1 overflow-y-auto">
              <Listbox
                aria-label="Stashes"
                value={stash()?.oid ?? null}
                onValueChange={(value) => {
                  if (typeof value === "string") select(value)
                }}
                class="flex flex-col p-1"
              >
                <For each={stashes()}>
                  {(entry) => (
                    <ListboxItem
                      value={entry.oid}
                      label={describe(entry.message).text}
                      data-stash={entry.oid}
                      style={{ height: `${ROW}px` }}
                      class="flex items-center gap-2 rounded px-2 text-xs"
                    >
                      <span class="min-w-0 flex-1 truncate">{describe(entry.message).text}</span>
                      <span class="shrink-0 text-2xs text-muted-foreground tabular-nums">{listDate(entry.time)}</span>
                    </ListboxItem>
                  )}
                </For>
              </Listbox>
            </div>
          </>
        }
      >
        <Show when={stash()}>
          {(current) => (
            <>
              <StashBar stash={current()} index={index()} />
              <PaneBoundary on={selected()} title="Couldn't read this stash">
                <Show when={detail()}>
                  {(result) => (
                    <FilesPane
                      section="stash"
                      files={result().files}
                      diff={result().diff}
                      empty="This stash has no file changes"
                      onShowLarge={() => setAllowLarge(true)}
                    />
                  )}
                </Show>
              </PaneBoundary>
            </>
          )}
        </Show>
      </Split>
    </Show>
  )
}
