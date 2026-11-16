import type { DiscardBackup, FileDiff, LineAction, RepoPath, StatusEntry } from "@gitui/contracts"
import type { CodeViewLineSelection } from "@pierre/diffs"
import { Checkbox, CheckboxIndicator } from "@ui-sdk/solid/checkbox"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuShortcut, MenuTrigger } from "@ui-sdk/solid/menu"
import { Input } from "@ui-sdk/solid/input"
import { Textarea } from "@ui-sdk/solid/textarea"
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createSignal,
  onCleanup,
  resolve,
  Show,
  untrack,
} from "solid-js"
import { basename } from "@/lib/format"
import { shortcut, useCommand } from "@/lib/hotkeys"
import { filterFiles } from "@/lib/change-search"
import { joinMessage, splitMessage } from "@/lib/commit-message"
import { isTestFile } from "@/lib/file-kind"
import { hideTests, subjectGuide } from "@/lib/settings"
import { selectedChanges } from "@/lib/lines"
import { useRepo } from "@/lib/repo"
import { call, collect, describeError } from "@/lib/rpc"
import { DiffControls, DiffStack, type DiffHandle, type DiffItem, patchItems, sectionOf } from "./diff"
import { discardSubject, type Recovery, RecoveryDialog } from "./discard-recovery"
import { type FileEntry, FileTree, fileOrder, type Letter, letterOf, type SelectHow } from "./file-tree"
import { Confirm } from "./refs/confirm"
import { Split } from "./split"
import { Boundary } from "./state"
import { ConflictResolver } from "./conflicts/conflict-resolver"
import { OperationBanner } from "./conflicts/operation-banner"
import { More } from "./icons"
import { Alert, Bar, Button, Empty, type Failure, Failures, Kbd, SearchBar, Tip } from "./ui"
import { OpenInItems } from "./open-in"

type Staged = "full" | "partial" | "none"

interface Row {
  readonly path: RepoPath
  readonly letter: Letter
  readonly staged: Staged
  readonly untracked: boolean
  readonly conflicted: boolean
}

const MAX_UNTRACKED_PREVIEWS = 50

const toRow = (entry: StatusEntry): Row => {
  switch (entry._tag) {
    case "Untracked":
      return { path: entry.path, letter: "?", staged: "none", untracked: true, conflicted: false }
    case "Conflicted":
      return { path: entry.path, letter: "!", staged: "none", untracked: false, conflicted: true }
    case "Tracked": {
      const staged: Staged = entry.staged === null ? "none" : entry.unstaged === null ? "full" : "partial"
      return {
        path: entry.path,
        letter: letterOf(entry.unstaged ?? entry.staged ?? "modified"),
        staged,
        untracked: false,
        conflicted: false,
      }
    }
  }
}

const sectionLabels: Record<string, string> = { unstaged: "Unstaged", staged: "Staged", untracked: "Untracked" }

const patchOf = (diff: FileDiff | null) => (diff?._tag === "Patch" ? diff.patch : "")

const discardable = (row: Row) => !row.conflicted && row.staged !== "full"

