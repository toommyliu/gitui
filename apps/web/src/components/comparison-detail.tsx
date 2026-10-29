import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { Comparison, ComparisonDetail as Detail, RepoId, RepoPath } from "@gitui/contracts"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useId, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "cn"
import { comparisonAtom, comparisonKey, comparisonLabel, comparisonModes, useCompare } from "@/lib/comparison"
import type { FileTarget } from "@/lib/file-investigation"
import { isTestFile } from "@/lib/file-kind"
import { shortOid } from "@/lib/format"
import { describeFailure, diffAtom, diffKey, latest, loadError } from "@/lib/git"
import type { Selection } from "@/lib/selection"
import { settingsAtom } from "@/lib/settings"
import { ChangeLetter } from "./change-letter"
import { ChangeTotals, HistoryButton, SectionBar, TestsToggle } from "./commit-detail"
import { DiffStack, patchItems, useCollapse } from "./diff-view"
import { LargeDiff, Loading, Nothing } from "./loading"

export function ComparisonDetail({
  repo,
  comparison,
  onSelect,
  onInvestigate,
}: {
  repo: RepoId
  comparison: Comparison
  onSelect: (selection: Selection) => void
  onInvestigate: (file: FileTarget) => void
}) {
  const atom = comparisonAtom(comparisonKey(repo, comparison))
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const detail = result._tag === "Failure" && !result.waiting ? undefined : latest(result)
  const openCompare = useCompare(repo)
  const error = result._tag === "Failure" && !result.waiting ? describeFailure(result.cause) : undefined
  const mode = comparisonModes[comparison.mode]
  return (
    <div className="flex h-full flex-col">
      <div className="grid shrink-0 gap-2 border-b p-3">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 font-medium break-all">
            {comparisonLabel(comparison.base)} → {comparisonLabel(comparison.head)}
          </h2>
          <Button size="xs" variant="outline" onClick={() => openCompare(comparison)}>
            Edit…
          </Button>
          <Button size="xs" variant="ghost" onClick={() => onSelect({ _tag: "WorkingCopy" })}>
            Close
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Comparison mode">
          {Object.values(comparisonModes).map((option) => (
            <Button
              key={option.value}
              size="xs"
              variant={comparison.mode === option.value ? "secondary" : "ghost"}
              aria-pressed={comparison.mode === option.value}
              onClick={() => onSelect({ _tag: "Comparison", comparison: { ...comparison, mode: option.value } })}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground">{mode.description}</p>
        {detail !== undefined && (
          <p className="font-mono text-[11px] text-muted-foreground" title={`${detail.start} → ${detail.head}`}>
            {shortOid(detail.start)} → {shortOid(detail.head)}
          </p>
        )}
      </div>
      {detail === undefined ? (
        error === undefined ? (
          <Loading label="Comparing changes" />
        ) : (
          <Nothing
            title="Couldn't compare these revisions"
            description={`${error}\nCheck both refs. Histories without a common ancestor can use Between endpoints.`}
            onRetry={refresh}
          />
        )
      ) : (
        <ComparisonFiles
          key={`${detail.start}:${detail.head}`}
          repo={repo}
          detail={detail}
          onInvestigate={onInvestigate}
        />
      )}
    </div>
  )
}

function ComparisonFiles({
  repo,
  detail,
  onInvestigate,
}: {
  repo: RepoId
  detail: Detail
  onInvestigate: (file: FileTarget) => void
}) {
  const [selected, setSelected] = useState<RepoPath | null>(null)
  const [allowLarge, setAllowLarge] = useState(false)
  const { ignoreWhitespace, hideTests } = useAtomValue(settingsAtom)
  const files = hideTests ? detail.files.filter((file) => !isTestFile(file.path)) : detail.files
  const file = selected === null ? undefined : files.find((item) => item.path === selected)
  const paths = file === undefined ? [] : file.from === null ? [file.path] : [file.from, file.path]
  const target = { _tag: "Comparison", base: detail.start, head: detail.head } as const
  const atom = diffAtom(diffKey(repo, target, paths, ignoreWhitespace, allowLarge))
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const diff = latest(result)
  const error = loadError(result)
  const items = useMemo(() => {
    const all = diff?._tag === "Patch" ? patchItems("comparison", diff.patch) : []
    return hideTests ? all.filter((item) => !isTestFile(item.fileDiff.name)) : all
  }, [diff, hideTests])
  const collapse = useCollapse()
  const listId = useId()
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: files.length + 1,
    getScrollElement: () => listElement,
    estimateSize: () => 24,
    overscan: 10,
  })
  const rows = virtualizer.getVirtualItems()
  const selectedIndex = file === undefined ? 0 : files.indexOf(file) + 1
  const selectFile = (index: number) => {
    setSelected(files[index - 1]?.path ?? null)
    setAllowLarge(false)
    virtualizer.scrollToIndex(index, { align: "auto" })
  }
  return (
    <>
      <SectionBar label="Files" actions={<TestsToggle paths={detail.files.map((item) => item.path)} />}>
        <ChangeTotals count={detail.files.length} files={detail.files} />
      </SectionBar>
      {detail.files.length === 0 ? (
        <Nothing title="No changes between these revisions" />
      ) : (
        <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="30%" minSize="10%">
            <ScrollArea
              className="h-full"
              viewportRef={setListElement}
              viewportProps={{
                tabIndex: 0,
                role: "listbox",
                "aria-label": "Changed files",
                "aria-activedescendant": rows.some((row) => row.index === selectedIndex)
                  ? `${listId}-${selectedIndex}`
                  : undefined,
                className:
                  "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                onKeyDown: (event) => {
                  const next =
                    event.key === "ArrowDown"
                      ? Math.min(files.length, selectedIndex + 1)
                      : event.key === "ArrowUp"
                        ? Math.max(0, selectedIndex - 1)
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? files.length
                            : event.key === "Enter" || event.key === " "
                              ? selectedIndex
                              : undefined
                  if (next === undefined) return
                  event.preventDefault()
                  selectFile(next)
                },
              }}
            >
              <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {rows.map((row) => {
                  const item = files[row.index - 1]
                  return (
                    <div
                      key={row.key}
                      id={`${listId}-${row.index}`}
                      role="option"
                      aria-selected={selectedIndex === row.index}
                      aria-posinset={row.index + 1}
                      aria-setsize={files.length + 1}
                      title={
                        item === undefined
                          ? "All files"
                          : item.from === null
                            ? item.path
                            : `${item.from} → ${item.path}`
                      }
                      className={cn(
                        "absolute inset-x-0 top-0 flex h-6 items-center gap-2 px-3 text-start hover:bg-muted/60",
                        selectedIndex === row.index && "bg-selection",
                      )}
                      style={{ transform: `translateY(${row.start}px)` }}
                      onClick={() => {
                        listElement?.focus({ preventScroll: true })
                        selectFile(row.index)
                      }}
                    >
                      {item === undefined ? (
                        "All files"
                      ) : (
                        <>
                          <ChangeLetter change={item.change} />
                          <span className="min-w-0 flex-1 truncate">{item.path}</span>
                          {item.additions !== null && (
                            <span className="shrink-0 text-change-added tabular-nums">+{item.additions}</span>
                          )}
                          {item.deletions !== null && (
                            <span className="shrink-0 text-change-deleted tabular-nums">−{item.deletions}</span>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize="20%">
            {diff === undefined ? (
              error === undefined ? (
                <Loading label="Loading diff" />
              ) : (
                <Nothing title="Couldn't load the diff" description={error} onRetry={refresh} />
              )
            ) : diff._tag === "TooLarge" ? (
              <LargeDiff
                bytes={diff.bytes}
                onShow={() => setAllowLarge(true)}
                hint="You can also select a file to view its diff."
              />
            ) : items.length === 0 ? (
              <Nothing title={files.length === 0 ? "Only tests changed" : "Nothing to diff"} />
            ) : (
              <DiffStack
                repo={repo}
                items={items}
                collapse={collapse}
                actions={(meta) => (
                  <HistoryButton onClick={() => onInvestigate({ revision: detail.head, path: meta.path })} />
                )}
              />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </>
  )
}
