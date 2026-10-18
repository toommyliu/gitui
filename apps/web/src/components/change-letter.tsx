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
  added: "text-[var(--lane-1)]",
  deleted: "text-destructive",
  modified: "text-[var(--lane-2)]",
  renamed: "text-[var(--lane-0)]",
  copied: "text-[var(--lane-0)]",
  typechange: "text-[var(--lane-6)]",
}

export function ChangeLetter({ change }: { change: FileChange["change"] }) {
  return <span className={cn("w-3 shrink-0 font-mono font-semibold", changeColor[change])}>{changeLetter[change]}</span>
}