function CommitBox(props: { stagedCount: number; draft: string }) {
  const repo = useRepo()
  const [message, setMessage] = createSignal<string | null>(null)
  const [amend, setAmend] = createSignal(false)
  const [running, setRunning] = createSignal(false)
  const text = () => message() ?? props.draft
  const fields = createMemo(() => splitMessage(text()))
  const subjectLength = () => fields().summary.trimEnd().length
  let description: HTMLTextAreaElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const edit = (value: string) => {
    setMessage(value)
    clearTimeout(timer)
    timer = setTimeout(() => void call((git) => git.SetDraft({ repo: repo.id, message: value })), 400)
  }

  const [failure, setFailure] = createSignal<string | null>(null)

  const canCommit = () => !running() && text().trim() !== "" && (props.stagedCount > 0 || amend())

  const commit = async () => {
    if (!canCommit()) return
    const value = untrack(text)
    setRunning(true)
    setFailure(null)
    try {
      await collect((git) => git.Commit({ repo: repo.id, message: value, amend: untrack(amend) }))
      clearTimeout(timer)
      setMessage("")
      setAmend(false)
      await call((git) => git.SetDraft({ repo: repo.id, message: "" }))
    } catch (error) {
      setFailure(describeError(error))
    } finally {
      setRunning(false)
      repo.invalidate(["refs", "draft"])
    }
  }

  useCommand("commit.create", () => void commit())

  return (
    <form
      class="@container flex shrink-0 flex-col gap-1.5 border-t p-2"
      onSubmit={(event) => {
        event.preventDefault()
        void commit()
      }}
    >
      <Show when={failure()}>
        {(message) => (
          <Alert tone="error" title="Commit failed" onDismiss={() => setFailure(null)} class="pe-7">
            {message()}
          </Alert>
        )}
      </Show>
      <div class="relative flex">
        <Input
          aria-label="Commit summary"
          placeholder="Summary"
          value={fields().summary}
          onInput={(event) => edit(joinMessage(event.currentTarget.value, fields().description))}
          style={{ "padding-inline-end": subjectGuide() === "off" ? undefined : "3.5rem" }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return
            event.preventDefault()
            description?.focus()
          }}
          class="h-7 min-w-0 flex-1 rounded-md border bg-background ps-2 pe-2 text-xs font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground focus:border-ring"
        />
        <Show when={subjectGuide() !== "off"}>
          <span
            aria-live="polite"
            class={[
              "pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 font-mono text-2xs tabular-nums",
              subjectLength() > Number(subjectGuide()) ? "text-destructive" : "text-muted-foreground",
            ]}
          >
            {subjectLength()}/{subjectGuide()}
          </span>
        </Show>
      </div>
      <Textarea
        ref={(element: HTMLTextAreaElement) => (description = element)}
        aria-label="Commit description"
        placeholder="Description"
        value={fields().description}
        onInput={(event) => edit(joinMessage(fields().summary, event.currentTarget.value))}
        class="min-h-16 resize-none rounded-md px-2 py-1.5 text-xs leading-relaxed"
      />
      <div class="flex items-center gap-2">
        <label class="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={amend()} onCheckedChange={(checked) => setAmend(checked === true)}>
            <CheckboxIndicator />
          </Checkbox>
          Amend
        </label>
        <div class="flex-1" />
        <Button type="submit" variant="primary" disabled={!canCommit()}>
          <span>
            {amend() ? "Amend" : "Commit"}
            <Show when={amend() || props.stagedCount > 0}>
              <span class="hidden @[15rem]:inline">
                {amend() ? " commit" : props.stagedCount === 1 ? " 1 file" : ` ${props.stagedCount} files`}
              </span>
            </Show>
          </span>
          <span class="hidden @[18rem]:inline">
            <Kbd>{shortcut("commit.create")}</Kbd>
          </span>
        </Button>
      </div>
    </form>
  )
}

