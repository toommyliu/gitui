import { LIST_ROW } from "@/lib/rows"
import { Hint } from "@/components/ui/tooltip"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type {
  Branch,
  Head,
  Oid,
  Refs,
  RefVisibility,
  RemoteBranch,
  RepoId,
  Stash,
  Status,
  Tag,
  Worktree,
} from "@gitui/contracts"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { OpenInContextMenu } from "./open-in"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"
import * as Exit from "effect/Exit"
import { ChevronRightIcon, EyeIcon, EyeOffIcon, GitBranchIcon } from "lucide-react"
import { type ComponentProps, type ReactNode, useMemo, useRef, useState } from "react"
import { useCompare } from "@/lib/comparison"
import { useHistoryDate } from "@/lib/dates"
import { basename, shortOid } from "@/lib/format"
import {
  describeFailure,
  latest,
  refsAtom,
  statusAtom,
  useCheckout,
  useGitAction,
  useNetwork,
  networkStateAtom,
  useRunGitAction,
} from "@/lib/git"
import type { Selection } from "@/lib/selection"
import { stashBlocked } from "@/lib/stash"
import { type Location, type LocationState, focusLocation, locationState, toggleLocation } from "@/lib/visibility"
import { cleanupOpenAtom } from "@/lib/worktree-cleanup"
import { useRefreshOnFocus, worktreeLabel, worktreeSummariesAtom, worktreesKey } from "@/lib/worktrees"
import { useConfirm } from "./confirm"
import { SyncButtons } from "./network"
import { usePublishing } from "./publishing"
import { usePrompt } from "./prompt"
import { CleanupWorktreesDialog } from "./cleanup-worktrees-dialog"
import { RemoveWorktreeDialog } from "./remove-worktree-dialog"
import { useStashPrompt } from "./stash-prompt"

type Section = "branches" | "remotes" | "tags" | "stashes" | "worktrees"

type Row =
  | { readonly kind: "section"; readonly id: Section; readonly label: string; readonly count: number }
  | { readonly kind: "folder"; readonly id: string; readonly label: string; readonly depth: number }
  | { readonly kind: "branch"; readonly depth: number; readonly label: string; readonly branch: Branch }
  | { readonly kind: "remote"; readonly depth: number; readonly label: string; readonly ref: RemoteBranch }
  | { readonly kind: "tag"; readonly depth: number; readonly label: string; readonly tag: Tag }
  | { readonly kind: "stash"; readonly index: number; readonly stash: Stash }
  | { readonly kind: "worktree"; readonly worktree: Worktree }

const ROW = LIST_ROW

interface Tree<T> {
  readonly folders: Map<string, Tree<T>>
  readonly leaves: Array<{ label: string; value: T }>
}

const buildTree = <T,>(items: ReadonlyArray<T>, name: (item: T) => string): Tree<T> => {
  const root: Tree<T> = { folders: new Map(), leaves: [] }
  for (const item of items) {
    const parts = name(item).split("/")
    let node = root
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part)
      if (next === undefined) {
        next = { folders: new Map(), leaves: [] }
        node.folders.set(part, next)
      }
      node = next
    }
    node.leaves.push({ label: parts.at(-1)!, value: item })
  }
  return root
}

const flattenTree = <T,>(
  tree: Tree<T>,
  prefix: string,
  depth: number,
  collapsed: ReadonlySet<string>,
  leaf: (label: string, value: T, depth: number) => Row,
  out: Array<Row>,
) => {
  for (const [label, child] of [...tree.folders].sort(([a], [b]) => a.localeCompare(b))) {
    const id = `${prefix}/${label}`
    out.push({ kind: "folder", id, label, depth })
    if (!collapsed.has(id)) flattenTree(child, id, depth + 1, collapsed, leaf, out)
  }
  for (const { label, value } of tree.leaves) out.push(leaf(label, value, depth))
}

