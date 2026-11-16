import { Menu, MenuContent, MenuContextTrigger, MenuItem, MenuSeparator, MenuTrigger } from "@ui-sdk/solid/menu"
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/solid/segmented-control"
import {
  Tree,
  TreeGroup,
  TreeItem,
  TreeItemIndicator,
  TreeItemLabel,
  type TreeItemData,
  visibleTreeRows,
} from "@ui-sdk/solid/tree"
import type { Comparison, ComparisonMode, Worktree } from "@gitui/contracts"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { compareModes, openCompare, showComparison, shownComparison } from "@/lib/comparison"
import { runCommand, useCommand } from "@/lib/hotkeys"
import { type RefSelection, selectRef, single } from "@/lib/ref-selection"
import { useRepo } from "@/lib/repo"
import { type Location, toggleLocation } from "@/lib/visibility"
import { active } from "@/lib/workspaces"
import { ComparisonPane } from "./compare/comparison-pane"
import { SwapIcon } from "./compare/compare-launcher"
import { Check, ChevronDown, Eye, EyeOff, More } from "./icons"
import { AheadBehind } from "./refs/ahead-behind"
import { type SelectHow, howOf } from "./file-tree"
import {
  bulkOf,
  compareTarget,
  groupsOf,
  matches,
  nodesOf,
  type RefNode,
  type RowVisibility,
  rowVisibility,
  treeOf,
  worktreeHead,
} from "./refs/model"
import {
  createRefActions,
  hasSectionMenu,
  type RefActions,
  RefDialogs,
  RefMenuItems,
  SectionMenuItems,
} from "./refs/actions"
import { BulkDetail, BulkMenuItems } from "./refs/bulk"
import { RefDetail } from "./refs/ref-detail"
import { WorktreePreview } from "./refs/worktree-preview"
import { Split } from "./split"
import { Button, Count, Empty, SearchBar, Tip } from "./ui"

function RefRow(props: { node: RefNode; label: string; current: boolean }) {
  return (
    <>
      <Show when={props.current}>
        <Check class="-ms-[18px] size-3 shrink-0 text-primary" />
      </Show>
      <span class={["min-w-0 flex-1 truncate", props.current && "font-medium"]}>{props.label}</span>
      <Switch>
        <Match when={props.node.kind === "local" ? props.node.branch.upstream : undefined}>
          {(upstream) => <AheadBehind upstream={upstream()} />}
        </Match>
        <Match when={props.node.kind === "worktree" ? props.node.worktree : undefined}>
          {(worktree) => (
            <span class="max-w-[45%] shrink-0 truncate text-2xs text-muted-foreground">{worktreeHead(worktree())}</span>
          )}
        </Match>
      </Switch>
    </>
  )
}

const visibilityAction = (hidden: boolean) => (hidden ? "Show in History" : "Hide in History")

function VisibilityToggle(props: { hidden: boolean; onToggle: () => void }) {
  const label = () => visibilityAction(props.hidden)
  return (
    <Tip label={label()}>
      {(trigger) => (
        <button
          {...trigger}
          type="button"
          tabindex={-1}
          data-visibility
          aria-label={label()}
          class={[
            "-me-1 size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
            props.hidden ? "flex" : "hidden group-hover/ref:flex",
          ]}
          onPointerDown={(event) => event.stopPropagation()}
          onDblClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            props.onToggle()
          }}
        >
          {props.hidden ? <EyeOff /> : <Eye />}
        </button>
      )}
    </Tip>
  )
}

