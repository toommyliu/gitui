import type { FileChange } from "@gitui/contracts"
import { cn } from "cn"

const changeLetter: Record<FileChange["change"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  typechange: "T",
}

export const changeColor: Record<FileChange["change"], string> = {
  added: "text-change-added",
  deleted: "text-change-deleted",
  modified: "text-change-modified",
  renamed: "text-change-renamed",
  copied: "text-change-renamed",
  typechange: "text-change-renamed",
}

export function ChangeLetter({ change }: { change: FileChange["change"] }) {
  return <span className={cn("w-3 shrink-0 font-mono font-semibold", changeColor[change])}>{changeLetter[change]}</span>
}
