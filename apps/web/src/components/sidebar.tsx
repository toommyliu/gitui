import { useAtomValue } from "@effect/atom-react"
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
  useRunGitAction,
} from "@/lib/git"
import type { Selection } from "@/lib/selection"
import { type Location, type LocationState, focusLocation, locationState, toggleLocation } from "@/lib/visibility"
import { useRefreshOnFocus, worktreeLabel, worktreeSummariesAtom, worktreesKey } from "@/lib/worktrees"
import { useConfirm } from "./confirm"
import { SyncButtons } from "./network"
import { usePrompt } from "./prompt"
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

const ROW = 22

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
            return (
              <div
                key={item.key}
                className="group/row absolute top-0 left-0 w-full"
                style={{ height: ROW, transform: `translateY(${item.start}px)` }}
              >
                <div className={cn("h-full", state !== "shown" && "opacity-50")}>
                  <SidebarRow
                    row={row}
                    repo={repo}
                    refs={refs}
                    head={head}
                    collapsed={collapsed}
                    toggle={toggle}
                    onSelect={onSelect}
                    onOpen={(path) => onOpen(path, refs?.worktrees.map((worktree) => worktree.path) ?? [])}
                    selectedWorktree={selection._tag === "Worktree" ? selection.path : null}
                    worktreeByBranch={worktreeByBranch}
                    onDelete={(branch) => setDeleting({ branch, worktree: worktreeByBranch.get(branch.name) })}
                    onRemove={(worktree, force) => setRemoving({ worktree, force })}
                  />
                </div>
                {location !== null && state !== "inherited" && (
                  <VisibilityToggle
                    hidden={state === "hidden"}
                    label={location.name ?? location.section}
                    header={row.kind === "section"}
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
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b pr-1 pl-2 whitespace-nowrap">
      <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 truncate font-semibold" />}>{name}</TooltipTrigger>
        <TooltipContent side="bottom">{name}</TooltipContent>
      </Tooltip>
      {head._tag === "Unborn" && <span className="min-w-0 truncate text-muted-foreground">no commits yet</span>}
      {operation !== null && (
        <Badge variant="destructive" className="shrink-0">
          {operation} in progress
        </Badge>
      )}
      <SyncButtons repo={repo} upstream={upstream} />
    </div>
  )
}

function SmallBadge({ className, ...props }: ComponentProps<typeof Badge>) {
  return (
    <Badge variant="secondary" className={cn("h-4 rounded-sm px-1 text-[10px] tabular-nums", className)} {...props} />
  )
}

function WorktreeChips({ repo, worktree }: { repo: RepoId; worktree: Worktree }) {
  const summary = latest(useAtomValue(worktreeSummariesAtom(repo)))?.find((s) => s.path === worktree.path)
  if (summary === undefined) return null
  const commits = summary.commits ?? 0
  return (
    <span className="ml-auto flex shrink-0 gap-1">
      {commits > 0 && <SmallBadge>{commits === 1 ? "1 commit" : `${commits} commits`}</SmallBadge>}
      {summary.changes > 0 && <SmallBadge>{summary.changes === 1 ? "1 file" : `${summary.changes} files`}</SmallBadge>}
      {!worktree.isMain && summary.commits === 0 && summary.changes === 0 && (
        <SmallBadge variant="outline">empty</SmallBadge>
      )}
    </span>
  )
}

function Line({
  depth,
  onClick,
  active,
  selected,
  children,
  ...props
}: {
  depth: number
  onClick?: () => void
  active?: boolean
  selected?: boolean
  children: ReactNode
} & Pick<ComponentProps<"button">, "title" | "onDoubleClick" | "onKeyDown">) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...props}
      className={cn(
        "flex h-full w-full items-center gap-1.5 pr-2 text-left whitespace-nowrap",
        selected ? "bg-selection" : "hover:bg-muted/60",
        active && "font-semibold",
      )}
      style={{ paddingLeft: 12 + depth * 12 }}
    >
      {children}
    </button>
  )
}

