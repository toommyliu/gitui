import type { FileChange, FileDiff } from "@gitui/contracts"
import type { JSX } from "@solidjs/web"
import { createMemo, createSignal, Errored, Loading, Match, Show, Switch } from "solid-js"
import { type DiffHandle, DiffControls, DiffStack, itemId, patchItems } from "./diff"
import { type FileEntry, FileTree, fileOrder, letterOf } from "./file-tree"
import { Failure, Spinner } from "./state"
import { Toggle } from "@ui-sdk/solid/toggle"
import { shortcut } from "@/lib/hotkeys"
import { isTestFile } from "@/lib/file-kind"
import { filesOpen, hideTests, toggleFilesOpen } from "@/lib/settings"
import { PanelLeft } from "./icons"
import { Bar, Button, Empty, type Failure as Problem, Failures, Tip } from "./ui"
import { OpenInItems } from "./open-in"
import { MenuItem } from "@ui-sdk/solid/menu"
import { useRepo } from "@/lib/repo"
import { describeError } from "@/lib/rpc"

export function PaneBoundary(props: { children: JSX.Element; on: unknown; title: string }) {
  return (
    <Errored fallback={(error, reset) => <Failure error={error()} title={props.title} onRetry={reset} />}>
      <Loading
        on={props.on}
        fallback={
          <>
            <Bar>{""}</Bar>
            <div class="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          </>
        }
      >
        {props.children}
      </Loading>
    </Errored>
  )
}

export function FilesPane(props: {
  section: string
  files: ReadonlyArray<FileChange>
  diff: FileDiff
  empty: string
  onShowLarge: () => void
}) {
  const [file, setFile] = createSignal<string | null>(null)
  const [handle, setHandle] = createSignal<DiffHandle>()
  const repo = useRepo()
  const [failure, setFailure] = createSignal<Problem | null>(null)
  const tests = createMemo(() => props.files.filter((change) => isTestFile(change.path)).length)
  const files = createMemo(() => (hideTests() ? props.files.filter((change) => !isTestFile(change.path)) : props.files))
  const entries = createMemo((): Array<FileEntry> =>
    files().map((change) => ({
      path: change.path,
      letter: letterOf(change.change),
      additions: change.additions,
      deletions: change.deletions,
    })),
  )
  const totals = createMemo(() =>
    files().reduce(
      (sum, change) => ({ added: sum.added + (change.additions ?? 0), deleted: sum.deleted + (change.deletions ?? 0) }),
      { added: 0, deleted: 0 },
    ),
  )
  const items = createMemo(() => {
    const all = props.diff._tag === "Patch" ? patchItems(props.section, props.diff.patch) : []
    const shown = hideTests() ? all.filter((item) => !isTestFile(item.path)) : all
    const rank = new Map(fileOrder(shown.map((item) => item.path)).map((path, index) => [path, index]))
    return shown.toSorted((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0))
  })
  const tooLarge = () => (props.diff._tag === "TooLarge" ? props.diff.bytes : 0)

  return (
    <>
      <Bar>
        <Tip label={filesOpen() ? "Hide the file list" : "Show the file list"} keys={shortcut("view.files")}>
          {(trigger) => (
            <Toggle
              {...trigger}
              pressed={filesOpen()}
              onPressedChange={toggleFilesOpen}
              aria-label="File list"
              class="-ms-0.5 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-pressed:text-foreground"
            >
              <PanelLeft />
            </Toggle>
          )}
        </Tip>
        <Show when={props.files.length > 0}>
          <span class="font-medium tabular-nums">
            {files().length} {files().length === 1 ? "file" : "files"}
          </span>
          <span class="flex gap-1 font-mono">
            <Show when={totals().added > 0 || totals().deleted === 0}>
              <span class="text-change-added tabular-nums">+{totals().added}</span>
            </Show>
            <Show when={totals().deleted > 0}>
              <span class="text-change-deleted tabular-nums">−{totals().deleted}</span>
            </Show>
          </span>
        </Show>
        <div class="flex-1" />
        <DiffControls handle={handle()} tests={tests()} whitespace="available" />
      </Bar>
      <Failures failure={failure()} onDismiss={() => setFailure(null)} />
      <Show
        when={files().length > 0}
        fallback={<Empty title={hideTests() && props.files.length > 0 ? "Only test files changed" : props.empty} />}
      >
        <div class="flex min-h-0 flex-1">
          <div class={["w-64 shrink-0 overflow-y-auto border-e", { hidden: !filesOpen() }]}>
            <FileTree
              label="Changed files"
              files={entries()}
              selected={file()}
              onSelect={(path) => {
                setFile(path)
                handle()?.scrollToItem(itemId(props.section, path))
              }}
              menu={(path) => (
                <>
                  <MenuItem
                    onSelect={() =>
                      void navigator.clipboard.writeText(path).then(
                        () => setFailure(null),
                        (error: unknown) =>
                          setFailure({ title: "Couldn't copy the path", message: describeError(error) }),
                      )
                    }
                  >
                    Copy path
                  </MenuItem>
                  <OpenInItems
                    repo={repo.id}
                    path={path}
                    disabled={props.files.find((change) => change.path === path)?.change === "deleted"}
                    onFailure={setFailure}
                  />
                </>
              )}
            />
          </div>
          <div class="flex min-w-0 flex-1 flex-col">
            <Switch>
              <Match when={tooLarge() > 0}>
                <Empty title={`This diff is ${(tooLarge() / 1024 / 1024).toFixed(1)} MB`}>
                  <p>Large diffs can slow the app down.</p>
                  <Button class="mt-2" onClick={props.onShowLarge}>
                    Show it anyway
                  </Button>
                </Empty>
              </Match>
              <Match when={items().length === 0}>
                <Empty title="No text changes to show" />
              </Match>
              <Match when={items().length > 0}>
                <DiffStack
                  items={items()}
                  onTopItemChange={(id) => setFile(items().find((item) => item.id === id)?.path ?? null)}
                  ref={setHandle}
                />
              </Match>
            </Switch>
          </div>
        </div>
      </Show>
    </>
  )
}
