import { useAtomValue } from "@effect/atom-react"
import type { RepoId } from "@gitui/contracts"
import { cn } from "cn"
import { type ReactElement, useState } from "react"
import { Autocomplete, AutocompleteContent, AutocompleteInput, AutocompleteItem } from "@/components/ui/autocomplete"
import { Hint } from "@/components/ui/tooltip"
import { comparisonLabel } from "@/lib/comparison"
import { shortOid } from "@/lib/format"
import { commitAtom, latest, refsAtom, statusAtom } from "@/lib/git"

type RefKind = "current" | "branch" | "remote" | "tag"

type RefOption = { readonly ref: string; readonly label: string; readonly kind: RefKind }

const isFullOid = (ref: string) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref)

export const useRefOptions = (repo: RepoId): ReadonlyArray<RefOption> => {
  const refs = latest(useAtomValue(refsAtom(repo)))
  const status = latest(useAtomValue(statusAtom(repo)))
  const current = status?.head._tag === "Branch" ? status.head.name : null
  return [
    { ref: "HEAD", label: "HEAD", kind: "current" },
    ...(refs?.branches ?? [])
      .toSorted((a, b) => Number(b.name === current) - Number(a.name === current))
      .map((ref) => ({ ref: `refs/heads/${ref.name}`, label: ref.name, kind: "branch" as const })),
    ...(refs?.remoteBranches ?? []).map((ref) => ({
      ref: `refs/remotes/${ref.name}`,
      label: ref.name,
      kind: "remote" as const,
    })),
    ...(refs?.tags ?? []).map((ref) => ({ ref: `refs/tags/${ref.name}`, label: ref.name, kind: "tag" as const })),
  ]
}

export function RefPicker({
  id,
  label,
  repo,
  value,
  options,
  onCommit,
  className,
}: {
  id: string
  label: string
  repo: RepoId
  value: string
  options: ReadonlyArray<RefOption>
  onCommit: (ref: string) => void
  className?: string
}) {
  const [text, setText] = useState(() => comparisonLabel(value))
  const [query, setQuery] = useState<string | null>(null)
  const kinds = new Map(options.map((option) => [option.label, option.kind]))
  const labels = options.map((option) => option.label)
  const needle = query?.trim().toLowerCase() ?? ""
  const shown = needle === "" ? labels : labels.filter((label) => label.toLowerCase().includes(needle))
  const resolve = (next: string) => {
    const trimmed = next.trim()
    return (
      options.find((option) => option.label === trimmed)?.ref ??
      (isFullOid(value) && shortOid(value) === trimmed ? value : trimmed)
    )
  }
  const commit = (next: string) => {
    const ref = resolve(next)
    if (ref !== "" && ref !== value) onCommit(ref)
  }
  const picker = (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <label htmlFor={id} className="shrink-0 text-2xs text-muted-foreground">
        {label}
      </label>
      <Autocomplete
        openOnInputClick
        items={labels}
        filteredItems={shown}
        value={text}
        onValueChange={(next) => {
          setText(next)
          if (kinds.has(next)) {
            setQuery(null)
            commit(next)
          } else setQuery(next)
        }}
      >
        <AutocompleteInput
          id={id}
          className="h-6"
          spellCheck={false}
          onFocus={(event) => {
            setQuery(null)
            event.currentTarget.select()
          }}
          onBlur={() => commit(text)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.currentTarget.hasAttribute("aria-activedescendant")) commit(text)
          }}
        />
        <AutocompleteContent>
          {(label: string) => (
            <AutocompleteItem key={label} value={label} className="gap-2">
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="shrink-0 text-2xs text-muted-foreground">{kinds.get(label)}</span>
            </AutocompleteItem>
          )}
        </AutocompleteContent>
      </Autocomplete>
    </div>
  )
  return isFullOid(value) ? (
    <CommitHint repo={repo} oid={value}>
      {picker}
    </CommitHint>
  ) : (
    picker
  )
}

function CommitHint({ repo, oid, children }: { repo: RepoId; oid: string; children: ReactElement }) {
  const commit = latest(useAtomValue(commitAtom(`${repo}\n${oid}`)))
  return <Hint label={commit?.message.split("\n", 1)[0]}>{children}</Hint>
}
