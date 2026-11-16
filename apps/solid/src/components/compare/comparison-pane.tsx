import { allRefsVisible, type Comparison, type Oid, type RepoId } from "@gitui/contracts"
import type { JSX } from "@solidjs/web"
import { Listbox, ListboxItem } from "@ui-sdk/solid/listbox"
import { children, createMemo, createSignal, Errored, For, Loading, Show } from "solid-js"
import { refLabel, walkRange } from "@/lib/comparison"
import { shortOid } from "@/lib/format"
import { useRepo } from "@/lib/repo"
import { ignoreWhitespace } from "@/lib/settings"
import { call, describeError, subscribe } from "@/lib/rpc"
import { FilesPane, PaneBoundary } from "../files-pane"
import { Spinner } from "../state"
import { Bar, ROW } from "../ui"
import { listDate } from "@/lib/dates"

const openLog = (repo: RepoId) => {
  let stop = () => {}
  const logId = new Promise<string>((resolve, reject) => {
    stop = subscribe(
      (git) => git.OpenLog({ repo, query: "", refs: allRefsVisible }),
      (handle) => resolve(handle.logId),
      reject,
    )
  })
  return { logId, stop: () => stop() }
}

const commitsBetween = async (repo: RepoId, head: Oid, base: Oid) => {
  if (head === base) return { commits: [], truncated: false }
  const log = openLog(repo)
  try {
    const logId = await log.logId
    return await walkRange((start, count) => call((git) => git.GetLogPage({ repo, logId, start, count })), head, base)
  } finally {
    log.stop()
  }
}

const ALL = "all"
const VISIBLE_COMMITS = 6

const plural = (count: number, word: string) => `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`

export function ComparisonPane(props: { comparison: Comparison; empty: string; actions?: JSX.Element }) {
  const repo = useRepo()
  const actions = children(() => props.actions)
  const [picked, setPicked] = createSignal<Oid | null>(null)
  const [allowLarge, setAllowLarge] = createSignal(false)

  const detail = createMemo(() => {
    const comparison = { base: props.comparison.base, head: props.comparison.head, mode: props.comparison.mode }
    repo.track("refs")
    return call((git) => git.GetComparison({ repo: repo.id, comparison }))
  })
  const range = createMemo(() => {
    const { head, base } = detail()
    return commitsBetween(repo.id, head, base)
  })
  const totals = createMemo(() =>
    detail().files.reduce(
      (sum, file) => ({ added: sum.added + (file.additions ?? 0), deleted: sum.deleted + (file.deletions ?? 0) }),
      { added: 0, deleted: 0 },
    ),
  )
  const shown = createMemo(() => {
    const oid = picked()
    const large = allowLarge()
    const whitespace = ignoreWhitespace()
    if (oid === null) {
      const { start, head, files } = detail()
      return call((git) =>
        git.GetDiff({
          repo: repo.id,
          target: { _tag: "Comparison", base: start, head },
          paths: [],
          ignoreWhitespace: whitespace,
          allowLarge: large,
        }),
      ).then((diff) => ({ files, diff }))
    }
    return Promise.all([
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
    ]).then(([commit, diff]) => ({ files: commit.files, diff }))
  })

  const label = (ref: string) => {
    if (ref !== "HEAD") return refLabel(ref)
    const head = repo.status().head
    return head._tag === "Detached" ? "HEAD" : head.name
  }
  const pick = (oid: Oid | null) => {
    setPicked(oid)
    setAllowLarge(false)
  }

  return (
    <>
      <Bar class="gap-1.5">
        <span class="min-w-0 shrink truncate font-mono font-medium select-text">{label(props.comparison.base)}</span>
        <span class="shrink-0 text-muted-foreground">←</span>
        <span class="min-w-0 shrink truncate font-mono font-medium select-text">{label(props.comparison.head)}</span>
        <Errored fallback={null}>
          <Loading fallback={<span class="shrink-0 text-muted-foreground">· …</span>}>
            <span class="shrink-0 text-muted-foreground tabular-nums">
              · {plural(range().commits.length, "commit")}
              {range().truncated ? "+" : ""}
            </span>
            <span class="shrink-0 font-mono text-2xs tabular-nums">
              <span class="text-muted-foreground">· </span>
              <Show when={totals().added > 0 || totals().deleted === 0}>
                <span class="text-change-added">+{totals().added.toLocaleString()}</span>{" "}
              </Show>
              <Show when={totals().deleted > 0}>
                <span class="text-change-deleted">−{totals().deleted.toLocaleString()}</span>
              </Show>
            </span>
          </Loading>
        </Errored>
        <div class="flex-1" />
        {actions()}
      </Bar>
      <Errored
        fallback={(error) => (
          <div class="shrink-0 border-b px-2 py-1.5 text-xs text-destructive">
            Couldn't list the commits. {describeError(error())}
          </div>
        )}
      >
        <Loading
          fallback={
            <div class="flex h-6 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
              <Spinner />
              Finding commits…
            </div>
          }
        >
          <Show when={range().commits.length > 0}>
            <div
              class="shrink-0 overflow-y-auto overscroll-none border-b"
              style={{ "max-height": `${(VISIBLE_COMMITS + 0.5) * ROW + 8}px` }}
            >
              <Listbox
                aria-label="Commits in this comparison"
                activation="automatic"
                value={picked() ?? ALL}
                onValueChange={(value) => {
                  if (value === ALL) pick(null)
                  else {
                    const commit = range().commits.find((candidate) => candidate.oid === value)
                    if (commit !== undefined) pick(commit.oid)
                  }
                }}
                class="flex flex-col p-1"
              >
                <ListboxItem
                  value={ALL}
                  label="All changes"
                  style={{ height: `${ROW}px` }}
                  class="flex items-center gap-2 rounded px-2 text-xs"
                >
                  <span class="min-w-0 flex-1 truncate">All changes</span>
                </ListboxItem>
                <For each={range().commits}>
                  {(commit) => (
                    <ListboxItem
                      value={commit.oid}
                      label={commit.subject}
                      style={{ height: `${ROW}px` }}
                      class="flex items-center gap-2 rounded px-2 text-xs"
                    >
                      <span class="w-14 shrink-0 font-mono text-2xs text-muted-foreground">{shortOid(commit.oid)}</span>
                      <span class="min-w-0 flex-1 truncate">{commit.subject}</span>
                      <span class="max-w-28 shrink-0 truncate text-2xs text-muted-foreground">{commit.author}</span>
                      <span class="w-11 shrink-0 text-end text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {listDate(commit.time)}
                      </span>
                    </ListboxItem>
                  )}
                </For>
              </Listbox>
              <Show when={range().truncated}>
                <p class="px-3 pb-1.5 text-2xs text-muted-foreground">
                  Showing the first {plural(range().commits.length, "commit")}.
                </p>
              </Show>
            </div>
          </Show>
        </Loading>
      </Errored>
      <PaneBoundary on={picked() ?? ALL} title="Couldn't compare these">
        <Show when={shown()}>
          {(loaded) => (
            <FilesPane
              section="compare"
              files={loaded().files}
              diff={loaded().diff}
              empty={picked() === null ? props.empty : "This commit has no file changes"}
              onShowLarge={() => setAllowLarge(true)}
            />
          )}
        </Show>
      </PaneBoundary>
    </>
  )
}