function VisibilityToggle({
  hidden,
  label,
  header,
  onToggle,
}: {
  hidden: boolean
  label: string
  header: boolean
  onToggle: (focus: boolean) => void
}) {
  const action = `${hidden ? "Show" : "Hide"} ${label} in history`
  const shortcut = "Alt-click or Alt+Enter to focus"
  return (
    <span className="absolute inset-y-0 right-0 hidden bg-background group-focus-within/row:flex group-hover/row:flex">
      <span className={cn("flex items-center px-1", !header && "group-hover/row:bg-muted/60")}>
        <button
          type="button"
          aria-label={action}
          aria-description={shortcut}
          title={`${action}\n${shortcut}`}
          onClick={(event) => onToggle(event.altKey)}
          onKeyDown={(event) => {
            if (event.altKey && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault()
              onToggle(true)
            }
          }}
          className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
        >
          {hidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
        </button>
      </span>
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
  selectedWorktree,
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
  selectedWorktree: string | null
  worktreeByBranch: Map<string, Worktree>
  onDelete: (branch: Branch) => void
  onRemove: (worktree: Worktree, force: boolean) => void
}) {
  const git = useGitAction()
  const checkout = useCheckout()
  const date = useHistoryDate()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const network = useNetwork(repo)
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
      const remoteOid =
        upstream?._tag === "Tracking"
          ? refs?.remoteBranches.find((remote) => remote.name === upstream.name)?.oid
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
          onConfirm: () => void network.run({ action: "ForcePush", expected }),
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
                <span className="truncate text-[11px] text-muted-foreground">in {basename(worktree.path)}</span>
              )}
              <span className="ml-auto flex shrink-0 gap-1 tabular-nums">
                {upstream?._tag === "Gone" && <SmallBadge variant="outline">gone</SmallBadge>}
                {upstream?._tag === "Tracking" && upstream.ahead > 0 && <SmallBadge>{upstream.ahead}↑</SmallBadge>}
                {upstream?._tag === "Tracking" && upstream.behind > 0 && <SmallBadge>{upstream.behind}↓</SmallBadge>}
              </span>
            </Line>
          </ContextMenuTrigger>
          <ContextMenuContent>
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
            {isHead && upstream?._tag === "Tracking" && (
              <ContextMenuItem
                variant="destructive"
                disabled={remoteOid === undefined}
                onClick={() => remoteOid !== undefined && forcePush(upstream.name, remoteOid)}
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
            <ContextMenuItem onClick={() => void checkout(repo, local)}>Check out as {local}</ContextMenuItem>
            <ContextMenuSeparator />
            {integrate(row.ref.name, head?._tag === "Unborn")}
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() =>
                confirm({
                  title: `Delete ${row.ref.name}?`,
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
                      c("DeleteRemoteBranch", { repo, name: row.ref.name }),
                    ),
                })
              }
            >
              Delete remote-tracking branch…
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
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{date(stash.time)}</span>
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
              selected={selectedWorktree === worktree.path}
              title={worktree.path}
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
                <span className="truncate text-[11px] text-muted-foreground">
                  {worktree.head._tag === "Detached" ? "detached" : "bare"}
                </span>
              )}
              {worktree.locked !== null && (
                <SmallBadge variant="outline" className="ml-auto">
                  locked
                </SmallBadge>
              )}
              {worktree.prunable !== null ? (
                <SmallBadge variant="destructive" className="ml-auto">
                  missing
                </SmallBadge>
              ) : current ? (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">this tab</span>
              ) : (
                openable && <WorktreeChips repo={repo} worktree={worktree} />
              )}
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
  const header = (
    <button
      type="button"
      onClick={() => toggle(row.id)}
      className="flex h-full w-full items-center gap-1.5 px-2 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
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
          <ContextMenuItem onClick={stash}>Stash changes…</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
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
        <ContextMenuItem onClick={() => git("Prune worktrees", repo, (c) => c("PruneWorktrees", { repo }))}>
          Prune missing worktrees
        </ContextMenuItem>
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
