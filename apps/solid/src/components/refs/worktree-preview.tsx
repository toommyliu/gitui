import {
  type BaseRef,
  type FileChange,
  type MergeCheck,
  RepoId,
  type StatusEntry,
  type WorktreeDetail,
} from "@gitui/contracts"
import type { JSX } from "@solidjs/web"
import {
  createMemo,
  createSignal,
  Errored,
  For,
  isPending,
  Loading,
  Match,
  onCleanup,
  Show,
  Switch,
  untrack,
} from "solid-js"
import { basename, dirname, relativeDate, shortOid } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { call, describeError, subscribe } from "@/lib/rpc"
import { Prose } from "../commit-mention"
import { patchItems } from "../diff"
import { FilesPane, PaneBoundary } from "../files-pane"
import { Refresh } from "../icons"
import { Spinner } from "../state"
import { Button, ROW, Tip } from "../ui"

const SECTION = "worktree"
const VISIBLE_COMMITS = 5

const plural = (count: number, word: string) => `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`

interface Counts {
  readonly additions: number
  readonly deletions: number
}

const fileChange = (entry: StatusEntry, counts: Counts | undefined): FileChange => {
  const additions = counts?.additions ?? null
  const deletions = counts?.deletions ?? null
  switch (entry._tag) {
    case "Untracked":
      return { path: entry.path, from: null, change: "added", additions, deletions }
    case "Conflicted":
      return { path: entry.path, from: null, change: "modified", additions, deletions }
    case "Tracked":
      return {
        path: entry.path,
        from: entry.from,
        change: entry.unstaged === "deleted" ? "deleted" : (entry.staged ?? entry.unstaged ?? "modified"),
        additions,
        deletions,
      }
  }
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <>
      <dt class="text-muted-foreground">{props.label}</dt>
      <dd class="min-w-0">{props.children}</dd>
    </>
  )
}

function MergeStatus(props: { base: BaseRef; check: MergeCheck }) {
  return (
    <Switch>
      <Match when={props.check._tag === "Clean"}>
        <span class="text-change-added">Applies cleanly onto {props.base.name}</span>
      </Match>
      <Match when={props.check._tag === "Conflicts" ? props.check : undefined}>
        {(conflicts) => (
          <span class="flex min-w-0 flex-col">
            <span class="text-change-modified">
              Conflicts with {props.base.name} in {plural(conflicts().paths.length, "file")}
            </span>
            <span class="truncate text-muted-foreground">{conflicts().paths.map(basename).join(", ")}</span>
          </span>
        )}
      </Match>
    </Switch>
  )
}

function CheckAgain(props: { busy: boolean; onClick: () => void }) {
  return (
    <Tip label="Check again">
      {(trigger) => (
        <Button
          {...trigger}
          variant="ghost"
          aria-label="Check again"
          aria-busy={props.busy ? "true" : "false"}
          class="-my-0.5 h-5 w-5 justify-center px-0 [&_svg]:size-3"
          onClick={() => props.busy || props.onClick()}
        >
          <span class={["flex", props.busy && "animate-spin"]}>
            <Refresh />
          </span>
        </Button>
      )}
    </Tip>
  )
}

