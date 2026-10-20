import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { filterRepos, listDirectory } from "./directory.ts"

const fixture = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gitui-dir-")))
  mkdirSync(join(root, "zeta", ".git"), { recursive: true })
  mkdirSync(join(root, "alpha"))
  mkdirSync(join(root, ".hidden"))
  writeFileSync(join(root, "notes.txt"), "")
  mkdirSync(join(root, "worktree"))
  writeFileSync(join(root, "worktree", ".git"), "gitdir: elsewhere")
  symlinkSync(join(root, "zeta"), join(root, "linked"))
  symlinkSync(join(root, "missing"), join(root, "broken"))
  return root
}

describe("listDirectory", () => {
  it.effect("lists child folders by name, follows symlinks and marks repositories", () =>
    Effect.gen(function* () {
      const root = fixture()
      const listing = yield* listDirectory(`${root}/`)
      expect(listing).toEqual({
        path: root,
        isRepo: false,
        entries: [
          { name: ".hidden", path: join(root, ".hidden"), isRepo: false },
          { name: "alpha", path: join(root, "alpha"), isRepo: false },
          { name: "linked", path: join(root, "linked"), isRepo: true },
          { name: "worktree", path: join(root, "worktree"), isRepo: true },
          { name: "zeta", path: join(root, "zeta"), isRepo: true },
        ],
      })
    }),
  )

  it.effect("expands ~ to the home folder", () =>
    Effect.gen(function* () {
      expect((yield* listDirectory("~")).path).toBe(homedir())
    }),
  )

  it.effect("fails for relative and missing paths", () =>
    Effect.gen(function* () {
      const root = fixture()
      expect((yield* Effect.flip(listDirectory("projects")))._tag).toBe("DirectoryNotFound")
      expect((yield* Effect.flip(listDirectory(join(root, "nope"))))._tag).toBe("DirectoryNotFound")
      expect((yield* Effect.flip(listDirectory(join(root, "notes.txt"))))._tag).toBe("DirectoryNotFound")
    }),
  )
})

describe("filterRepos", () => {
  it("keeps only the paths that are still repositories, in order", () => {
    const root = fixture()
    const paths = ["zeta", "alpha", "gone", "worktree", "linked"].map((name) => join(root, name))
    expect(filterRepos(paths)).toEqual([join(root, "zeta"), join(root, "worktree"), join(root, "linked")])
  })
})
