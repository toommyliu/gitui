import type { ConflictRef, Oid, RepoId } from "@gitui/contracts"
import { SearchIcon } from "lucide-react"
import { useState } from "react"
import { shortOid } from "@/lib/format"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { CommitDetail } from "./commit-detail"

export function CommitReference({ repo, reference }: { repo: RepoId; reference: ConflictRef }) {
  const [oid, setOid] = useState<Oid | null>(null)
  const label = reference.name === null ? shortOid(reference.oid) : `${reference.name} ${shortOid(reference.oid)}`
  return (
    <Dialog open={oid !== null} onOpenChange={(open) => setOid(open ? reference.oid : null)}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="max-w-full min-w-0 justify-start gap-1.5 text-xs font-normal text-inherit transition-colors hover:bg-current/10 hover:text-inherit dark:hover:bg-current/10"
            title={`View commit details: ${label} ${reference.subject}`}
            aria-label={`View commit details for ${label}: ${reference.subject}`}
          />
        }
      >
        <SearchIcon aria-hidden strokeWidth={1.5} data-icon="inline-start" className="size-3.5" />
        <span className="truncate">
          {label} {reference.subject}
        </span>
      </DialogTrigger>
      <DialogContent className="flex h-[85dvh] w-[92vw] max-w-none flex-col gap-0 p-0 text-xs sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
          <DialogTitle className="text-sm">Commit {shortOid(oid ?? reference.oid)}</DialogTitle>
          <DialogDescription className="sr-only">
            Commit details and changed files. Close to return to your merge draft.
          </DialogDescription>
        </DialogHeader>
        {oid !== null && (
          <div className="min-h-0 flex-1">
            <CommitDetail
              key={oid}
              repo={repo}
              oid={oid}
              onSelect={(selection) => {
                if (selection._tag === "Commit") setOid(selection.oid)
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