function DockBar(props: {
  file: string | null
  items: ReadonlyArray<DiffItem>
  selection: CodeViewLineSelection | null
  onClear: () => void
  onApply: (action: LineAction, item: DiffItem, selection: CodeViewLineSelection) => void
}) {
  const item = () => {
    const selection = props.selection
    return selection === null ? undefined : props.items.find((candidate) => candidate.id === selection.id)
  }
  const count = () => {
    const selection = props.selection
    const found = item()
    return selection === null || found === undefined ? 0 : selectedChanges(found.fileDiff, selection.range).length
  }
  const run = (lineAction: LineAction) => {
    const selection = props.selection
    const found = item()
    if (selection !== null && found !== undefined) props.onApply(lineAction, found, selection)
  }
  const section = () => {
    const found = item()
    return found === undefined ? null : sectionOf(found.id)
  }
  useCommand(
    "lines.stage",
    () => run("stage"),
    () => section() === "unstaged" || section() === "untracked",
  )
  useCommand(
    "lines.unstage",
    () => run("unstage"),
    () => section() === "staged",
  )
  useCommand(
    "lines.discard",
    () => run("discard"),
    () => section() === "unstaged",
  )
  useCommand("lines.clear", props.onClear, () => props.selection !== null)

  const action = (label: string, key: string | undefined, lineAction: LineAction, primary = false) => (
    <Button variant={primary ? "primary" : "ghost"} onClick={() => run(lineAction)}>
      {label}
      <Kbd>{key}</Kbd>
    </Button>
  )

  return (
    <div class="flex h-8 shrink-0 items-center gap-1.5 border-t bg-[color-mix(in_oklab,var(--muted)_30%,var(--background))] px-2 text-xs">
      <Show
        when={item()}
        fallback={
          <span class="truncate text-muted-foreground">
            {props.file === null ? "Select lines in the diff to stage or discard them" : props.file}
          </span>
        }
      >
        {(found) => (
          <>
            <span class="truncate">
              {count()} {count() === 1 ? "line" : "lines"} in {basename(found().path)}
              <span class="ms-1.5 text-muted-foreground">{sectionLabels[sectionOf(found().id)]}</span>
            </span>
            <div class="flex-1" />
            <Show when={section() === "staged"}>{action("Unstage", shortcut("lines.unstage"), "unstage", true)}</Show>
            <Show when={section() === "unstaged"}>{action("Discard", shortcut("lines.discard"), "discard")}</Show>
            <Show when={section() !== "staged"}>{action("Stage", shortcut("lines.stage"), "stage", true)}</Show>
            <Button variant="ghost" onClick={props.onClear}>
              Clear
              <Kbd>Esc</Kbd>
            </Button>
          </>
        )}
      </Show>
    </div>
  )
}

function Diffs(props: {
  rows: ReadonlyArray<Row>
  file: string | null
  onTopFile: (path: string) => void
  ref: (handle: DiffHandle) => void
}) {
  const repo = useRepo()
  const [allowLarge, setAllowLarge] = createSignal(false)
  const diffOf = (target: "Unstaged" | "Staged") =>
    createMemo(() => {
      repo.track("worktree", "index", "refs")
      return call((git) =>
        git.GetDiff({
          repo: repo.id,
          target: { _tag: target },
          paths: [],
          ignoreWhitespace: false,
          allowLarge: allowLarge(),
        }),
      )
    })
  const unstaged = diffOf("Unstaged")
  const staged = diffOf("Staged")
  const previewed = createMemo(() =>
    props.rows
      .filter((row) => row.untracked)
      .slice(0, MAX_UNTRACKED_PREVIEWS)
      .map((row) => row.path),
  )
  const onDemand = createMemo((previous: RepoPath | null = null) => {
    const row = props.rows.find((candidate) => candidate.untracked && candidate.path === props.file)
    return row === undefined || previewed().includes(row.path) ? previous : row.path
  })
  const untrackedPaths = createMemo(() => {
    const extra = onDemand()
    return extra === null ? previewed() : [extra, ...previewed().slice(0, MAX_UNTRACKED_PREVIEWS - 1)]
  })
  const untracked = createMemo(() => {
    const paths = untrackedPaths()
    repo.track("worktree")
    return paths.length === 0
      ? null
      : call((git) =>
          git.GetDiff({
            repo: repo.id,
            target: { _tag: "Untracked" },
            paths,
            ignoreWhitespace: false,
            allowLarge: allowLarge(),
          }),
        )
  })
  const tooLarge = () =>
    [unstaged(), staged(), untracked()].reduce(
      (bytes, diff) => (diff?._tag === "TooLarge" ? bytes + diff.bytes : bytes),
      0,
    )

  const items = createMemo(() => {
    const all = [
      ...patchItems("unstaged", patchOf(unstaged())),
      ...patchItems("untracked", patchOf(untracked())),
      ...patchItems("staged", patchOf(staged())),
    ]
    const order = new Map(fileOrder(props.rows.map((row) => row.path)).map((path, index) => [path, index]))
    const rank = { unstaged: 0, untracked: 0, staged: 1 } as Record<string, number>
    return all.sort(
      (a, b) =>
        (order.get(a.path) ?? Infinity) - (order.get(b.path) ?? Infinity) ||
        (rank[sectionOf(a.id)] ?? 0) - (rank[sectionOf(b.id)] ?? 0),
    )
  })

  let handle: DiffHandle | undefined
  let revealed: string | null = null
  createEffect(
    () => {
      const extra = onDemand()
      const id = extra === null ? null : `untracked\n${extra}`
      return id !== null && items().some((item) => item.id === id) ? id : null
    },
    (id: string | null) => {
      if (id === null || id === revealed) return
      revealed = id
      handle?.scrollToItem(id)
    },
  )

  const [selection, setSelection] = createSignal<CodeViewLineSelection | null>(null)

  const [failure, setFailure] = createSignal<Failure | null>(null)

  const apply = async (lineAction: LineAction, item: DiffItem, range: CodeViewLineSelection) => {
    const lines = selectedChanges(item.fileDiff, range.range)
    if (lines.length === 0) return
    setFailure(null)
    try {
      await repo.mutate(lineAction === "discard" ? ["worktree"] : ["index"], (git) =>
        git.ApplyLines({ repo: repo.id, action: lineAction, path: item.path as RepoPath, lines }),
      )
      setSelection(null)
    } catch (error) {
      setFailure({ title: `Couldn't ${lineAction} those lines`, message: describeError(error) })
    }
  }

  return (
    <>
      <Show
        when={tooLarge() === 0}
        fallback={
          <Empty title={`These changes are large (${Math.round(tooLarge() / 1024)} KB)`}>
            <Button class="mt-2" onClick={() => setAllowLarge(true)}>
              Show them anyway
            </Button>
          </Empty>
        }
      >
        <Show when={items().length > 0} fallback={<Empty title="No text changes to show" />}>
          <DiffStack
            items={items()}
            selection={selection()}
            onSelectionChange={setSelection}
            onTopItemChange={(id) => {
              const item = items().find((candidate) => candidate.id === id)
              if (item !== undefined) props.onTopFile(item.path)
            }}
            headerLabel={(id) => sectionLabels[sectionOf(id)] ?? ""}
            ref={(next) => {
              handle = next
              props.ref(next)
            }}
          />
        </Show>
      </Show>
      <Failures failure={failure()} onDismiss={() => setFailure(null)} edge="top" />
      <DockBar
        file={props.file}
        items={items()}
        selection={selection()}
        onClear={() => setSelection(null)}
        onApply={(lineAction, item, range) => void apply(lineAction, item, range)}
      />
    </>
  )
}

