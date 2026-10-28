import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { CommitRow, RepoId } from "@gitui/contracts"
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import { useCompare } from "@/lib/comparison"
import { copyWithToast } from "@/lib/clipboard"
import { shortOid } from "@/lib/format"
import { latest, statusAtom, useGitAction } from "@/lib/git"
import { rewriteOpenAtom } from "@/lib/rewrite"
import { useConfirm } from "./confirm"
import { usePrompt } from "./prompt"

const resetModes = [
  ["soft", "Soft", "keep changes staged"],
  ["mixed", "Mixed", "keep changes unstaged"],
  ["hard", "Hard", "discard changes"],
] as const

export function CommitMenuItems({ repo, row }: { repo: RepoId; row: CommitRow }) {
  const git = useGitAction()
  const compare = useCompare(repo)
  const confirm = useConfirm()
  const prompt = usePrompt()
  const status = latest(useAtomValue(statusAtom(repo)))
  const head = status?.head
  const openRewrite = useAtomSet(rewriteOpenAtom(repo))
  const short = shortOid(row.oid)
  const merge = row.parents.length > 1
  const isHead = head !== undefined && head._tag !== "Unborn" && head.oid === row.oid
  const current = head?._tag === "Branch" ? head.name : "HEAD"
  const { oid } = row

  const reset = (mode: "soft" | "mixed" | "hard") => {
    const run = () => git("Reset", repo, (c) => c("Reset", { repo, oid, mode }))
    if (mode !== "hard") return void run()
    confirm({
      title: `Hard reset ${current} to ${short}?`,
      body: <p>Uncommitted changes to tracked files will be lost.</p>,
      confirmLabel: "Hard reset",
      destructive: true,
      onConfirm: () => void run(),
    })
  }

  return (
    <>
      <ContextMenuItem onClick={() => compare({ head: row.oid, base: "HEAD", mode: "direct" })}>
        Compare with…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={() =>
          prompt({
            title: `Create branch at ${short}`,
            fields: [{ key: "name", label: "Branch name" }],
            options: [{ key: "checkout", label: "Check out after creating", initial: true }],
            submitLabel: "Create branch",
            onSubmit: ({ name }, { checkout }) =>
              git("Create branch", repo, (c) => c("CreateBranch", { repo, name, startPoint: oid, checkout })),
          })
        }
      >
        Create branch here…
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() =>
          prompt({
            title: `Create tag at ${short}`,
            fields: [
              { key: "name", label: "Tag name" },
              {
                key: "message",
                label: "Message",
                optional: true,
                multiline: true,
                placeholder: "Leave blank for a lightweight tag",
              },
            ],
            submitLabel: "Create tag",
            onSubmit: ({ name, message }) =>
              git("Create tag", repo, (c) => c("CreateTag", { repo, name, oid, message })),
          })
        }
      >
        Create tag here…
      </ContextMenuItem>
      <ContextMenuItem
        disabled={isHead}
        onClick={() => void git("Check out", repo, (c) => c("CheckoutDetached", { repo, oid }))}
      >
        Check out {short} (detached)
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={isHead || merge}
        onClick={() => void git("Cherry-pick", repo, (c) => c("CherryPick", { repo, oid }))}
      >
        Cherry-pick onto {current}
      </ContextMenuItem>
      <ContextMenuItem disabled={merge} onClick={() => void git("Revert", repo, (c) => c("Revert", { repo, oid }))}>
        Revert commit
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={merge || head?._tag !== "Branch" || status?.operation !== null}>
          Edit history
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={() => openRewrite({ first: oid, target: oid, action: "pick" })}>
            Edit commits from here…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openRewrite({ first: oid, target: oid, action: "reword" })}>
            Reword commit…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openRewrite({ first: oid, target: oid, action: "edit" })}>
            Edit or split commit…
          </ContextMenuItem>
          <ContextMenuItem
            disabled={row.parents[0] === undefined}
            onClick={() => {
              const first = row.parents[0]
              if (first !== undefined) openRewrite({ first, target: oid, action: "squash" })
            }}
          >
            Squash into previous commit…
          </ContextMenuItem>
          <ContextMenuItem
            disabled={row.parents[0] === undefined}
            onClick={() => {
              const first = row.parents[0]
              if (first !== undefined) openRewrite({ first, target: oid, action: "fixup" })
            }}
          >
            Fixup previous commit…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openRewrite({ first: oid, target: oid, action: "drop" })}>
            Drop commit…
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={head?._tag === "Unborn"}>Reset {current} to here</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {resetModes.map(([mode, label, hint]) => (
            <ContextMenuItem
              key={mode}
              variant={mode === "hard" ? "destructive" : "default"}
              onClick={() => reset(mode)}
            >
              {label}
              <span className="text-muted-foreground">{mode === "hard" ? `${hint}…` : hint}</span>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => void copyWithToast(oid, "SHA copied")}>Copy SHA</ContextMenuItem>
    </>
  )
}
