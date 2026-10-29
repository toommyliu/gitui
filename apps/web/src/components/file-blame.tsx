import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { FileBlame as Blame, FileIdentity, Oid, RepoId, RepoPath } from "@gitui/contracts"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "cn"
import { useMemo, useRef } from "react"
import { useHistoryDate } from "@/lib/dates"
import { fileBlameAtom, fileKey } from "@/lib/file-investigation"
import { longDate, shortOid } from "@/lib/format"
import { latest, loadError } from "@/lib/git"
import { useNarrow } from "@/lib/narrow"
import { Loading, Nothing } from "./loading"

type BlameLine = Extract<Blame, { _tag: "Lines" }>["lines"][number]

const ROW = 20
const TAB_SIZE = 4

export function FileBlame({
  repo,
  source,
  onOpenCommit,
}: {
  repo: RepoId
  source: FileIdentity
  onOpenCommit: (oid: Oid) => void
}) {
  const atom = fileBlameAtom(fileKey(repo, source.revision, source.path))
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const blame = latest(result)
  if (blame === undefined) {
    const error = loadError(result)
    return error === undefined ? (
      <Loading label="Loading blame" />
    ) : (
      <Nothing title="Couldn't load blame" description={error} onRetry={refresh} />
    )
  }
  if (blame._tag === "Unavailable") return <Nothing title="Blame isn't available" description={blame.reason} />
  if (blame.lines.length === 0) return <Nothing title="Empty file" description="There are no lines to blame." />
  return <BlameLines lines={blame.lines} path={source.path} onOpenCommit={onOpenCommit} />
}

function BlameLines({
  lines,
  path,
  onOpenCommit,
}: {
  lines: ReadonlyArray<BlameLine>
  path: RepoPath
  onOpenCommit: (oid: Oid) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const narrow = useNarrow()
  const date = useHistoryDate()
  const starts = useMemo(() => lines.map((line, index) => lines[index - 1]?.oid !== line.oid), [lines])
  const columns = useMemo(
    () =>
      lines.reduce((widest, line) => Math.max(widest, line.content.replaceAll("\t", " ".repeat(TAB_SIZE)).length), 0),
    [lines],
  )
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 30,
  })
  const gutter = narrow ? "7rem" : "18rem"
  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      role="region"
      aria-label={`Blame for ${path}`}
      className="h-full overflow-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <div
        className="relative min-w-full font-mono text-[12px] leading-5"
        style={{
          height: virtualizer.getTotalSize(),
          width: `calc(${gutter} + 4rem + ${columns}ch)`,
          tabSize: TAB_SIZE,
        }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index]!
          const start = starts[item.index] === true
          const second = !start && starts[item.index - 1] === true
          return (
            <div
              key={item.key}
              className={cn(
                "absolute top-0 left-0 flex w-full",
                start && item.index > 0 && "*:shadow-[inset_0_1px_0_var(--color-border)]",
              )}
              style={{ height: ROW, transform: `translateY(${item.start}px)` }}
            >
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-background px-2 font-sans text-[11px] text-muted-foreground"
                style={{ width: gutter }}
              >
                {start ? (
                  <>
                    <button
                      type="button"
                      className="shrink-0 rounded-sm font-mono text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      title={[
                        line.oid,
                        line.subject,
                        `${line.author}, ${longDate(line.time)}`,
                        `Line ${line.originalLine} of ${line.path}`,
                      ].join("\n")}
                      aria-label={`Show commit ${shortOid(line.oid)}: ${line.subject}`}
                      onClick={() => onOpenCommit(line.oid)}
                    >
                      {shortOid(line.oid)}
                    </button>
                    {!narrow && <span className="min-w-0 flex-1 truncate">{line.author}</span>}
                    <span className="ml-auto shrink-0 tabular-nums">{date(line.time)}</span>
                  </>
                ) : (
                  second && !narrow && <span className="truncate">{line.subject}</span>
                )}
              </div>
              <span
                className="sticky z-10 w-12 shrink-0 bg-background pr-3 text-right text-muted-foreground tabular-nums select-none"
                style={{ left: gutter }}
              >
                {line.line}
              </span>
              <span className="pr-4 whitespace-pre">{line.content}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
