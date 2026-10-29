import { type RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import { fileBlame } from "./file-blame.ts"
import { fileHistory } from "./file-history.ts"
import { makeFileRestore } from "./file-restore.ts"
import { decodeFileOutput, fileRevision } from "./file-tree.ts"
import type { Git } from "./git.ts"

export const makeFileInvestigation = (git: Git["Service"]) => ({
  trackedFiles: (repo: RepoId) =>
    git.run(repo, ["ls-files", "-z"]).pipe(
      Effect.flatMap(decodeFileOutput),
      Effect.map((raw) =>
        [...new Set(raw.split("\0").filter((path) => path !== ""))].map((path) => RepoPath.make(path)),
      ),
    ),
  fileHistory: (repo: RepoId, revision: string, path: RepoPath) => fileHistory(git, repo, revision, path),
  fileRevision: (repo: RepoId, revision: string, path: RepoPath) => fileRevision(git, repo, revision, path),
  fileBlame: (repo: RepoId, revision: string, path: RepoPath) => fileBlame(git, repo, revision, path),
  ...makeFileRestore(git),
})