const rowVisibility = (
  row: Row,
  visibility: RefVisibility,
  head: Head | undefined,
): { state: LocationState; location: Location | null } => {
  const at = (location: Location) => ({ state: locationState(visibility, location), location })
  const within = (shown: boolean) => ({ state: shown ? ("shown" as const) : ("inherited" as const), location: null })
  switch (row.kind) {
    case "section":
      return row.id === "worktrees" ? within(true) : at({ section: row.id })
    case "folder": {
      const [section = "", ...name] = row.id.split("/")
      if (section === "tags") return within(visibility.tags)
      return at({ section: section === "remotes" ? "remotes" : "branches", name: name.join("/") })
    }
    case "branch":
      return head?._tag === "Branch" && head.name === row.branch.name
        ? within(true)
        : at({ section: "branches", name: row.branch.name })
    case "remote":
      return at({ section: "remotes", name: row.ref.name })
    case "tag":
      return within(visibility.tags)
    case "stash":
      return within(visibility.stashes)
    case "worktree":
      return within(true)
  }
}

export function Sidebar({
  repo,
  selection,
  onSelect,
  onOpen,
  visibility,
  onVisibilityChange,
}: {
  repo: RepoId
  selection: Selection
  onSelect: (selection: Selection) => void
  onOpen: (path: string, family: ReadonlyArray<string>) => void
  visibility: RefVisibility
  onVisibilityChange: (visibility: RefVisibility) => void
}) {
  useRefreshOnFocus([worktreesKey(repo)])
  const refs = latest(useAtomValue(refsAtom(repo)))
  const status = latest(useAtomValue(statusAtom(repo)))
  const head = status?.head
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(["remotes", "tags"]))
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const rows = useMemo(() => {
    const out: Array<Row> = []
    if (refs === undefined) return out
    const section = (id: Section, label: string, count: number, body: () => void) => {
      out.push({ kind: "section", id, label, count })
      if (!collapsed.has(id)) body()
    }
    section("branches", "Branches", refs.branches.length, () =>
      flattenTree(
        buildTree(refs.branches, (b) => b.name),
        "branches",
        1,
        collapsed,
        (label, branch, depth) => ({ kind: "branch", label, branch, depth }),
        out,
      ),
    )
    section("remotes", "Remotes", refs.remoteBranches.length, () =>
      flattenTree(
        buildTree(refs.remoteBranches, (r) => r.name),
        "remotes",
        1,
        collapsed,
        (label, ref, depth) => ({ kind: "remote", label, ref, depth }),
        out,
      ),
    )
    section("tags", "Tags", refs.tags.length, () =>
      flattenTree(
        buildTree(refs.tags, (t) => t.name),
        "tags",
        1,
        collapsed,
        (label, tag, depth) => ({ kind: "tag", label, tag, depth }),
        out,
      ),
    )
    section("stashes", "Stashes", refs.stashes.length, () =>
      refs.stashes.forEach((stash, index) => out.push({ kind: "stash", stash, index })),
    )
    section("worktrees", "Worktrees", refs.worktrees.length, () =>
      refs.worktrees.forEach((worktree) => out.push({ kind: "worktree", worktree })),
    )
    return out
  }, [refs, collapsed])

  const worktreeByBranch = useMemo(
    () =>
      new Map(
        (refs?.worktrees ?? []).flatMap((w) => (w.head._tag === "Branch" && !w.isMain ? [[w.head.name, w]] : [])),
      ),
    [refs],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 20,
  })

  const [deleting, setDeleting] = useState<{ branch: Branch; worktree: Worktree | undefined } | null>(null)
  const [removing, setRemoving] = useState<{ worktree: Worktree; force: boolean } | null>(null)

  return (
    <div className="flex h-full flex-col">
      <CurrentBranch repo={repo} status={status} />
      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={scrollRef}
        viewportProps={{ className: "py-1 [contain:strict] data-has-overflow-y:pr-2.5" }}
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!
            const { state, location } = rowVisibility(row, visibility, head)
            const selected =
              row.kind === "worktree" && selection._tag === "Worktree" && selection.path === row.worktree.path
            return (
              <div
                key={item.key}
                className={cn(
                  "group/row absolute top-0 left-0 flex w-full has-[[data-row]:focus-visible]:outline-2 has-[[data-row]:focus-visible]:-outline-offset-2",
                  selected ? "bg-selection" : row.kind !== "section" && "hover:bg-muted/60",
                )}
                style={{ height: ROW, transform: `translateY(${item.start}px)` }}
              >
                <div className={cn("h-full min-w-0 flex-1", state !== "shown" && "opacity-50")}>
                  <SidebarRow
                    row={row}
                    repo={repo}
                    refs={refs}
                    head={head}
                    collapsed={collapsed}
                    toggle={toggle}
                    onSelect={onSelect}
                    onOpen={(path) => onOpen(path, refs?.worktrees.map((worktree) => worktree.path) ?? [])}
                    worktreeByBranch={worktreeByBranch}
                    onDelete={(branch) => setDeleting({ branch, worktree: worktreeByBranch.get(branch.name) })}
                    onRemove={(worktree, force) => setRemoving({ worktree, force })}
                  />
                </div>
                {location !== null && state !== "inherited" && (
                  <VisibilityToggle
                    hidden={state === "hidden"}
                    label={location.name ?? location.section}
                    onToggle={(focus) =>
                      onVisibilityChange(
                        focus && refs !== undefined
                          ? focusLocation(refs, location)
                          : toggleLocation(visibility, location),
                      )
                    }
                  />
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
      {deleting !== null && (
        <DeleteBranchDialog
          repo={repo}
          branch={deleting.branch}
          worktree={deleting.worktree}
          onClose={() => setDeleting(null)}
        />
      )}
      {removing !== null && <RemoveWorktreeDialog repo={repo} {...removing} onClose={() => setRemoving(null)} />}
      <CleanupWorktreesDialog repo={repo} />
    </div>
  )
}

function CurrentBranch({ repo, status }: { repo: RepoId; status: Status | undefined }) {
  if (status === undefined) {
    return (
      <div className="flex h-8 shrink-0 items-center border-b px-2">
        <Skeleton className="h-3 w-24" />
      </div>
    )
  }
  const { head, upstream, operation } = status
  const name = head._tag === "Detached" ? `HEAD at ${shortOid(head.oid)}` : head.name
  return (
    <div className="shrink-0">
      <div className="flex h-8 items-center gap-1.5 border-b pr-1 pl-2 whitespace-nowrap">
        <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <Tooltip>
          <TooltipTrigger render={<span className="min-w-0 truncate font-semibold" />}>{name}</TooltipTrigger>
          <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
            {name}
            <span className="opacity-70">
              {head._tag === "Unborn"
                ? "No commits yet"
                : upstream === null
                  ? "No upstream"
                  : `Tracking ${upstream.name}`}
            </span>
          </TooltipContent>
        </Tooltip>
        <span className="flex-1" />
        <SyncButtons repo={repo} branch={head._tag === "Branch" ? head.name : null} upstream={upstream} />
      </div>
      {operation !== null && (
        <div className="border-b p-2">
          <Badge variant="destructive" className="w-full">
            {operation} in progress
          </Badge>
        </div>
      )}
    </div>
  )
}

function SmallBadge({ className, ...props }: ComponentProps<typeof Badge>) {
  return <Badge variant="secondary" className={cn("h-4 rounded-sm px-1 text-2xs tabular-nums", className)} {...props} />
}

function WorktreeChips({ repo, worktree }: { repo: RepoId; worktree: Worktree }) {
  const summary = latest(useAtomValue(worktreeSummariesAtom(repo)))?.find((s) => s.path === worktree.path)
  if (summary === undefined) return null
  const commits = summary.commits ?? 0
  return (
    <>
      {commits > 0 && <SmallBadge>{commits === 1 ? "1 commit" : `${commits} commits`}</SmallBadge>}
      {summary.changes > 0 && <SmallBadge>{summary.changes === 1 ? "1 file" : `${summary.changes} files`}</SmallBadge>}
      {!worktree.isMain && summary.commits === 0 && summary.changes === 0 && (
        <SmallBadge variant="outline">empty</SmallBadge>
      )}
    </>
  )
}

function Line({
  depth,
  onClick,
  active,
  hint,
  children,
  ...props
}: {
  depth: number
  onClick?: () => void
  active?: boolean
  children: ReactNode
  hint?: string
} & Pick<ComponentProps<"button">, "onDoubleClick" | "onKeyDown">) {
  return (
    <Hint label={hint} side="right">
      <button
        type="button"
        data-row
        onClick={onClick}
        {...props}
        className={cn(
          "flex h-full w-full items-center gap-1.5 pr-2 text-left whitespace-nowrap focus-visible:outline-none",
          active && "font-semibold",
        )}
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        {children}
      </button>
    </Hint>
  )
}

function VisibilityToggle({
  hidden,
  label,
  onToggle,
}: {
  hidden: boolean
  label: string
  onToggle: (focus: boolean) => void
}) {
  const action = `${hidden ? "Show" : "Hide"} ${label} in history`
  const shortcut = "Alt-click or Alt+Enter to focus"
  return (
    <span
      className={cn(
        "shrink-0 items-center pr-2",
        hidden ? "flex" : "hidden group-focus-within/row:flex group-hover/row:flex",
      )}
    >
      <Hint label={`${action}\n${shortcut}`}>
        <button
          type="button"
          aria-label={action}
          aria-description={shortcut}
          onClick={(event) => onToggle(event.altKey)}
          onKeyDown={(event) => {
            if (event.altKey && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault()
              onToggle(true)
            }
          }}
          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-offset-0 hover:text-foreground"
        >
          {hidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
        </button>
      </Hint>
    </span>
  )
}

const Disclosure = ({ open }: { open: boolean }) => (
  <ChevronRightIcon className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
)

function SidebarRow({
  row,
  repo,
  refs,
  head,
  collapsed,
  toggle,
  onSelect,
  onOpen,
  worktreeByBranch,
  onDelete,
  onRemove,
}: {
  row: Row
  repo: RepoId
  refs: Refs | undefined
  head: Head | undefined
  collapsed: ReadonlySet<string>
  toggle: (id: string) => void
  onSelect: (selection: Selection) => void
  onOpen: (path: string) => void
  worktreeByBranch: Map<string, Worktree>
  onDelete: (branch: Branch) => void
  onRemove: (worktree: Worktree, force: boolean) => void
}) {
  const git = useGitAction()
  const compare = useCompare(repo)
  const checkout = useCheckout()
  const date = useHistoryDate()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const network = useNetwork(repo)
  const publishing = usePublishing(repo)
  const networkBusy = useAtomValue(networkStateAtom(repo))?._tag === "Running"
  const select = (oid: Oid) => onSelect({ _tag: "Commit", oid })
  const current = head?._tag === "Branch" ? head.name : "HEAD"
  const integrate = (ref: string, disabled: boolean) => (
    <>
      <ContextMenuItem disabled={disabled} onClick={() => void git("Merge", repo, (c) => c("Merge", { repo, ref }))}>
        Merge {ref} into {current}
      </ContextMenuItem>
      <ContextMenuItem
        disabled={disabled}
        onClick={() => void git("Rebase", repo, (c) => c("Rebase", { repo, onto: ref }))}
      >
        Rebase {current} onto {ref}
      </ContextMenuItem>
    </>
  )

  switch (row.kind) {
    case "section":
      return <SectionRow row={row} open={!collapsed.has(row.id)} toggle={toggle} repo={repo} refs={refs} />
    case "folder":
      return (
        <Line depth={row.depth} onClick={() => toggle(row.id)}>
          <Disclosure open={!collapsed.has(row.id)} />
          <span className="text-muted-foreground">{row.label}</span>
        </Line>
      )
    case "branch": {
      const { branch } = row
      const isHead = head?._tag === "Branch" && head.name === branch.name
      const worktree = worktreeByBranch.get(branch.name)
      const upstream = branch.upstream
      const remoteBranch =
        upstream?._tag === "Tracking"
          ? refs?.remoteBranches.find((remote) => `refs/remotes/${remote.name}` === upstream.ref)
          : undefined
      const forcePush = (name: string, expected: Oid) =>
        confirm({
          title: `Force push ${branch.name}?`,
          body: (
            <p>
              This replaces {name} with your local {branch.name}. The push fails if {name} no longer points at{" "}
              <span className="font-mono">{shortOid(expected)}</span>.
            </p>
          ),
          confirmLabel: "Force push",
          destructive: true,
          onConfirm: () =>
            remoteBranch !== undefined &&
            void network.run({
              action: "ForcePush",
              expected,
              destination: {
                branch: branch.name,
                remote: remoteBranch.remote,
                remoteBranch: remoteBranch.name.slice(remoteBranch.remote.length + 1),
              },
            }),
        })
      const open = () => {
        if (isHead) return
        if (worktree === undefined) void checkout(repo, branch.name)
        else if (worktree.prunable === null) onOpen(worktree.path)
      }
      return (
        <ContextMenu>
          <ContextMenuTrigger className="block h-full">
            <Line
              depth={row.depth}
              active={isHead}
              onClick={() => select(branch.oid)}
              onDoubleClick={open}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                open()
              }}
            >
              <span className="w-3 shrink-0" />
              <span className="truncate">{row.label}</span>
              {worktree !== undefined && (
                <span className="truncate text-2xs text-muted-foreground">in {basename(worktree.path)}</span>
              )}
              <span className="ml-auto flex shrink-0 gap-1 tabular-nums">
                {upstream?._tag === "Gone" && <SmallBadge variant="outline">gone</SmallBadge>}
                {upstream?._tag === "Tracking" && upstream.ahead > 0 && <SmallBadge>{upstream.ahead}↑</SmallBadge>}
                {upstream?._tag === "Tracking" && upstream.behind > 0 && <SmallBadge>{upstream.behind}↓</SmallBadge>}
              </span>
            </Line>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => compare({ head: `refs/heads/${branch.name}`, mode: "merge-base" })}>
              Compare with…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={isHead || worktree !== undefined}
              onClick={() => void checkout(repo, branch.name)}
            >
              Check out {branch.name}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={isHead || worktree !== undefined}
              onClick={() =>
                prompt({
                  title: `Check out ${branch.name} in a new worktree`,
                  fields: [
                    {
                      key: "path",
                      label: "Path",
                      optional: true,
                      placeholder: worktreePath(refs, repo, branch.name),
                    },
                  ],
                  submitLabel: "Add worktree",
                  onSubmit: ({ path }) =>
                    git("Add worktree", repo, (c) =>
                      c("AddWorktree", {
                        repo,
                        path: path || worktreePath(refs, repo, branch.name),
                        branch: branch.name,
                        startPoint: null,
                      }),
                    ),
                })
              }
            >
              Check out in new worktree…
            </ContextMenuItem>
            <ContextMenuSeparator />
            {!isHead && (
              <>
                {integrate(branch.name, head?._tag === "Unborn")}
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem
              onClick={() =>
                prompt({
                  title: `Rename ${branch.name}`,
                  fields: [{ key: "name", label: "New name", initial: branch.name }],
                  submitLabel: "Rename",
                  onSubmit: ({ name }) =>
                    git("Rename branch", repo, (c) => c("RenameBranch", { repo, from: branch.name, to: name })),
                })
              }
            >
              Rename…
            </ContextMenuItem>
            <ContextMenuItem disabled={networkBusy} onClick={() => void publishing.pushTo(branch)}>
              Push to…
            </ContextMenuItem>
            <ContextMenuItem onClick={() => publishing.changeUpstream(branch)}>Change upstream…</ContextMenuItem>
            {isHead && upstream?._tag === "Tracking" && (
              <ContextMenuItem
                variant="destructive"
                disabled={networkBusy || remoteBranch === undefined}
                onClick={() => remoteBranch !== undefined && forcePush(upstream.name, remoteBranch.oid)}
              >
                Force push to {upstream.name}…
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" disabled={isHead} onClick={() => onDelete(branch)}>
              {worktree === undefined ? "Delete branch…" : "Delete branch and worktree…"}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    }
    case "remote": {
      const local = row.ref.name.slice(row.ref.remote.length + 1)
      const configured = refs?.remotes.some((remote) => remote.name === row.ref.remote) ?? false
      return (
        <ContextMenu>
          <ContextMenuTrigger className="block h-full">
            <Line
              depth={row.depth}
              onClick={() => select(row.ref.oid)}
              onDoubleClick={() => void checkout(repo, local)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                void checkout(repo, local)
              }}
            >
              <span className="w-3 shrink-0" />
              <span className="truncate">{row.label}</span>
            </Line>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => compare({ head: `refs/remotes/${row.ref.name}`, mode: "merge-base" })}>
              Compare with…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => void checkout(repo, local)}>Check out as {local}</ContextMenuItem>
            <ContextMenuSeparator />
            {integrate(row.ref.name, head?._tag === "Unborn")}
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={!configured || networkBusy}
              onClick={() =>
                confirm({
                  title: `Delete ${local} on ${row.ref.remote}?`,
                  body: (
                    <p>
                      This deletes the branch on the remote server for everyone using it. Your local branches stay in
                      place. Deletion stops if the remote branch has changed since your last fetch.
                    </p>
                  ),
                  confirmLabel: "Delete on remote",
                  destructive: true,
                  onConfirm: () =>
                    void network.run({
                      action: "DeleteRemoteBranch",
                      remote: row.ref.remote,
                      branch: local,
                      expected: row.ref.oid,
                    }),
                })
              }
            >
              Delete branch on {row.ref.remote}…
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              onClick={() =>
                confirm({
                  title: `Delete local reference ${row.ref.name}?`,
                  body: configured ? (
                    <p>
                      This deletes the local remote-tracking branch only. The branch on {row.ref.remote} stays, and the
                      next fetch brings it back.
                    </p>
                  ) : (
                    <p>No remote named {row.ref.remote} is configured, so fetching won't bring this branch back.</p>
                  ),
                  confirmLabel: "Delete",
                  destructive: true,
                  onConfirm: () =>
                    void git("Delete remote-tracking branch", repo, (c) =>
                      c("DeleteRemoteTrackingBranch", { repo, name: row.ref.name }),
                    ),
                })
              }
            >
              Delete local tracking reference…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    }
    case "tag": {
      const { tag } = row
      return (
        <ContextMenu>
          <ContextMenuTrigger className="block h-full">
            <Line depth={row.depth} onClick={() => select(tag.oid)}>
              <span className="w-3 shrink-0" />
              <span className="truncate">{row.label}</span>
            </Line>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => compare({ head: `refs/tags/${tag.name}`, base: "HEAD", mode: "direct" })}>
              Compare with…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={networkBusy} onClick={() => publishing.pushTags([tag.name])}>
              Push tag…
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => void git("Check out", repo, (c) => c("CheckoutDetached", { repo, oid: tag.oid }))}
            >
              Check out {tag.name} (detached)
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() =>
                confirm({
                  title: `Delete tag ${tag.name}?`,
                  body: <p>This deletes the local tag only. A copy pushed to a remote stays there.</p>,
                  confirmLabel: "Delete tag",
                  destructive: true,
                  onConfirm: () => void git("Delete tag", repo, (c) => c("DeleteTag", { repo, name: tag.name })),
                })
              }
            >
              Delete tag…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    }
    case "stash": {
      const { stash } = row
      return (
        <ContextMenu>
          <ContextMenuTrigger className="block h-full">
            <Line depth={1} onClick={() => select(stash.oid)}>
              <span className="w-3 shrink-0" />
              <span className="truncate">{stash.message}</span>
              <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{date(stash.time)}</span>
            </Line>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onClick={() => git("Apply stash", repo, (c) => c("StashApply", { repo, oid: stash.oid, drop: false }))}
            >
              Apply
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => git("Pop stash", repo, (c) => c("StashApply", { repo, oid: stash.oid, drop: true }))}
            >
              Pop
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() =>
                confirm({
                  title: "Drop stash?",
                  body: <p className="font-mono text-xs">{stash.message}</p>,
                  confirmLabel: "Drop",
                  destructive: true,
                  onConfirm: () => git("Drop stash", repo, (c) => c("StashDrop", { repo, oid: stash.oid })),
                })
              }
            >
              Drop…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    }
    case "worktree": {
      const { worktree } = row
      const current = worktree.path === repo
      const openable = !current && worktree.head._tag !== "Bare" && worktree.prunable === null
      return (
        <ContextMenu>
          <ContextMenuTrigger className="block h-full">
            <Line
              depth={1}
              active={current}
              hint={worktree.path}
              onClick={() => {
                if (current) onSelect({ _tag: "WorkingCopy" })
                else if (openable) onSelect({ _tag: "Worktree", path: worktree.path })
              }}
              onDoubleClick={() => openable && onOpen(worktree.path)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !openable) return
                event.preventDefault()
                onOpen(worktree.path)
              }}
            >
              <span className="w-3 shrink-0" />
              <span className="truncate">{worktreeLabel(worktree)}</span>
              {worktree.head._tag !== "Branch" && (
                <span className="truncate text-2xs text-muted-foreground">
                  {worktree.head._tag === "Detached" ? "detached" : "bare"}
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {worktree.locked !== null && <SmallBadge variant="outline">locked</SmallBadge>}
                {worktree.prunable !== null ? (
                  <SmallBadge variant="destructive">missing</SmallBadge>
                ) : current ? (
                  <span className="text-2xs text-muted-foreground">this tab</span>
                ) : (
                  openable && <WorktreeChips repo={repo} worktree={worktree} />
                )}
              </span>
            </Line>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={!openable} onClick={() => onOpen(worktree.path)}>
              Open in new tab
            </ContextMenuItem>
            <OpenInContextMenu repo={worktree.path} disabled={worktree.prunable !== null} />
            <ContextMenuSeparator />
            <ContextMenuItem disabled={worktree.isMain || current} onClick={() => onRemove(worktree, false)}>
              Remove worktree…
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              disabled={worktree.isMain || current}
              onClick={() => onRemove(worktree, true)}
            >
              Force remove worktree…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    }
  }
}

function SectionRow({
  row,
  open,
  toggle,
  repo,
  refs,
}: {
  row: Extract<Row, { kind: "section" }>
  open: boolean
  toggle: (id: string) => void
  repo: RepoId
  refs: Refs | undefined
}) {
  const git = useGitAction()
  const prompt = usePrompt()
  const stash = useStashPrompt(repo)
  const status = latest(useAtomValue(statusAtom(repo)))
  const publishing = usePublishing(repo)
  const networkBusy = useAtomValue(networkStateAtom(repo))?._tag === "Running"
  const openCleanup = useAtomSet(cleanupOpenAtom(repo))
  const header = (
    <button
      type="button"
      data-row
      onClick={() => toggle(row.id)}
      className="flex h-full w-full items-center gap-1.5 px-2 text-left section-label hover:text-foreground focus-visible:outline-none"
    >
      <Disclosure open={open} />
      {row.label}
      <SmallBadge>{row.count}</SmallBadge>
    </button>
  )
  if (row.id === "stashes") {
    return (
      <ContextMenu>
        <ContextMenuTrigger className="block h-full">{header}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={status === undefined || status.entries.length === 0 || stashBlocked(status)}
            onClick={() => status !== undefined && stash(status, { _tag: "All", keepIndex: false })}
          >
            Stash changes…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
  if (row.id === "remotes" || row.id === "tags")
    return (
      <ContextMenu>
        <ContextMenuTrigger className="block h-full">{header}</ContextMenuTrigger>
        <ContextMenuContent>
          {row.id === "remotes" ? (
            <ContextMenuItem onClick={publishing.manageRemotes}>Manage remotes…</ContextMenuItem>
          ) : (
            <ContextMenuItem disabled={networkBusy} onClick={() => publishing.pushTags()}>
              Push tags…
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  if (row.id !== "worktrees") return header
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full">{header}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() =>
            prompt({
              title: "Add worktree",
              description: "Creates the branch from HEAD if it doesn't exist yet.",
              fields: [
                { key: "branch", label: "Branch" },
                {
                  key: "path",
                  label: "Path",
                  optional: true,
                  placeholder: ({ branch }) => worktreePath(refs, repo, branch || "branch"),
                },
              ],
              submitLabel: "Add worktree",
              onSubmit: ({ branch, path }) =>
                git("Add worktree", repo, (c) =>
                  c("AddWorktree", {
                    repo,
                    path: path || worktreePath(refs, repo, branch),
                    branch,
                    startPoint: null,
                  }),
                ),
            })
          }
        >
          Add worktree…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => openCleanup(true)}>Clean up worktrees…</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function DeleteBranchDialog({
  repo,
  branch,
  worktree,
  onClose,
}: {
  repo: RepoId
  branch: Branch
  worktree: Worktree | undefined
  onClose: () => void
}) {
  const run = useRunGitAction()
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <AlertDialog open onOpenChange={(open) => open || busy || onClose()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {branch.name}?</AlertDialogTitle>
          <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
            {worktree !== undefined && <WorktreeWarning worktree={worktree} />}
            <Field orientation="horizontal">
              <Checkbox id="delete-branch-force" checked={force} onCheckedChange={setForce} />
              <FieldLabel htmlFor="delete-branch-force" className="font-normal">
                Delete even if it has commits that aren't merged anywhere
              </FieldLabel>
            </Field>
            {error !== null && <FieldError className="whitespace-pre-line">{error}</FieldError>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void run(repo, (c) =>
                c("DeleteBranch", { repo, name: branch.name, force, removeWorktree: worktree !== undefined }),
              ).then((exit) => {
                if (Exit.isSuccess(exit)) return onClose()
                setError(describeFailure(exit.cause))
                setBusy(false)
              })
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {worktree === undefined ? "Delete branch" : "Delete branch and worktree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function WorktreeWarning({ worktree }: { worktree: Worktree }) {
  const status = useAtomValue(statusAtom(worktree.path as RepoId))
  const dirty = latest(status)?.entries.length
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {dirty === undefined
          ? "Checking for uncommitted changes…"
          : dirty === 0
            ? "The worktree has no uncommitted changes."
            : `${dirty} uncommitted ${dirty === 1 ? "file" : "files"} will be deleted.`}
      </AlertTitle>
      <AlertDescription>
        This branch is checked out in <span className="font-mono break-all">{worktree.path}</span>. The worktree will be
        removed{worktree.locked !== null ? " even though it is locked" : ""}.
      </AlertDescription>
    </Alert>
  )
}

const worktreePath = (refs: Refs | undefined, repo: RepoId, branch: string) => {
  const main = refs?.worktrees.find((worktree) => worktree.isMain)?.path ?? repo
  return `${main}-${branch.replace(/[^\w.-]+/g, "-")}`
}
