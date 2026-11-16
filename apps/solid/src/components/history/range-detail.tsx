import type { CommitRow, ComparisonDetail, FileDiff } from "@gitui/contracts"
import { createMemo, For, Show } from "solid-js"
import { shortOid } from "@/lib/format"
import { FilesPane } from "../files-pane"
import { CopySlot } from "./commit-detail"
import { Check } from "../icons"
import { Button, createCopy } from "../ui"

const LISTED = 50

export function RangeDetail(props: {
  count: number
  commits: ReadonlyArray<CommitRow>
  detail: ComparisonDetail
  diff: FileDiff
  onShowLarge: () => void
}) {
  const totals = createMemo(() =>
    props.detail.files.reduce(
      (sum, file) => ({ added: sum.added + (file.additions ?? 0), deleted: sum.deleted + (file.deletions ?? 0) }),
      { added: 0, deleted: 0 },
    ),
  )
  const { copied: copiedText, copy } = createCopy()
  const hashes = () => props.commits.map((commit) => commit.oid).join("\n")
  const copied = () => copiedText() === hashes()
  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex max-h-[45%] shrink-0 flex-col gap-1.5 border-b px-3 py-2.5">
        <div class="flex min-w-0 items-center gap-2">
          <h2 class="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm leading-5 font-semibold">
            {props.count} commits
            <span class="font-normal text-muted-foreground">·</span>
            <Show when={totals().added > 0 || totals().deleted === 0}>
              <span class="font-mono text-xs font-medium text-change-added tabular-nums">+{totals().added}</span>
            </Show>
            <Show when={totals().deleted > 0}>
              <span class="font-mono text-xs font-medium text-change-deleted tabular-nums">−{totals().deleted}</span>
            </Show>
          </h2>
          <span data-copy-range class="contents">
            <Button
              variant="ghost"
              class={
                copied()
                  ? "h-5 px-1.5 text-2xs font-normal text-change-added hover:text-change-added"
                  : "h-5 px-1.5 text-2xs font-normal"
              }
              onClick={() => void copy(hashes())}
            >
              <Show when={copied()} fallback={`Copy ${props.commits.length} hashes`}>
                Copied
                <Check class="size-3" />
              </Show>
            </Button>
          </span>
          <span class="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
            <CopySlot oid={props.detail.base} />
            <span aria-hidden="true">→</span>
            <CopySlot oid={props.detail.head} />
          </span>
        </div>
        <ol aria-label="Commits in the range" class="flex min-h-0 flex-col overflow-y-auto overscroll-none">
          <For each={props.commits.slice(0, LISTED)}>
            {(commit) => (
              <li class="flex h-5 min-w-0 shrink-0 items-center gap-2 text-xs">
                <span class="shrink-0 font-mono text-2xs text-muted-foreground">{shortOid(commit.oid)}</span>
                <span class="min-w-0 truncate">{commit.subject}</span>
              </li>
            )}
          </For>
          <Show when={props.commits.length > LISTED}>
            <li class="h-5 shrink-0 text-2xs text-muted-foreground">and {props.commits.length - LISTED} more</li>
          </Show>
        </ol>
      </div>
      <FilesPane
        section="range"
        files={props.detail.files}
        diff={props.diff}
        empty="These commits change no files together"
        onShowLarge={props.onShowLarge}
      />
    </div>
  )
}
