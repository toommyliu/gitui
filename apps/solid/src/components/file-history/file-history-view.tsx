import type { FileHistory, FileHistoryEntry, FileIdentity, Oid, RepoPath } from "@gitui/contracts"
import { Listbox, ListboxItem } from "@ui-sdk/solid/listbox"
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/solid/segmented-control"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { basename, dirname, longDate, shortOid } from "@/lib/format"
import { useCommand } from "@/lib/hotkeys"
import { useRepo } from "@/lib/repo"
import { ignoreWhitespace } from "@/lib/settings"
import { call } from "@/lib/rpc"
import { DiffStack, LayoutButton, patchItems } from "../diff"
import { letterOf } from "../file-tree"
import { PaneBoundary } from "../files-pane"
import { Split } from "../split"
import { Boundary } from "../state"
import { Alert, Bar, Button, CopyHash, Empty, ROW, Tip } from "../ui"
import { Blame } from "./blame"
import { RestoreDialog } from "./restore-dialog"
import { listDate } from "@/lib/dates"

type Tab = "diff" | "blame"

const letterClass: Record<string, string> = {
  A: "text-change-added",
  D: "text-change-deleted",
  R: "text-change-renamed",
  C: "text-change-renamed",
}

const sourceOf = (entry: FileHistoryEntry): FileIdentity =>
  entry.change === "deleted" && entry.parent !== null
    ? { revision: entry.parent, path: entry.path }
    : { revision: entry.oid, path: entry.path }

function EntryDiff(props: { entry: FileHistoryEntry }) {
  const repo = useRepo()
  const [allowLarge, setAllowLarge] = createSignal(false)
  const diff = createMemo(() => {
    const { oid, path, from } = props.entry
    const large = allowLarge()
    const whitespace = ignoreWhitespace()
    return call((git) =>
      git.GetDiff({
        repo: repo.id,
        target: { _tag: "Commit", oid },
        paths: from === null ? [path] : [from, path],
        ignoreWhitespace: whitespace,
        allowLarge: large,
      }),
    )
  })
  const items = createMemo(() => {
    const value = diff()
    return value._tag === "Patch" ? patchItems("file-history", value.patch) : []
  })
  const tooLarge = () => {
    const value = diff()
    return value._tag === "TooLarge" ? value.bytes : 0
  }
  return (
    <PaneBoundary on={allowLarge()} title="Couldn't read this change">
      <Switch>
        <Match when={tooLarge() > 0}>
          <Empty title={`This diff is ${(tooLarge() / 1024 / 1024).toFixed(1)} MB`}>
            <p>Large diffs can slow the app down.</p>
            <Button class="mt-2" onClick={() => setAllowLarge(true)}>
              Show it anyway
            </Button>
          </Empty>
        </Match>
        <Match when={items().length === 0}>
          <Empty title="No text changes to show" />
        </Match>
        <Match when={items().length > 0}>
          <DiffStack items={items()} />
        </Match>
      </Switch>
    </PaneBoundary>
  )
}

function Version(props: {
  entry: FileHistoryEntry
  path: RepoPath
  tab: Tab
  onTab: (tab: Tab) => void
  known: (oid: Oid) => boolean
  onSelect: (oid: Oid) => void
}) {
  const [restoring, setRestoring] = createSignal(false)
  const [restored, setRestored] = createSignal(false)
  const source = () => sourceOf(props.entry)
  const note = () => {
    const entry = props.entry
    if (entry.change === "deleted") return "Deleted here. Blame shows the version before."
    if (entry.from !== null) return `${entry.change === "copied" ? "Copied" : "Renamed"} from ${entry.from}`
    if (entry.path !== props.path) return `At ${entry.path}`
    return null
  }
  return (
    <>
      <Bar class="gap-2">
        <SegmentedControl
          aria-label="Show"
          value={props.tab}
          onValueChange={(next: Tab | null) => {
            if (next !== null) props.onTab(next)
          }}
        >
          <SegmentedControlItem value="diff">Diff</SegmentedControlItem>
          <SegmentedControlItem value="blame">Blame</SegmentedControlItem>
        </SegmentedControl>
        <CopyHash oid={props.entry.oid} />
        <span class="min-w-0 truncate text-muted-foreground">
          {props.entry.author} · {longDate(props.entry.time)}
          <Show when={note()}>{(text) => <> · {text()}</>}</Show>
        </span>
        <div class="flex-1" />
        <Show when={props.tab === "diff"}>
          <LayoutButton />
        </Show>
        <Button
          onClick={() => {
            setRestored(false)
            setRestoring(true)
          }}
        >
          Restore this version…
        </Button>
        <RestoreDialog
          open={restoring()}
          onOpenChange={setRestoring}
          source={source()}
          destination={props.path}
          onRestored={() => setRestored(true)}
        />
      </Bar>
      <Show when={restored()}>
        <div class="shrink-0 border-b p-2">
          <Alert
            tone="success"
            title={`Restored ${basename(props.path)}`}
            onDismiss={() => setRestored(false)}
            class="pe-7"
          >
            {`Your working tree now has the version from ${shortOid(source().revision)}. The index is unchanged.`}
          </Alert>
        </div>
      </Show>
      <Switch>
        <Match when={props.tab === "diff"}>
          <EntryDiff entry={props.entry} />
        </Match>
        <Match when={props.tab === "blame"}>
          <Blame source={source()} selected={props.entry.oid} known={props.known} onSelect={props.onSelect} />
        </Match>
      </Switch>
    </>
  )
}

