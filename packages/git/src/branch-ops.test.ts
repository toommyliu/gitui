import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { RepoId } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

const id = (root: string) => root as RepoId

const withRemote = () => {
  const repo = makeRepo()
  repo.write("a.txt", "a\n")
  repo.git("add", ".")
  repo.commit("base")
  const remote = mkdtempSync(join(tmpdir(), "gitui-remote-"))
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote])
  repo.git("remote", "add", "origin", remote)
  repo.git("push", "-q", "-u", "origin", "main")
  return { repo, remote }
}

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))("Repo push", (it) => {
  it.effect("pushes a new branch and sets its upstream", () =>
    Effect.gen(function* () {
      const { repo, remote } = withRemote()
      repo.git("switch", "-q", "-c", "feature")
      const tip = repo.commit("feature work")
      yield* (yield* Repo).push(id(repo.root))
      expect(repo.git("rev-parse", "--abbrev-ref", "feature@{upstream}")).toBe("origin/feature")
      expect(execFileSync("git", ["--git-dir", remote, "rev-parse", "feature"], { encoding: "utf8" }).trim()).toBe(tip)
    }),
  )
})