function RefItems(props: {
  items: ReadonlyArray<TreeItemData>
  nodeOf: (key: string) => RefNode | undefined
  isCurrent: (node: RefNode) => boolean
  isMarked: (key: string) => boolean
  visibilityOf: (key: string) => RowVisibility
  onToggleVisibility: (location: Location) => void
  menuKey: string | null
  onOpen: (node: RefNode) => void
}) {
  return (
    <For each={props.items} keyed={(item) => item.value}>
      {(item) => (
        <TreeItem value={item().value} class="data-[level=1]:not-first:mt-2">
          <TreeItemLabel
            data-ref={item().value}
            data-context={props.menuKey === item().value ? "" : undefined}
            data-marked={props.isMarked(item().value) ? "" : undefined}
            data-dimmed={props.visibilityOf(item().value).dimmed ? "" : undefined}
            class="group/ref data-context:outline-1 data-context:-outline-offset-1 data-context:outline-ring data-dimmed:[&>:not([data-visibility])]:opacity-50"
            onDblClick={() => {
              const node = props.nodeOf(item().value)
              if (node !== undefined) props.onOpen(node)
            }}
          >
            <Show
              when={props.nodeOf(item().value)}
              fallback={
                <>
                  <TreeItemIndicator>
                    <ChevronDown />
                  </TreeItemIndicator>
                  <span class={["min-w-0 flex-1 truncate", item().value.startsWith("section:") && "section-label"]}>
                    {item().label}
                  </span>
                  <Count value={item().children?.length ?? 0} />
                </>
              }
            >
              {(found) => <RefRow node={found()} label={item().label} current={props.isCurrent(found())} />}
            </Show>
            <Show when={props.visibilityOf(item().value).toggle}>
              {(toggle) => (
                <VisibilityToggle
                  hidden={toggle().hidden}
                  onToggle={() => props.onToggleVisibility(toggle().location)}
                />
              )}
            </Show>
          </TreeItemLabel>
          <Show when={item().children}>
            {(children) => (
              <TreeGroup>
                <RefItems
                  items={children()}
                  nodeOf={props.nodeOf}
                  isCurrent={props.isCurrent}
                  isMarked={props.isMarked}
                  visibilityOf={props.visibilityOf}
                  onToggleVisibility={props.onToggleVisibility}
                  menuKey={props.menuKey}
                  onOpen={props.onOpen}
                />
              </TreeGroup>
            )}
          </Show>
        </TreeItem>
      )}
    </For>
  )
}

function ListMenu(props: { actions: RefActions }) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="More actions"
        class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-open:bg-muted"
      >
        <More />
      </MenuTrigger>
      <MenuContent class="min-w-44 text-xs">
        <MenuItem onSelect={() => runCommand("history.compare")}>Compare…</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => runCommand("repo.addWorktree")}>Add worktree…</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => props.actions.setDialog({ kind: "cleanup-branches" })}>Clean up branches…</MenuItem>
        <MenuItem onSelect={() => runCommand("repo.cleanupWorktrees")}>Clean up worktrees…</MenuItem>
      </MenuContent>
    </Menu>
  )
}

function ComparisonActions(props: { comparison: Comparison }) {
  const repo = useRepo()
  const update = (next: Partial<Comparison>) => showComparison(repo.id, { ...props.comparison, ...next })
  return (
    <div class="flex shrink-0 items-center gap-1.5">
      <SegmentedControl
        aria-label="What to compare"
        value={props.comparison.mode}
        onValueChange={(next: ComparisonMode | null) => {
          if (next !== null) update({ mode: next })
        }}
      >
        <For each={compareModes}>
          {(option) => <SegmentedControlItem value={option.value}>{option.label}</SegmentedControlItem>}
        </For>
      </SegmentedControl>
      <Tip label="Swap base and compare">
        {(trigger) => (
          <Button
            {...trigger}
            variant="ghost"
            aria-label="Swap base and compare"
            class="w-6 justify-center px-0"
            onClick={() => update({ base: props.comparison.head, head: props.comparison.base })}
          >
            <SwapIcon />
          </Button>
        )}
      </Tip>
      <Button
        variant="ghost"
        onClick={() =>
          openCompare({
            repo: repo.id,
            base: props.comparison.base,
            head: props.comparison.head,
            mode: props.comparison.mode === "direct" ? "direct" : "merge-base",
          })
        }
      >
        Change…
      </Button>
      <Tip label="Close the comparison" keys="Esc">
        {(trigger) => (
          <Button {...trigger} variant="ghost" onClick={() => showComparison(repo.id, null)}>
            Close
          </Button>
        )}
      </Tip>
    </div>
  )
}

const worktreeOfNode = (node: RefNode) => (node.kind === "worktree" ? node.worktree : undefined)

