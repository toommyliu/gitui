import { useAtomValue } from "@effect/atom-react"
import type { Branch, Head, Oid, RemoteBranch, RepoId, Stash, Tag, Worktree } from "@gitui/contracts"
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
} from "@workspace/ui/components/alert-dialog"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { cn } from "cn"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { basename, shortDate } from "@/lib/format"
import { latest, refsAtom, statusAtom, useGitAction } from "@/lib/git"
import type { Selection } from "@/lib/selection"
import { useConfirm } from "./confirm"

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

export function Sidebar({ repo, onSelect }: { repo: RepoId; onSelect: (selection: Selection) => void }) {
  const refs = latest(useAtomValue(refsAtom(repo)))
  const head = latest(useAtomValue(statusAtom(repo)))?.head
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center border-b px-3 font-medium text-muted-foreground">Locations</div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1 [contain:strict]">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              className="absolute top-0 left-0 w-full"
              style={{ height: ROW, transform: `translateY(${item.start}px)` }}
            >
              <SidebarRow
                row={rows[item.index]!}
                repo={repo}
                head={head}
                collapsed={collapsed}
                toggle={toggle}
                onSelect={onSelect}
                worktreeByBranch={worktreeByBranch}
                onDelete={(branch) => setDeleting({ branch, worktree: worktreeByBranch.get(branch.name) })}
              />
            </div>
          ))}
        </div>
      </div>
      {deleting !== null && (
        <DeleteBranchDialog
          repo={repo}
          branch={deleting.branch}
          worktree={deleting.worktree}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function Line({
  depth,
  onClick,
  active,
  children,
}: {
  depth: number
  onClick?: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full w-full items-center gap-1.5 pr-2 text-left whitespace-nowrap hover:bg-muted/60",
        active && "font-semibold",
      )}
      style={{ paddingLeft: 12 + depth * 12 }}
    >
      {children}
    </button>
  )
}

const Disclosure = ({ open }: { open: boolean }) => (
  <span
    className={cn(
      "inline-block w-2 shrink-0 text-[9px] text-muted-foreground transition-transform",
      open && "rotate-90",
    )}
  >
    ▶
  </span>
)