function Overlap(props: {
  entries: ReadonlyArray<StatusEntry>
  overlaps: () => ReadonlyMap<string, ReadonlyArray<string>>
}) {
  const shared = () =>
    props.entries.flatMap((entry) => {
      const others = props.overlaps().get(entry.path)
      return others === undefined ? [] : [{ path: entry.path, others }]
    })
  return (
    <Show when={shared().length > 0}>
      <Row label="Overlap">
        <span>{plural(shared().length, "file")} also changed in other worktrees</span>
        <ul
          class="mt-0.5 overflow-y-auto overscroll-none"
          style={{ "max-height": `${(VISIBLE_COMMITS + 0.5) * ROW}px` }}
        >
          <For each={shared()}>
            {(file) => (
              <li class="flex items-center gap-2 whitespace-nowrap" style={{ height: `${ROW}px` }}>
                <span class="min-w-0 truncate">
                  <span class="text-muted-foreground">{dirname(file.path)}</span>
                  {basename(file.path)}
                </span>
                <span class="max-w-60 min-w-0 shrink-0 truncate rounded-sm border border-change-modified/60 px-1 text-2xs text-change-modified">
                  also in {file.others.join(", ")}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Row>
    </Show>
  )
}

function Summary(props: {
  detail: WorktreeDetail
  check: () => MergeCheck | null
  rechecking: () => boolean
  onRecheck: () => void
  overlaps: () => ReadonlyMap<string, ReadonlyArray<string>>
}) {
  const landed = () => props.detail.commits.filter((commit) => commit.landed !== null).length
  return (
    <dl class="grid shrink-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b px-3 py-2 text-xs">
      <Row label="Uncommitted">
        {props.detail.entries.length === 0 ? (
          <span class="text-muted-foreground">Nothing</span>
        ) : (
          plural(props.detail.entries.length, "file")
        )}
        <Show when={props.detail.editedAt}>
          {(time) => <span class="text-muted-foreground">, edited {relativeDate(time())}</span>}
        </Show>
      </Row>
      <Loading fallback={null}>
        <Overlap entries={props.detail.entries} overlaps={props.overlaps} />
      </Loading>
      <Show
        when={props.detail.head._tag !== "Unborn" ? props.detail.base : undefined}
        fallback={
          <Row label="Commits">
            <span class="text-muted-foreground">
              {props.detail.head._tag === "Unborn" ? "No commits yet" : "No main or master branch to compare with"}
            </span>
          </Row>
        }
      >
        {(base) => (
          <>
            <Row label="Commits">
              <span>
                {props.detail.unique === 0
                  ? "None of its own"
                  : `${plural(props.detail.unique, "commit")} not on ${base().name}`}
              </span>
              <Show when={landed() > 0}>
                <span class="text-muted-foreground">
                  , {landed()} already on {base().name}
                </span>
              </Show>
              <Show when={props.detail.commits.length > 0}>
                <ul
                  class="mt-0.5 overflow-y-auto overscroll-none"
                  style={{ "max-height": `${(VISIBLE_COMMITS + 0.5) * ROW}px` }}
                >
                  <For each={props.detail.commits}>
                    {(commit) => (
                      <li class="flex items-center gap-2 whitespace-nowrap" style={{ height: `${ROW}px` }}>
                        <span class="w-14 shrink-0 font-mono text-2xs">
                          <Prose text={shortOid(commit.oid)} />
                        </span>
                        <span class="min-w-0 flex-1 truncate">{commit.subject}</span>
                        <span class="shrink-0 text-2xs text-muted-foreground">
                          <Show when={commit.landed} fallback={relativeDate(commit.time)}>
                            {(oid) => <Prose text={`on ${base().name} as ${shortOid(oid())}`} />}
                          </Show>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={props.detail.truncated}>
                <p class="text-2xs text-muted-foreground">Showing the newest {props.detail.commits.length}.</p>
              </Show>
            </Row>
            <Row label="Base">
              <Show
                when={props.detail.mergeBase}
                fallback={<span class="text-muted-foreground">No history in common with {base().name}</span>}
              >
                {(oid) => (
                  <Prose
                    text={`${shortOid(oid())}, ${
                      props.detail.behind === 0
                        ? `up to date with ${base().name}`
                        : `${plural(props.detail.behind, "commit")} behind ${base().name}`
                    }`}
                  />
                )}
              </Show>
            </Row>
            <Row label="Rebase">
              <Errored
                fallback={(error, reset) => (
                  <span class="flex items-start gap-1.5">
                    <span class="text-muted-foreground">Couldn't check: {describeError(error())}</span>
                    <CheckAgain
                      busy={false}
                      onClick={() => {
                        props.onRecheck()
                        reset()
                      }}
                    />
                  </span>
                )}
              >
                <Loading
                  fallback={
                    <span class="flex items-center gap-1.5 text-muted-foreground">
                      <Spinner />
                      Checking against {base().name}…
                    </span>
                  }
                >
                  <Show
                    when={props.check()}
                    fallback={<span class="text-muted-foreground">Everything here is already on {base().name}</span>}
                  >
                    {(check) => (
                      <span class="flex items-start gap-1.5">
                        <MergeStatus base={base()} check={check()} />
                        <CheckAgain busy={props.rechecking()} onClick={props.onRecheck} />
                      </span>
                    )}
                  </Show>
                </Loading>
              </Errored>
            </Row>
          </>
        )}
      </Show>
    </dl>
  )
}

export function WorktreePreview(props: { path: string }) {
  const repo = useRepo()
  const id = untrack(() => RepoId.make(props.path))
  const [tick, setTick] = createSignal(0)
  const [allowLarge, setAllowLarge] = createSignal(false)
  onCleanup(
    subscribe(
      (git) => git.WatchRepo({ repo: id }),
      () => setTick((value) => value + 1),
    ),
  )

  const detail = createMemo(() => {
    tick()
    repo.track("refs")
    return call((git) => git.GetWorktree({ repo: id }))
  })
  const diff = createMemo(() => {
    tick()
    const large = allowLarge()
    return call((git) => git.GetWorktreeDiff({ repo: id, allowLarge: large }))
  })
  const [again, setAgain] = createSignal(0)
  const check = createMemo(() => {
    again()
    const { base, head, unique, entries } = detail()
    if (base === null || head._tag === "Unborn" || (unique === 0 && entries.length === 0)) return null
    return call((git) => git.CheckWorktreeMerge({ repo: id, base: base.oid }))
  })
  const summaries = createMemo(() => {
    tick()
    repo.track("refs", "worktree")
    return call((git) => git.GetWorktreeSummaries({ repo: repo.id })).catch(() => [])
  })
  const overlaps = createMemo(() => {
    const names = new Map(
      repo
        .refs()
        .worktrees.map((worktree) => [
          worktree.path,
          worktree.head._tag === "Branch" ? worktree.head.name : basename(worktree.path),
        ]),
    )
    const byPath = new Map<string, Array<string>>()
    for (const summary of summaries()) {
      if (summary.path === props.path) continue
      const name = names.get(summary.path) ?? basename(summary.path)
      for (const file of summary.paths) byPath.set(file, [...(byPath.get(file) ?? []), name])
    }
    return byPath
  })
  const changes = createMemo(() => {
    const current = diff()
    const counts = new Map(
      (current._tag === "Patch" ? patchItems(SECTION, current.patch) : []).map((item) => [
        item.path,
        item.fileDiff.hunks.reduce(
          (sum, hunk) => ({
            additions: sum.additions + hunk.additionLines,
            deletions: sum.deletions + hunk.deletionLines,
          }),
          { additions: 0, deletions: 0 },
        ),
      ]),
    )
    return { files: detail().entries.map((entry) => fileChange(entry, counts.get(entry.path))), diff: current }
  })

  return (
    <>
      <Errored
        fallback={(error) => (
          <div class="shrink-0 border-b px-3 py-1.5 text-xs text-destructive">
            Couldn't read this worktree. {describeError(error())}
          </div>
        )}
      >
        <Loading
          fallback={
            <div class="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
              <Spinner />
              Reading the worktree…
            </div>
          }
        >
          <Summary
            detail={detail()}
            check={check}
            rechecking={() => isPending(check)}
            onRecheck={() => setAgain((value) => value + 1)}
            overlaps={overlaps}
          />
        </Loading>
      </Errored>
      <PaneBoundary on={id} title="Couldn't read the changes">
        <Show when={changes()}>
          {(loaded) => (
            <FilesPane
              section={SECTION}
              files={loaded().files}
              diff={loaded().diff}
              empty="No uncommitted changes"
              onShowLarge={() => setAllowLarge(true)}
              root={props.path}
            />
          )}
        </Show>
      </PaneBoundary>
    </>
  )
}
