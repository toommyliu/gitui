import { useAtom, useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { comparisonDialogAtom, comparisonModes, type ComparisonDraft } from "@/lib/comparison"
import { latest, refsAtom, statusAtom } from "@/lib/git"
import type { Selection } from "@/lib/selection"

export function ComparisonDialog({ repo, onSelect }: { repo: RepoId; onSelect: (selection: Selection) => void }) {
  const [draft, setDraft] = useAtom(comparisonDialogAtom(repo))
  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open) setDraft(null)
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-lg">
        {draft !== null && (
          <ComparisonForm repo={repo} draft={draft} onClose={() => setDraft(null)} onSelect={onSelect} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ComparisonForm({
  repo,
  draft,
  onClose,
  onSelect,
}: {
  repo: RepoId
  draft: ComparisonDraft
  onClose: () => void
  onSelect: (selection: Selection) => void
}) {
  const id = useId()
  const refs = latest(useAtomValue(refsAtom(repo)))
  const status = latest(useAtomValue(statusAtom(repo)))
  const current = status?.head._tag === "Branch" ? `refs/heads/${status.head.name}` : "HEAD"
  const main = refs?.branches.find((branch) => branch.name === "main" || branch.name === "master")
  const defaultBase =
    main !== undefined && draft.head !== `refs/heads/${main.name}` ? `refs/heads/${main.name}` : current
  const [base, setBase] = useState(draft.base ?? defaultBase)
  const [head, setHead] = useState(draft.head)
  const [mode, setMode] = useState(draft.mode)
  const options = [
    "HEAD",
    ...(refs?.branches.map((ref) => `refs/heads/${ref.name}`) ?? []),
    ...(refs?.remoteBranches.map((ref) => `refs/remotes/${ref.name}`) ?? []),
    ...(refs?.tags.map((ref) => `refs/tags/${ref.name}`) ?? []),
  ]
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSelect({ _tag: "Comparison", comparison: { base: base.trim(), head: head.trim(), mode } })
        onClose()
      }}
    >
      <DialogHeader>
        <DialogTitle>Compare changes</DialogTitle>
        <DialogDescription>
          Choose branches, tags or commit SHAs. Revision expressions such as HEAD~3 also work.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor={`${id}-base`}>Base</FieldLabel>
        <Input
          id={`${id}-base`}
          autoFocus
          required
          list={`${id}-refs`}
          value={base}
          onChange={(event) => setBase(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-head`}>Compare</FieldLabel>
        <Input
          id={`${id}-head`}
          required
          list={`${id}-refs`}
          value={head}
          onChange={(event) => setHead(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <datalist id={`${id}-refs`}>
        {options.map((ref) => (
          <option key={ref} value={ref} />
        ))}
      </datalist>
      <fieldset className="grid gap-3">
        <legend className="mb-2 text-xs font-medium">Comparison</legend>
        {Object.values(comparisonModes).map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-xs">
            <input
              type="radio"
              name={`${id}-mode`}
              value={option.value}
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
              className="mt-1 accent-primary"
            />
            <span>
              {option.label}
              <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Compare</Button>
      </DialogFooter>
    </form>
  )
}
