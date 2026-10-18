import { execFileSync } from "node:child_process"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
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
  return repo
}

const running = (pattern: string) => {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).trim() !== ""
  } catch {
    return false
  }
}

layer(Repo.layer.pipe(Layer.provideMerge(CommandLog.layer), Layer.provide(NodeServices.layer)))(
  "Repo network operations",
  (it) => {
    it.effect("streams push progress up to the finished write", () =>
      Effect.gen(function* () {
        const repo = withRemote()
        repo.write("b.txt", "b\n")
        repo.git("add", ".")
        repo.commit("more")
        const updates = yield* Stream.runCollect((yield* Repo).push(id(repo.root)))
        const writing = updates.filter((update) => update.line.startsWith("Writing objects:"))
        expect(writing.at(-1)?.percent).toBe(100)
      }),
    )

    it.effect("kills a cancelled fetch and logs it as cancelled", () =>
      Effect.gen(function* () {
        const repo = withRemote()
        const marker = `gitui-slow-${Date.now()}`
        const script = join(mkdtempSync(join(tmpdir(), "gitui-")), marker)
        writeFileSync(script, '#!/bin/sh\nsleep 30\nexec git-upload-pack "$@"\n')
        chmodSync(script, 0o755)
        repo.git("config", "remote.origin.uploadpack", script)

        const r = yield* Repo
        yield* TestClock.withLive(
          Stream.runDrain(r.fetch(id(repo.root))).pipe(Effect.timeout("500 millis"), Effect.ignore),
        )
        expect(running(marker)).toBe(false)

        const [entries = []] = yield* (yield* CommandLog).entries.pipe(Stream.take(1), Stream.runCollect)
        const fetch = entries.findLast((entry) => entry.cwd === repo.root && entry.args.includes("fetch"))
        expect(fetch?.outcome).toEqual({ _tag: "Cancelled" })
      }),
    )

    it.effect("runs concurrent changes to one repository one at a time", () =>
      Effect.gen(function* () {
        const repo = makeRepo()
        repo.commit("base")
        const files = Array.from({ length: 16 }, (_, i) => `f${i}.txt`)
        for (const file of files) repo.write(file, "x\n")
        const r = yield* Repo

        yield* Effect.forEach(files, (file) => r.stage(id(repo.root), [file as RepoPath]), {
          concurrency: "unbounded",
        })
        expect(repo.git("diff", "--cached", "--name-only").split("\n").sort()).toEqual([...files].sort())
      }),
    )
  },
)
