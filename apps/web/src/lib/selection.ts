import { useAtomSet } from "@effect/atom-react"
import type { Comparison, Oid, RepoId } from "@gitui/contracts"
import * as Atom from "effect/reactivity/Atom"
import type { FileTarget } from "./file-investigation"
import { isNarrow } from "./narrow"

export type Selection =
  | { readonly _tag: "WorkingCopy" }
  | { readonly _tag: "Comparison"; readonly comparison: Comparison }
  | { readonly _tag: "Commit"; readonly oid: Oid }
  | { readonly _tag: "Worktree"; readonly path: string }
  | { readonly _tag: "FileHistory"; readonly target: FileTarget; readonly back: Selection }

export type Pane = "locations" | "history" | "detail"

export const selectionAtom = Atom.family((_repo: RepoId) =>
  Atom.make<Selection>({ _tag: "WorkingCopy" }).pipe(Atom.keepAlive),
)

export const paneAtom = Atom.family((_repo: RepoId) => Atom.make<Pane>("history").pipe(Atom.keepAlive))

export const useSelect = (repo: RepoId) => {
  const setSelection = useAtomSet(selectionAtom(repo))
  const setPane = useAtomSet(paneAtom(repo))
  return (next: Selection) => {
    setSelection(next)
    if (isNarrow()) setPane("detail")
  }
}