function SidebarRow({
  row,
  repo,
  head,
  collapsed,
  toggle,
  onSelect,
  worktreeByBranch,
  onDelete,
}: {
  row: Row
  repo: RepoId
  head: Head | undefined
  collapsed: ReadonlySet<string>
  toggle: (id: string) => void
  onSelect: (selection: Selection) => void
  worktreeByBranch: Map<string, Worktree>
  onDelete: (branch: Branch) => void
}) {
  const git = useGitAction()
  const confirm = useConfirm()
  const select = (oid: Oid) => onSelect({ _tag: "Commit", oid })

  switch (row.kind) {
    case "section":
      return <SectionRow row={row} open={!collapsed.has(row.id)} toggle={toggle} repo={repo} />
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
      return (
        <ContextMenu>
          <ContextMenuTrigger className="block h-full">
            <Line depth={row.depth} active={isHead} onClick={() => select(branch.oid)}>
              <span className="w-2 shrink-0" />
              <span className="truncate">{row.label}</span>
              {worktree !== undefined && (
                <span className="truncate text-[11px] text-muted-foreground">in {basename(worktree.path)}</span>
              )}
              <span className="ml-auto flex shrink-0 gap-1 text-[11px] text-muted-foreground tabular-nums">
                {upstream?._tag === "Gone" && <span>gone</span>}
                {upstream?._tag === "Tracking" && upstream.ahead > 0 && <span>{upstream.ahead}↑</span>}
                {upstream?._tag === "Tracking" && upstream.behind > 0 && <span>{upstream.behind}↓</span>}
              </span>
            </Line>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={isHead || worktree !== undefined}
              onClick={() => git("Checkout", repo, (c) => c("Checkout", { repo, branch: branch.name }))}
            >
              Check out {branch.name}
            </ContextMenuItem>
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
      return (
        <ContextMenu>
          <ContextMenuTrigger className="block h-full">
            <Line depth={row.depth} onClick={() => select(row.ref.oid)}>
              <span className="w-2 shrink-0" />
              <span className="truncate">{row.label}</span>
            </Line>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => git("Checkout", repo, (c) => c("Checkout", { repo, branch: local }))}>
              Check out as {local}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    }
    case "tag":
      return (
        <Line depth={row.depth} onClick={() => select(row.tag.oid)}>
          <span className="w-2 shrink-0" />
          <span className="truncate">{row.label}</span>
        </Line>
      )
    case "stash": {
      const { stash } = row
      return (
        <ContextMenu>
          <ContextMenuTrigger className="block h-full">
            <Line depth={1} onClick={() => select(stash.oid)}>
              <span className="w-2 shrink-0" />
              <span className="truncate">{stash.message}</span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{shortDate(stash.time)}</span>
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
      const label =
        worktree.head._tag === "Branch" ? worktree.head.name : worktree.head._tag === "Detached" ? "detached" : "bare"
      const remove = (force: boolean) =>
        confirm({
          title: force ? "Force remove worktree?" : "Remove worktree?",
          body: (
            <div className="space-y-2">
              <p className="font-mono text-xs break-all">{worktree.path}</p>
              {force && <p>Uncommitted and untracked files in this worktree will be deleted.</p>}
            </div>
          ),
          confirmLabel: force ? "Force remove" : "Remove",
          destructive: true,
          onConfirm: () =>
            git("Remove worktree", repo, (c) => c("RemoveWorktree", { repo, path: worktree.path, force })),
        })
      return (
        <ContextMenu>
          <ContextMenuTrigger className="block h-full">
            <Line depth={1} active={current} onClick={() => worktree.head._tag !== "Bare" && select(worktree.head.oid)}>
              <span className="w-2 shrink-0" />
              <span className="truncate">{basename(worktree.path)}</span>
              <span className="truncate text-[11px] text-muted-foreground">{label}</span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {worktree.locked !== null ? "locked" : worktree.prunable !== null ? "missing" : ""}
              </span>
            </Line>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={worktree.isMain || current} onClick={() => remove(false)}>
              Remove worktree…
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" disabled={worktree.isMain || current} onClick={() => remove(true)}>
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
}: {
  row: Extract<Row, { kind: "section" }>
  open: boolean
  toggle: (id: string) => void
  repo: RepoId
}) {
  const git = useGitAction()
  const header = (
    <button
      type="button"
      onClick={() => toggle(row.id)}
      className="flex h-full w-full items-center gap-1.5 px-2 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
    >
      <Disclosure open={open} />
      {row.label}
      <span className="font-normal tabular-nums">{row.count}</span>
    </button>
  )
  if (row.id !== "worktrees") return header
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full">{header}</ContextMenuTrigger>
      <ContextMenuContent>
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
  const git = useGitAction()
  const [force, setForce] = useState(false)
  return (
    <AlertDialog open onOpenChange={(open) => open || onClose()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {branch.name}?</AlertDialogTitle>
          <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
            {worktree !== undefined && <WorktreeWarning worktree={worktree} />}
            <label className="flex items-start gap-2">
              <Checkbox checked={force} onCheckedChange={setForce} className="mt-0.5" />
              <span>Delete even if it has commits that aren't merged anywhere</span>
            </label>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onClose()
              void git("Delete branch", repo, (c) =>
                c("DeleteBranch", { repo, name: branch.name, force, removeWorktree: worktree !== undefined }),
              )
            }}
          >
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
    <div className="space-y-1 rounded-md bg-destructive/10 p-2 text-destructive">
      <p>
        This branch is checked out in <span className="font-mono break-all">{worktree.path}</span>. The worktree will be
        removed{worktree.locked !== null ? " even though it is locked" : ""}.
      </p>
      <p className="font-medium">
        {dirty === undefined
          ? "Checking for uncommitted changes…"
          : dirty === 0
            ? "It has no uncommitted changes."
            : `${dirty} uncommitted ${dirty === 1 ? "file" : "files"} will be deleted.`}
      </p>
    </div>
  )
}