function Loaded(props: { path: RepoPath; history: FileHistory }) {
  const history = () => props.history
  const [picked, setPicked] = createSignal<Oid | null>(null)
  const [tab, setTab] = createSignal<Tab>("diff")
  const entries = () => history().entries
  const index = createMemo(() => {
    const found = entries().findIndex((entry) => entry.oid === picked())
    return found === -1 ? 0 : found
  })
  const entry = () => entries()[index()]
  let list: HTMLDivElement | undefined

  const select = (oid: Oid) => {
    setPicked(oid)
    list?.querySelector(`[data-oid="${CSS.escape(oid)}"]`)?.scrollIntoView({ block: "nearest" })
  }
  const step = (delta: 1 | -1) => {
    const next = entries()[Math.max(0, Math.min(entries().length - 1, index() + delta))]
    if (next !== undefined) select(next.oid)
  }
  useCommand("list.next", () => step(1))
  useCommand("list.previous", () => step(-1))

  return (
    <Show
      when={entries().length > 0}
      fallback={<Empty title="No commits changed this file">{props.path} has no history at HEAD.</Empty>}
    >
      <Split
        id="file-history"
        listLabel="commits"
        collapsed={false}
        list={
          <>
            <Bar>
              <span class="font-medium">Commits</span>
              <span class="text-2xs text-muted-foreground tabular-nums">
                {entries().length.toLocaleString()}
                {history().truncated ? "+" : ""}
              </span>
            </Bar>
            <div ref={list} class="min-h-0 flex-1 overflow-y-auto overscroll-none">
              <Listbox
                aria-label="Commits that changed this file"
                activation="automatic"
                value={entry()?.oid ?? null}
                onValueChange={(value) => {
                  const found = entries().find((candidate) => candidate.oid === value)
                  if (found !== undefined) select(found.oid)
                }}
                class="flex flex-col p-1"
              >
                <For each={entries()}>
                  {(candidate) => (
                    <ListboxItem
                      value={candidate.oid}
                      label={candidate.subject}
                      data-oid={candidate.oid}
                      style={{ height: `${ROW}px` }}
                      class="flex items-center gap-2 rounded px-2 text-xs"
                    >
                      <span
                        class={[
                          "w-2.5 shrink-0 text-center font-mono text-2xs font-semibold",
                          letterClass[letterOf(candidate.change)] ?? "text-change-modified",
                        ]}
                      >
                        {letterOf(candidate.change)}
                      </span>
                      <span class="min-w-0 flex-1 truncate">{candidate.subject}</span>
                      <span class="w-11 shrink-0 text-end text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {listDate(candidate.time)}
                      </span>
                    </ListboxItem>
                  )}
                </For>
              </Listbox>
              <Show when={history().truncated}>
                <p class="px-3 pb-2 text-2xs text-muted-foreground">
                  Only the {entries().length.toLocaleString()} most recent commits are listed.
                </p>
              </Show>
            </div>
          </>
        }
      >
        <Show when={entry()} keyed>
          {(current) => (
            <Version
              entry={current}
              path={props.path}
              tab={tab()}
              onTab={setTab}
              known={(oid) => entries().some((candidate) => candidate.oid === oid)}
              onSelect={select}
            />
          )}
        </Show>
      </Split>
    </Show>
  )
}

export function FileHistoryView(props: { path: RepoPath; onClose: () => void }) {
  const repo = useRepo()
  const history = createMemo(() => {
    const path = props.path
    repo.track("refs")
    return call((git) => git.GetFileHistory({ repo: repo.id, revision: "HEAD", path }))
  })
  useCommand("view.back", () => props.onClose())
  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <Bar class="gap-2">
        <span class="section-label">History</span>
        <span class="min-w-0 truncate font-mono select-text">
          <span class="text-muted-foreground">{dirname(props.path)}</span>
          <span class="font-medium">{basename(props.path)}</span>
        </span>
        <div class="flex-1" />
        <Tip label="Close" keys="Esc">
          {(trigger) => (
            <Button {...trigger} variant="ghost" onClick={() => props.onClose()}>
              Close
            </Button>
          )}
        </Tip>
      </Bar>
      <div class="flex min-h-0 flex-1 flex-col">
        <Boundary label="Reading the file's history" title="Couldn't read this file's history" on={props.path}>
          <Loaded path={props.path} history={history()} />
        </Boundary>
      </div>
    </div>
  )
}
