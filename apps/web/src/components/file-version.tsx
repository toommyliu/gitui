import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { FileRevision, Oid, RepoId, RepoPath } from "@gitui/contracts"
import { CopyIcon, RotateCcwIcon } from "lucide-react"
import { type ReactElement, type ReactNode, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { copyWithToast } from "@/lib/clipboard"
import { fileKey, fileRevisionAtom } from "@/lib/file-investigation"
import type { FileVersion } from "@/lib/file-versions"
import { literalPath } from "@/lib/literal-path"
import { longDate, shortOid } from "@/lib/format"
import { latest, loadError } from "@/lib/git"
import { FileCode, size } from "./conflict-view"
import { FileBlame } from "./file-blame"
import { RestoreDialog } from "./file-restore"
import { Loading, Nothing } from "./loading"

export type VersionTab = "contents" | "blame"

export function FileVersionPane({
  repo,
  version,
  investigatedPath,
  tab,
  onTabChange,
  onOpenCommit,
}: {
  repo: RepoId
  version: FileVersion
  investigatedPath: RepoPath
  tab: VersionTab
  onTabChange: (tab: VersionTab) => void
  onOpenCommit: (oid: Oid) => void
}) {
  const atom = fileRevisionAtom(fileKey(repo, version.source.revision, version.source.path))
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  const revision = latest(result)
  const error = loadError(result)
  const [restoring, setRestoring] = useState(false)
  const missing = revision?.content._tag === "Missing"
  return (
    <div className="flex h-full flex-col">
      <VersionSummary version={version} onOpenCommit={onOpenCommit} />
      <Tabs value={tab} onValueChange={(value: VersionTab) => onTabChange(value)} className="min-h-0 flex-1 gap-0">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b pr-2 pl-1">
          <TabsList variant="line" className="h-full p-0">
            <TabsTrigger value="contents" className="h-full rounded-none px-2">
              Contents
            </TabsTrigger>
            <TabsTrigger value="blame" className="h-full rounded-none px-2">
              Blame
            </TabsTrigger>
          </TabsList>
          <span
            className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground tabular-nums"
            title={revision?.blob ?? undefined}
          >
            {revision !== undefined && !missing && revisionFacts(revision)}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={revision === undefined || missing}
            title={missing ? "There's no file to restore at this version." : undefined}
            onClick={() => setRestoring(true)}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Restore…
          </Button>
        </div>
        <TabsContent value="contents" className="min-h-0">
          {revision === undefined ? (
            error === undefined ? (
              <Loading label="Loading file" />
            ) : (
              <Nothing title="Couldn't load this version" description={error} onRetry={refresh} />
            )
          ) : (
            <RevisionContents revision={revision} absent={absentReason(version)} />
          )}
        </TabsContent>
        <TabsContent value="blame" className="min-h-0">
          {missing ? (
            <Nothing title="Not in this version" description={absentReason(version)} />
          ) : (
            <FileBlame repo={repo} source={version.source} onOpenCommit={onOpenCommit} />
          )}
        </TabsContent>
      </Tabs>
      <RestoreDialog
        open={restoring}
        onOpenChange={setRestoring}
        repo={repo}
        source={version.source}
        deletedIn={version._tag === "BeforeDeletion" ? version.entry.oid : null}
        defaultDestination={investigatedPath}
      />
    </div>
  )
}

const revisionFacts = (revision: FileRevision) =>
  [size(revision.bytes), revision.mode, revision.blob === null ? null : `blob ${shortOid(revision.blob)}`]
    .filter((fact) => fact !== null)
    .join(" · ")

const absentReason = (version: FileVersion) =>
  version._tag === "Head"
    ? `${version.source.path} isn't in the HEAD commit. A new file shows up here after you commit it.`
    : `${version.source.path} doesn't exist in commit ${shortOid(version.source.revision)}.`

function RevisionContents({ revision, absent }: { revision: FileRevision; absent: string }): ReactElement {
  const { content } = revision
  switch (content._tag) {
    case "Text":
      return content.content === "" ? (
        <Nothing title="Empty file" description="This version has no content." />
      ) : (
        <FileCode path={revision.path} contents={content.content} />
      )
    case "Binary":
      return (
        <Nothing
          title="Binary file"
          description={`This version is ${size(revision.bytes)}. Binary contents aren't shown.`}
        />
      )
    case "TooLarge":
      return (
        <Nothing
          title="Too large to preview"
          description={`This version is ${size(revision.bytes)}. Previews are limited to 1 MB.`}
        />
      )
    case "Symlink":
      return (
        <Nothing
          title="Symbolic link"
          description={
            content.target === null ? (
              "The link target couldn't be read."
            ) : (
              <>
                Points to <code className="font-mono break-all text-foreground">{content.target}</code>
              </>
            )
          }
        />
      )
    case "Submodule":
      return (
        <Nothing
          title="Submodule"
          description={
            revision.blob === null ? (
              "This path is a submodule, so it has no file contents."
            ) : (
              <>
                This path is a submodule pinned to commit{" "}
                <code className="font-mono break-all text-foreground">{revision.blob}</code>.
              </>
            )
          }
        />
      )
    case "Missing":
      return <Nothing title="Not in this version" description={absent} />
  }
}

function VersionSummary({ version, onOpenCommit }: { version: FileVersion; onOpenCommit: (oid: Oid) => void }) {
  switch (version._tag) {
    case "Head":
      return (
        <Summary title="Committed version at HEAD" note="Uncommitted changes in your working tree aren't shown here.">
          <Fact label="Commit">
            <Sha oid={version.source.revision} onOpen={onOpenCommit} />
          </Fact>
          <Fact label="Path">{literalPath(version.source.path)}</Fact>
        </Summary>
      )
    case "Commit": {
      const { entry } = version
      return (
        <Summary title={entry.subject}>
          <Fact label="Commit">
            <Sha oid={entry.oid} onOpen={onOpenCommit} />
          </Fact>
          <Fact label="Author">
            {entry.author} <span className="text-muted-foreground">· {longDate(entry.time)}</span>
          </Fact>
          <Fact label="Path">{literalPath(entry.path)}</Fact>
          {entry.from !== null && (
            <Fact label={entry.change === "copied" ? "Copied from" : "Renamed from"}>{literalPath(entry.from)}</Fact>
          )}
        </Summary>
      )
    }
    case "BeforeDeletion": {
      const { entry } = version
      return (
        <Summary
          title={entry.subject}
          note="This commit deleted the file. You're viewing it as it was in the parent commit, just before the deletion."
        >
          <Fact label="Deleted in">
            <Sha oid={entry.oid} onOpen={onOpenCommit} />
          </Fact>
          <Fact label="Showing">
            <Sha oid={version.source.revision} onOpen={onOpenCommit} />
          </Fact>
          <Fact label="Author">
            {entry.author} <span className="text-muted-foreground">· {longDate(entry.time)}</span>
          </Fact>
          <Fact label="Path">{literalPath(entry.path)}</Fact>
        </Summary>
      )
    }
  }
}

function Summary({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="max-h-[40%] shrink-0 overflow-y-auto border-b px-3 py-2.5">
      <h3 className="font-medium break-words">{title}</h3>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 select-text">{children}</dl>
      {note !== undefined && <p className="mt-1.5 text-muted-foreground">{note}</p>}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-right text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </>
  )
}

function Sha({ oid, onOpen }: { oid: Oid; onOpen: (oid: Oid) => void }) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-2">
      <span className="font-mono select-all">{oid}</span>
      <span className="inline-flex items-center gap-1">
        <Button
          size="icon-xs"
          variant="ghost"
          className="text-muted-foreground"
          aria-label={`Copy SHA ${shortOid(oid)}`}
          title="Copy SHA"
          onClick={() => void copyWithToast(oid, "SHA copied")}
        >
          <CopyIcon />
        </Button>
        <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => onOpen(oid)}>
          Show commit
        </Button>
      </span>
    </span>
  )
}
