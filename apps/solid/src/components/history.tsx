import type { CommitDetail as CommitDetailData, FileDiff, Oid } from "@gitui/contracts"
import { createEffect, createMemo, createSignal, onCleanup, Show, useContext } from "solid-js"
import { CommandScope, useCommand } from "@/lib/hotkeys"
import { createLog } from "@/lib/log"
import { useRepo } from "@/lib/repo"
import { ignoreWhitespace } from "@/lib/settings"
import { call } from "@/lib/rpc"
import { CommitDialogs, CommitMenuItems, createCommitActions, OutcomeStrip } from "./commits/actions"
import { CommitDetail } from "./history/commit-detail"
import { CommitList, type RowSpan } from "./history/commit-list"
import { RangeDetail } from "./history/range-detail"
import { Split } from "./split"
import { Boundary, Centered, Failure, Spinner } from "./state"
import { Empty, SearchBar } from "./ui"
import { createCache } from "@/lib/prefetch"

const CACHED = 60
const NEIGHBORS = [1, -1, 2, -2, 3]

export function HistoryView(props: { focused: boolean; revealed: { readonly oid: Oid } | null }) {
  const repo = useRepo()
  const actions = createCommitActions()
  const [typed, setTyped] = createSignal("")
  const [query, setQuery] = createSignal("")
  const log = createLog(repo, query)
  const [picked, setPicked] = createSignal<Oid | null>(null)
  const [anchor, setAnchor] = createSignal<Oid | null>(null)
  const [largeFor, setLargeFor] = createSignal<string | null>(null)
  const selected = createMemo(() => picked() ?? log.row(0)?.oid ?? null)
  const index = createMemo(() => {
    const oid = selected()
    return oid === null ? -1 : log.indexOf(oid)
  })
  const span = createMemo((): RowSpan | null => {
    const from = anchor()
    const to = index()
    const start = from === null ? -1 : log.indexOf(from)
    if (start < 0 || to < 0 || start === to) return null
    return { top: Math.min(start, to), bottom: Math.max(start, to) }
  })
  const newest = createMemo(() => {
    const current = span()
    return current === null ? null : (log.row(current.top)?.oid ?? null)
  })
  const oldest = createMemo(() => {
    const current = span()
    return current === null ? null : (log.row(current.bottom)?.oid ?? null)
  })
  const rangeKey = () => {
    const head = newest()
    const base = oldest()
    return head === null || base === null ? null : `${base}..${head}`
  }
  let search: HTMLInputElement | undefined
  let detailPane: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const single = () => (span() === null ? selected() : null)
  const details = createCache<CommitDetailData>(CACHED)
  const diffs = createCache<FileDiff>(CACHED)
  const loadDetail = (oid: Oid) => details.get(oid, () => call((git) => git.GetCommit({ repo: repo.id, oid })))
  const loadDiff = (oid: Oid, whitespace: boolean, large: boolean) =>
    diffs.get(`${oid}:${whitespace}:${large}`, () =>
      call((git) =>
        git.GetDiff({
          repo: repo.id,
          target: { _tag: "Commit", oid },
          paths: [],
          ignoreWhitespace: whitespace,
          allowLarge: large,
        }),
      ),
    )
  const detail = createMemo(() => {
    const oid = single()
    return oid === null ? null : loadDetail(oid)
  })
  const diff = createMemo(() => {
    const oid = single()
    return oid === null ? null : loadDiff(oid, ignoreWhitespace(), largeFor() === oid)
  })
  createEffect(
    () => {
      const at = index()
      const oids = at < 0 ? [] : NEIGHBORS.flatMap((offset) => log.row(at + offset)?.oid ?? [])
      return { oids, whitespace: ignoreWhitespace() }
    },
    ({ oids, whitespace }) => {
      for (const oid of oids) {
        void Promise.resolve(loadDetail(oid)).catch(() => undefined)
        void Promise.resolve(loadDiff(oid, whitespace, false)).catch(() => undefined)
      }
    },
  )
  const range = createMemo(() => {
    const head = newest()
    const base = oldest()
    if (head === null || base === null) return null
    const allowLarge = largeFor() === rangeKey()
    const whitespace = ignoreWhitespace()
    return call((git) => git.GetComparison({ repo: repo.id, comparison: { base, head, mode: "range" } })).then(
      async (comparison) => ({
        comparison,
        diff: await call((git) =>
          git.GetDiff({
            repo: repo.id,
            target: { _tag: "Comparison", base: comparison.start, head: comparison.head },
            paths: [],
            ignoreWhitespace: whitespace,
            allowLarge,
          }),
        ),
      }),
    )
  })
  const rangeCommits = () => {
    const current = span()
    if (current === null) return []
    return Array.from({ length: current.bottom - current.top + 1 }, (_, offset) =>
      log.row(current.top + offset),
    ).filter((row) => row !== undefined)
  }

  const typedSearch = (value: string) => {
    setTyped(value)
    clearTimeout(timer)
    timer = setTimeout(() => {
      setPicked(null)
      setAnchor(null)
      setQuery(value.trim())
    }, 250)
  }

  let selecting = 0
  const select = async (target: number, extend: boolean) => {
    const ticket = ++selecting
    const row = await log.rowAt(target)
    if (row === undefined || ticket !== selecting) return
    setAnchor(extend ? (anchor() ?? selected()) : null)
    setPicked(row.oid)
  }
  const step = (delta: 1 | -1, extend: boolean) => {
    const last = (log.handle()?.loaded ?? 0) - 1
    if (last >= 0) void select(Math.max(0, Math.min(last, index() + delta)), extend)
  }

  let shown: { readonly oid: Oid } | null = null
  let located: { readonly oid: Oid } | null = null
  createEffect(
    () => ({ request: props.revealed, logId: log.handle()?.logId }),
    ({ request, logId }) => {
      if (request === null) return
      if (request !== shown) {
        shown = request
        setAnchor(null)
        setPicked(request.oid)
      }
      if (logId === undefined || located === request) return
      located = request
      void call((git) => git.GetLogIndex({ repo: repo.id, logId, oid: request.oid })).then(
        (target) => {
          if (target !== null && picked() === request.oid) void select(target, false)
        },
        () => undefined,
      )
    },
  )

  const copySelected = () => {
    const oid = selected()
    if (oid === null) return
    const pill = detailPane?.querySelector<HTMLElement>(
      span() === null ? `[data-copy="${oid}"] button` : "[data-copy-range] button",
    )
    if (pill === null || pill === undefined) void navigator.clipboard.writeText(oid)
    else pill.click()
  }
  const rewriteFrom = () => oldest() ?? selected()

  useCommand("list.next", () => step(1, false))
  useCommand("list.previous", () => step(-1, false))
  useCommand("history.extendNext", () => step(1, true))
  useCommand("history.extendPrevious", () => step(-1, true))
  useCommand("history.search", () => search?.select())
  useCommand("view.search", () => search?.select())
  const inScope = useContext(CommandScope)
  const canCopy = () =>
    selected() !== null &&
    window.getSelection()?.isCollapsed !== false &&
    detailPane?.contains(document.activeElement) !== true
  useCommand("history.copySha", copySelected, canCopy)
  const copyFromMenu = (event: ClipboardEvent) => {
    const target = document.activeElement
    if (!inScope() || !canCopy() || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    event.preventDefault()
    copySelected()
  }
  document.addEventListener("copy", copyFromMenu)
  onCleanup(() => document.removeEventListener("copy", copyFromMenu))
  useCommand(
    "commit.rewrite",
    () => {
      const first = rewriteFrom()
      if (first !== null) actions.rewrite(first)
    },
    () => rewriteFrom() !== null && actions.canRewrite(),
  )

  const empty = () => log.handle()?.done === true && log.handle()?.loaded === 0

  const pending = () => (
    <Centered>
      <Spinner />
    </Centered>
  )

  return (
    <Split
      id="history"
      listLabel="commits"
      collapsed={props.focused}
      list={
        <>
          <SearchBar
            label="Search history"
            placeholder="Search commits, author:, path:"
            value={typed()}
            onInput={typedSearch}
            ref={(element) => (search = element)}
          />
          <Show
            when={log.error() === null}
            fallback={<Failure error={log.error()} title="Couldn't read history" onRetry={log.retry} />}
          >
            <Show
              when={log.handle() !== null && !empty()}
              fallback={
                empty() ? (
                  query() === "" ? (
                    <Empty title="No commits yet">Commits on this repository show up here.</Empty>
                  ) : (
                    <Empty title="No matching commits">
                      Search matches commit messages. Use author:name or path:dir to narrow it.
                    </Empty>
                  )
                ) : (
                  pending()
                )
              }
            >
              <CommitList
                log={log}
                selected={index()}
                range={span()}
                onSelect={(target, extend) => void select(target, extend)}
                menu={(row) => <CommitMenuItems actions={actions} commit={row} selected={row.oid === selected()} />}
              />
            </Show>
          </Show>
        </>
      }
    >
      <div ref={detailPane} class="flex h-full min-h-0 flex-col">
        <OutcomeStrip outcome={actions.outcome()} onDismiss={() => actions.setOutcome(null)} />
        <Show when={selected() !== null} fallback={empty() ? <Empty title="No commit selected" /> : pending()}>
          <Boundary on={rangeKey() ?? selected()} title="Couldn't load this commit">
            <Show
              when={span()}
              fallback={
                <Show when={detail()} keyed>
                  {(loaded) => (
                    <Show when={diff()}>
                      {(fileDiff) => (
                        <CommitDetail
                          detail={loaded}
                          diff={fileDiff()}
                          onShowLarge={() => setLargeFor(loaded.oid)}
                          onSelectCommit={(oid) => {
                            setAnchor(null)
                            setPicked(oid)
                          }}
                          menu={() => <CommitMenuItems actions={actions} commit={loaded} selected />}
                        />
                      )}
                    </Show>
                  )}
                </Show>
              }
            >
              {(current) => (
                <Show when={range()}>
                  {(loaded) => (
                    <RangeDetail
                      count={current().bottom - current().top + 1}
                      commits={rangeCommits()}
                      detail={loaded().comparison}
                      diff={loaded().diff}
                      onShowLarge={() => setLargeFor(rangeKey())}
                    />
                  )}
                </Show>
              )}
            </Show>
          </Boundary>
        </Show>
        <CommitDialogs actions={actions} />
      </div>
    </Split>
  )
}