export function ChangesView(props: { focused: boolean }) {
  const repo = useRepo()
  const draft = createMemo(() => {
    repo.track("draft")
    return call((git) => git.GetDraft({ repo: repo.id }))
  })
  const rows = createMemo(() => repo.status().entries.map(toRow))
  const fullyStaged = createMemo(() =>
    rows()
      .filter((row) => row.staged === "full")
      .map((row) => row.path as string),
  )
  const [checked, setChecked] = createOptimistic(() => fullyStaged())
  const [selected, setSelected] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal("")
  let filterInput: HTMLInputElement | undefined
  useCommand("view.search", () => filterInput?.select())
  const visibleRows = createMemo(() => filterFiles(rows(), filter()))
  const testCount = createMemo(() => visibleRows().filter((row) => isTestFile(row.path)).length)
  const diffRows = createMemo(() =>
    hideTests() ? visibleRows().filter((row) => !isTestFile(row.path)) : visibleRows(),
  )
  const [diff, setDiff] = createSignal<DiffHandle>()

  const files = createMemo((): Array<FileEntry> =>
    visibleRows().map((row) => ({
      path: row.path,
      letter: row.letter,
      partial: row.staged === "partial",
      disabled: false,
    })),
  )

  const [failure, setFailure] = createSignal<Failure | null>(null)

  const updateIndex = action(function* (change: { add: Array<RepoPath>; remove: Array<RepoPath> }) {
    setFailure(null)
    const removed = new Set<string>(change.remove)
    setChecked([...new Set([...checked(), ...change.add])].filter((path) => !removed.has(path)))
    try {
      if (change.add.length > 0) yield call((git) => git.Stage({ repo: repo.id, paths: change.add }))
      if (change.remove.length > 0) yield call((git) => git.Unstage({ repo: repo.id, paths: change.remove }))
    } catch (error) {
      setFailure({ title: "Couldn't update the index", message: describeError(error) })
    }
    repo.invalidate(["index"])
    yield resolve(() => repo.status())
  })

  const stage = (next: Array<string>) => {
    const before = new Set(fullyStaged())
    const after = new Set(next)
    return updateIndex({
      add: next.filter((path) => !before.has(path) && rowOf(path)?.conflicted !== true) as Array<RepoPath>,
      remove: [...before].filter((path) => !after.has(path)) as Array<RepoPath>,
    })
  }

  const rowOf = (path: string) => rows().find((row) => row.path === path)

  const [confirming, setConfirming] = createSignal<ReadonlyArray<RepoPath> | null>(null)
  const [discarding, setDiscarding] = createSignal(false)
  const [discardError, setDiscardError] = createSignal<string | null>(null)
  const [discarded, setDiscarded] = createSignal<DiscardBackup | null>(null)
  const [recovery, setRecovery] = createSignal<Recovery | null>(null)

  const askDiscard = (paths: ReadonlyArray<RepoPath>) => {
    if (paths.length === 0) return
    setDiscardError(null)
    setConfirming(paths)
  }

  const discard = async () => {
    const paths = confirming()
    if (paths === null) return
    setDiscarding(true)
    try {
      const backup = await repo.mutate(["worktree"], (git) => git.Discard({ repo: repo.id, paths }))
      setDiscarded(backup)
      setConfirming(null)
    } catch (error) {
      setDiscardError(describeError(error))
    } finally {
      setDiscarding(false)
    }
  }

  const undo = async (backup: DiscardBackup) => {
    setFailure(null)
    try {
      const result = await repo.mutate(["worktree"], (git) =>
        git.RestoreDiscard({ repo: repo.id, id: backup.id, overwriteVersion: null }),
      )
      setDiscarded(null)
      if (result._tag === "Conflict")
        setRecovery({ kind: "Conflict", conflict: { backup, paths: result.paths, version: result.version } })
    } catch (error) {
      setFailure({ title: "Couldn't undo the discard", message: describeError(error) })
    }
  }

  const copyPath = async (path: string) => {
    setFailure(null)
    try {
      await navigator.clipboard.writeText(path)
    } catch (error) {
      setFailure({ title: "Couldn't copy the path", message: describeError(error) })
    }
  }

  const fileMenu = (path: string) => {
    const inSelection = untrack(() => marked().size > 1 && marked().has(path))
    const menuTargets = () =>
      inSelection ? targets() : rows().filter((row) => row.path === path || row.path.startsWith(`${path}/`))
    const paths = (keep: (row: Row) => boolean) =>
      menuTargets()
        .filter(keep)
        .map((row) => row.path)
    const toStage = () => paths((row) => row.staged !== "full" && !row.conflicted)
    const toUnstage = () => paths((row) => row.staged !== "none")
    const toDiscard = () => paths(discardable)
    const deleted = () => rowOf(path)?.letter === "D"
    const isSelected = untrack(() => selected() === path || inSelection)
    return (
      <>
        <Show when={toStage().length > 0}>
          <MenuItem onSelect={() => void updateIndex({ add: toStage(), remove: [] })}>Stage</MenuItem>
        </Show>
        <Show when={toUnstage().length > 0}>
          <MenuItem onSelect={() => void updateIndex({ add: [], remove: toUnstage() })}>Unstage</MenuItem>
        </Show>
        <MenuItem disabled={toDiscard().length === 0} class="text-destructive" onSelect={() => askDiscard(toDiscard())}>
          Discard changes…
          {isSelected && <MenuShortcut>{shortcut("files.discard")}</MenuShortcut>}
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => void copyPath(path)}>Copy path</MenuItem>
        <OpenInItems repo={repo.id} path={path} disabled={deleted()} onFailure={setFailure} />
      </>
    )
  }

  const allPaths = () =>
    rows()
      .filter((row) => !row.conflicted)
      .map((row) => row.path as string)
  const allStaged = () => rows().length > 0 && rows().every((row) => row.staged === "full")
  useCommand("files.stageAll", () => void stage(allPaths()))
  useCommand("files.unstageAll", () => void stage([]))
  useCommand(
    "files.discard",
    () =>
      askDiscard(
        targets()
          .filter(discardable)
          .map((row) => row.path),
      ),
    () => targets().some(discardable),
  )

  const [marked, setMarked] = createSignal<ReadonlySet<string>>(new Set())
  let anchor: string | null = null
  const order = createMemo(() => fileOrder(visibleRows().map((row) => row.path)))

  const reveal = (path: string) => {
    const row = rowOf(path)
    if (row === undefined || row.conflicted) return
    const section = row.untracked ? "untracked" : row.staged === "full" ? "staged" : "unstaged"
    diff()?.scrollToItem(`${section}\n${path}`)
  }

  const select = (path: string, how: SelectHow = "replace") => {
    setSelected(path)
    if (how === "toggle") {
      const next = new Set(marked())
      if (next.has(path)) next.delete(path)
      else next.add(path)
      setMarked(next)
      anchor = path
    } else if (how === "range" && anchor !== null) {
      const list = order()
      const from = list.indexOf(anchor)
      const to = list.indexOf(path)
      if (from === -1 || to === -1) setMarked(new Set([path]))
      else setMarked(new Set(list.slice(Math.min(from, to), Math.max(from, to) + 1)))
    } else {
      setMarked(new Set([path]))
      anchor = path
    }
    reveal(path)
  }

  const neighbor = (delta: 1 | -1) => {
    const list = order()
    const index = list.indexOf(selected() ?? "")
    return list[Math.max(0, Math.min(list.length - 1, index + delta))]
  }
  useCommand("list.next", () => {
    const next = neighbor(1)
    if (next !== undefined) select(next)
  })
  useCommand("list.previous", () => {
    const next = neighbor(-1)
    if (next !== undefined) select(next)
  })
  useCommand("files.extendNext", () => {
    const next = neighbor(1)
    if (next !== undefined) select(next, "range")
  })
  useCommand("files.extendPrevious", () => {
    const next = neighbor(-1)
    if (next !== undefined) select(next, "range")
  })

  const targets = (): Array<Row> => {
    const chosen = [...marked()].map(rowOf).filter((row): row is Row => row !== undefined)
    if (chosen.length > 0) return chosen
    const current = rowOf(selected() ?? "")
    return current === undefined ? [] : [current]
  }
  const inFileList = () => document.activeElement?.closest('[aria-label="Changed files"]') != null
  useCommand(
    "files.selectAll",
    () => {
      setMarked(new Set(order()))
      anchor = order()[0] ?? null
    },
    inFileList,
  )
  useCommand(
    "files.stage",
    () => {
      const chosen = targets().filter((row) => !row.conflicted)
      const allStaged = chosen.every((row) => row.staged === "full")
      void updateIndex({
        add: allStaged ? [] : chosen.filter((row) => row.staged !== "full").map((row) => row.path),
        remove: allStaged ? chosen.map((row) => row.path) : [],
      })
    },
    () => targets().length > 0 && !inFileList(),
  )

  const stagedCount = () => rows().filter((row) => row.staged !== "none").length

  const discardedAlert = () => (
    <Show when={discarded()}>
      {(backup) => (
        <Alert tone="info" onDismiss={() => setDiscarded(null)} class="pe-7">
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-foreground">Discarded {discardSubject(backup().paths)}</span>
            <Button variant="ghost" class="-my-1 h-5 px-1.5" onClick={() => void undo(backup())}>
              Undo
            </Button>
          </div>
        </Alert>
      )}
    </Show>
  )

  const confirmTitle = () => {
    const paths = confirming() ?? []
    return `Discard changes to ${discardSubject(paths)}?`
  }

  return (
    <>
      <Show
        when={rows().length > 0}
        fallback={
          <div class="flex h-full min-h-0 flex-col">
            <OperationBanner />
            <Empty title="No changes">
              <div class="flex flex-col items-center gap-2">
                Edits to files in this working tree show up here.
                <div class="w-64 text-start empty:hidden">{discardedAlert()}</div>
                <Button variant="ghost" onClick={() => setRecovery({ kind: "List" })}>
                  Recover discarded changes…
                </Button>
              </div>
            </Empty>
          </div>
        }
      >
        <Split
          id="changes"
          listLabel="changed files"
          collapsed={props.focused}
          list={
            <>
              <OperationBanner />
              <Bar class="ps-3">
                <span class="min-w-0 truncate font-medium">{rows().length} changed</span>
                <span class="min-w-0 truncate text-muted-foreground tabular-nums">{stagedCount()} staged</span>
                <div class="flex-1" />
                <Show
                  when={allStaged()}
                  fallback={
                    <Tip label="Stage every file" keys={shortcut("files.stageAll")}>
                      {(trigger) => (
                        <Button {...trigger} variant="ghost" onClick={() => void stage(allPaths())}>
                          Stage all
                        </Button>
                      )}
                    </Tip>
                  }
                >
                  <Tip label="Unstage every file" keys={shortcut("files.unstageAll")}>
                    {(trigger) => (
                      <Button {...trigger} variant="ghost" onClick={() => void stage([])}>
                        Unstage all
                      </Button>
                    )}
                  </Tip>
                </Show>
                <Menu>
                  <MenuTrigger
                    aria-label="More actions"
                    class="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-open:bg-muted data-open:text-foreground"
                  >
                    <More />
                  </MenuTrigger>
                  <MenuContent align="end" class="min-w-56">
                    <MenuItem disabled={stagedCount() === 0} onSelect={() => void stage([])}>
                      Unstage all
                      <MenuShortcut>{shortcut("files.unstageAll")}</MenuShortcut>
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem onSelect={() => setRecovery({ kind: "List" })}>Recover discarded changes…</MenuItem>
                  </MenuContent>
                </Menu>
              </Bar>
              <Failures failure={failure()} onDismiss={() => setFailure(null)} />
              <SearchBar
                label="Filter files"
                placeholder="Filter files"
                value={filter()}
                onInput={setFilter}
                ref={(element) => (filterInput = element)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && filter() !== "") {
                    event.preventDefault()
                    setFilter("")
                  }
                }}
              />
              <Show when={discarded()}>
                <div class="shrink-0 border-b p-2">{discardedAlert()}</div>
              </Show>
              <div class="min-h-0 flex-1 overflow-y-auto">
                <FileTree
                  label="Changed files"
                  files={files()}
                  selected={selected()}
                  onSelect={select}
                  marked={marked()}
                  checked={checked()}
                  onCheckedChange={(next) => void stage(next)}
                  menu={fileMenu}
                />
              </div>
              <Boundary label="Loading draft">
                <CommitBox stagedCount={stagedCount()} draft={draft()} />
              </Boundary>
            </>
          }
        >
          <Show
            when={rows().find((row) => row.path === selected() && row.conflicted)?.path}
            fallback={
              <>
                <Bar class="ps-3">
                  <span class="min-w-0 flex-1 truncate text-muted-foreground">
                    {selected() ?? (rows().length === 1 ? "1 file" : `${rows().length} files`)}
                  </span>
                  <DiffControls handle={diff()} tests={testCount()} whitespace="staging" />
                </Bar>
                <Boundary label="Loading diffs" title="Couldn't load the diffs">
                  <Diffs rows={diffRows()} file={selected()} onTopFile={setSelected} ref={setDiff} />
                </Boundary>
              </>
            }
          >
            {(path) => <ConflictResolver path={path()} onClose={() => setSelected(null)} />}
          </Show>
        </Split>
      </Show>
      <Confirm
        open={confirming() !== null}
        onOpenChange={(open) => !open && !discarding() && setConfirming(null)}
        title={confirmTitle()}
        description="Unstaged changes are lost and untracked files are deleted; staged changes stay. You can undo this, or recover the files later."
        error={discardError()}
        confirmLabel="Discard"
        pending={discarding()}
        onConfirm={() => void discard()}
      />
      <RecoveryDialog view={recovery()} onViewChange={setRecovery} />
    </>
  )
}