function WorktreeBody(props: { worktree: Worktree }) {
  return (
    <Switch>
      <Match when={props.worktree.prunable !== null}>
        <Empty title="Its folder is missing">Remove it to clear the stale entry from the repository.</Empty>
      </Match>
      <Match when={props.worktree.head._tag === "Bare"}>
        <Empty title="Bare worktree">It has no working files to preview.</Empty>
      </Match>
      <Match when={props.worktree.path} keyed>
        {(path) => <WorktreePreview path={path} />}
      </Match>
    </Switch>
  )
}

export function BranchesView(props: { focused: boolean }) {
  const repo = useRepo()
  const [query, setQuery] = createSignal("")
  const [selection, setSelection] = createSignal<RefSelection | null>(null)
  const selected = () => selection()?.current ?? null
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [menuKey, setMenuKey] = createSignal<string | null>(null)
  const actions = createRefActions({ onRenamed: (name) => select(`local:${name}`) })

  const head = createMemo(() => {
    const value = repo.status().head
    return value._tag === "Detached" ? null : value.name
  })
  const shown = () => shownComparison(repo.id)
  const nodes = createMemo(() => nodesOf(repo.refs()))
  const byKey = createMemo(() => new Map(nodes().map((node) => [node.key, node])))
  const items = createMemo(() => treeOf(nodes().filter((node) => matches(node, query()))))
  const expanded = () => groupsOf(items()).filter((value) => !collapsed().has(value))
  const node = createMemo(
    () => byKey().get(selected() ?? "") ?? byKey().get(`local:${head() ?? ""}`) ?? nodes()[0] ?? null,
  )
  const picked = createMemo(() => {
    const marked = selection()?.marked
    return marked === undefined ? [] : nodes().filter((candidate) => marked.has(candidate.key))
  })
  const bulk = createMemo(() => bulkOf(picked()))
  const isMarked = (key: string) => bulk() !== null && selection()?.marked.has(key) === true
  const isCurrent = actions.isCurrent
  const visibilityOf = (key: string) => rowVisibility(key, repo.visibility(), head())
  const toggleVisibility = (location: Location) => repo.setVisibility(toggleLocation(repo.visibility(), location))
  const openNode = (candidate: RefNode) => {
    if (candidate.kind === "tag" || isCurrent(candidate)) return
    void actions.checkout(candidate)
  }

  const target = createMemo(() => {
    const current = node()
    return current === null ? null : compareTarget(current, head(), active())
  })

  let list: HTMLDivElement | undefined

  const order = () =>
    visibleTreeRows(items(), expanded())
      .map((row) => row.item.value)
      .filter((key) => byKey().has(key))

  const select = (key: string, how: SelectHow = "replace") => {
    showComparison(repo.id, null)
    const from = selection() ?? single(node()?.key ?? key)
    setSelection(selectRef({ from, key, how, order: order(), sectionOf: (value) => byKey().get(value)?.kind }))
    list?.querySelector(`[data-ref="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" })
  }

  const step = (delta: 1 | -1) => {
    const keys = order()
    const index = keys.indexOf(node()?.key ?? "")
    const next = index === -1 ? keys[0] : keys[Math.max(0, Math.min(keys.length - 1, index + delta))]
    if (next !== undefined) select(next)
  }
  let filterInput: HTMLInputElement | undefined
  useCommand("view.search", () => filterInput?.select())
  useCommand("list.next", () => step(1))
  useCommand("list.previous", () => step(-1))
  useCommand(
    "view.back",
    () => showComparison(repo.id, null),
    () => shown() !== null,
  )
  useCommand(
    "view.back",
    () => {
      const current = node()
      if (current !== null) setSelection(single(current.key))
    },
    () => shown() === null && bulk() !== null,
  )

  return (
    <Split
      id="branches"
      listLabel="branches"
      collapsed={props.focused}
      list={
        <>
          <SearchBar
            label="Filter branches"
            placeholder="Filter branches"
            value={query()}
            onInput={setQuery}
            ref={(element) => (filterInput = element)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query() !== "") {
                event.preventDefault()
                setQuery("")
              }
            }}
          >
            <ListMenu actions={actions} />
          </SearchBar>
          <Menu onOpenChange={(open) => open || setMenuKey(null)}>
            <MenuContextTrigger
              ref={(element: HTMLDivElement) => (list = element)}
              class="min-h-0 flex-1 overflow-y-auto"
              onContextMenu={(event: MouseEvent) => {
                const row = event.target instanceof Element ? event.target.closest("[data-ref]") : null
                const key = row?.getAttribute("data-ref") ?? null
                if (key === null || (!byKey().has(key) && !hasSectionMenu(key))) return event.preventDefault()
                setMenuKey(key)
              }}
            >
              <Show when={items().length > 0} fallback={<Empty title={`No refs match “${query().trim()}”`} />}>
                <Tree
                  aria-label="Branches"
                  items={items()}
                  activation="automatic"
                  value={shown() === null ? (node()?.key ?? null) : null}
                  onValueChange={(value, details) => {
                    if (value === null || !byKey().has(value)) return
                    const how = howOf(details.event)
                    if (details.reason !== "item-press" || how === "replace") select(value, how)
                  }}
                  onAction={(value, details) => {
                    const how = howOf(details.event)
                    if (how !== "replace" && byKey().has(value)) select(value, how)
                  }}
                  expanded={expanded()}
                  onExpandedChange={(next) => {
                    const open = new Set(next)
                    setCollapsed(new Set(groupsOf(items()).filter((value) => !open.has(value))))
                  }}
                  class="p-1"
                >
                  <RefItems
                    items={items()}
                    nodeOf={(key) => byKey().get(key)}
                    isCurrent={isCurrent}
                    isMarked={isMarked}
                    visibilityOf={visibilityOf}
                    onToggleVisibility={toggleVisibility}
                    menuKey={menuKey()}
                    onOpen={openNode}
                  />
                </Tree>
              </Show>
            </MenuContextTrigger>
            <MenuContent class="min-w-56">
              <Show when={menuKey()} keyed>
                {(key) => (
                  <Show
                    when={isMarked(key) ? bulk() : null}
                    keyed
                    fallback={
                      <>
                        <Show
                          when={byKey().get(key)}
                          keyed
                          fallback={<SectionMenuItems actions={actions} section={key} />}
                        >
                          {(found) => <RefMenuItems actions={actions} node={found} />}
                        </Show>
                        <Show when={visibilityOf(key).toggle}>
                          {(toggle) => (
                            <>
                              <MenuSeparator />
                              <MenuItem onSelect={() => toggleVisibility(toggle().location)}>
                                {visibilityAction(toggle().hidden)}
                              </MenuItem>
                            </>
                          )}
                        </Show>
                      </>
                    }
                  >
                    {(found) => <BulkMenuItems actions={actions} bulk={found} />}
                  </Show>
                )}
              </Show>
            </MenuContent>
          </Menu>
          <RefDialogs actions={actions} />
        </>
      }
    >
      <Switch fallback={<Empty title="No branches yet">Make a commit to create the first branch.</Empty>}>
        <Match when={shown()}>
          {(comparison) => (
            <Show when={JSON.stringify(comparison())} keyed>
              {(_key) => (
                <ComparisonPane
                  comparison={comparison()}
                  empty="No differences between these"
                  actions={<ComparisonActions comparison={comparison()} />}
                />
              )}
            </Show>
          )}
        </Match>
        <Match when={bulk()}>{(found) => <BulkDetail actions={actions} bulk={found()} nodes={picked()} />}</Match>
        <Match when={node()}>
          {(current) => (
            <>
              <RefDetail node={current()} actions={actions} />
              <Switch>
                <Match when={worktreeOfNode(current())}>{(worktree) => <WorktreeBody worktree={worktree()} />}</Match>
                <Match when={target()} keyed>
                  {(ref) => (
                    <ComparisonPane
                      comparison={{ base: "HEAD", head: ref, mode: "merge-base" }}
                      empty={`${head() ?? "HEAD"} already has everything here`}
                      actions={
                        <Button
                          variant="ghost"
                          onClick={() => openCompare({ repo: repo.id, base: "HEAD", head: ref, mode: "merge-base" })}
                        >
                          Compare with…
                        </Button>
                      }
                    />
                  )}
                </Match>
                <Match when={true}>
                  <Empty title="Nothing to compare">This is what HEAD points at.</Empty>
                </Match>
              </Switch>
            </>
          )}
        </Match>
      </Switch>
    </Split>
  )
}
