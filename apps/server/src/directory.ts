import { existsSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { DirectoryNotFound } from "@gitui/contracts"
import * as Effect from "effect/Effect"

const isRepo = (dir: string) => existsSync(join(dir, ".git"))

export const filterRepos = (paths: ReadonlyArray<string>) => paths.filter(isRepo)

const isDirectory = (path: string) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true

export const listDirectory = (requested: string) => {
  const expanded = requested === "~" || requested.startsWith("~/") ? homedir() + requested.slice(1) : requested
  if (!isAbsolute(expanded)) return Effect.fail(new DirectoryNotFound({ path: requested }))
  const path = resolve(expanded)
  return Effect.try({
    try: () => ({
      path,
      isRepo: isRepo(path),
      entries: readdirSync(path, { withFileTypes: true })
        .map((entry) => ({ entry, full: join(path, entry.name) }))
        .filter(({ entry, full }) => entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(full)))
        .map(({ entry, full }) => ({ name: entry.name, path: full, isRepo: isRepo(full) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }),
    catch: () => new DirectoryNotFound({ path: requested }),
  })
}
