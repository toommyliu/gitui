import { lstatSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { open, rename } from "node:fs/promises"
import { basename, join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import type { RepoId, RepoPath } from "@gitui/contracts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Fiber from "effect/Fiber"
import { afterEach, vi } from "vite-plus/test"
import { CommandLog } from "./command-log.ts"
import { Repo } from "./repo.ts"
import { makeRepo } from "./testRepo.ts"

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>()
  return { ...fs, open: vi.fn(fs.open), rename: vi.fn(fs.rename) }
})
const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
const denied = () => Object.assign(new Error("Access denied"), { code: "EACCES" })
const p = (path: string) => path as RepoPath
const id = (path: string) => path as RepoId
const fixture = () => {
  const f = makeRepo()
  f.write("dir/a", "base a\n")
  f.write("z", "base z\n")
  f.git("add", ".")
  f.commit("base")
  return f
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(open).mockReset().mockImplementation(real.open)
  vi.mocked(rename).mockReset().mockImplementation(real.rename)
})

layer(Repo.layer.pipe(Layer.provide(CommandLog.layer), Layer.provide(NodeServices.layer)))(
  "Discard recovery I/O",
  (it) => {
    it.effect(
      "discards, lists and restores when Windows disallows opening directories, while syncing backup files",
      () =>
        Effect.gen(function* () {
          const f = fixture()
          const r = yield* Repo
          f.write("z", "saved working edit\n")
          const backupSyncs: Array<string> = []
          vi.stubGlobal("process", { ...process, platform: "win32" })
          vi.mocked(open).mockImplementation(async (path, flags, mode) => {
            if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) throw denied()
            const handle = await real.open(path, flags, mode)
            if (String(path).endsWith(".tmp")) {
              const sync = handle.sync.bind(handle)
              vi.spyOn(handle, "sync").mockImplementation(async () => {
                await sync()
                backupSyncs.push(String(path))
              })
            }
            return handle
          })
          const backup = yield* r.discard(id(f.root), [p("z")])
          expect(backupSyncs.length).toBeGreaterThan(0)
          expect(readFileSync(join(f.root, "z"), "utf8")).toBe("base z\n")
          expect((yield* r.discardRecovery(id(f.root))).map((entry) => entry.id)).toEqual([backup!.id])
          yield* r.restoreDiscard(id(f.root), backup!.id, null)
          expect(readFileSync(join(f.root, "z"), "utf8")).toBe("saved working edit\n")
        }),
    )

    it.effect("restores later paths when an already-missing path has no parent folder", () =>
      Effect.gen(function* () {
        const f = fixture()
        const r = yield* Repo
        rmSync(join(f.root, "dir"), { recursive: true })
        f.write("z", "saved working edit\n")
        const index = f.raw("ls-files", "--stage", "-z")
        const backup = yield* r.discard(id(f.root), [p("dir/a"), p("z")])
        rmSync(join(f.root, "dir"), { recursive: true })
        const conflict = yield* r.restoreDiscard(id(f.root), backup!.id, null)
        expect(conflict._tag).toBe("Conflict")
        if (conflict._tag !== "Conflict") return yield* Effect.die("Expected changed folder conflict")
        expect(yield* r.restoreDiscard(id(f.root), backup!.id, conflict.version)).toEqual({ _tag: "Restored" })
        expect(lstatSync(join(f.root, "dir"), { throwIfNoEntry: false })).toBeUndefined()
        expect(readFileSync(join(f.root, "z"), "utf8")).toBe("saved working edit\n")
        expect(f.raw("ls-files", "--stage", "-z")).toEqual(index)
      }),
    )

    it.effect("keeps a cancelled restore locked until its filesystem writes settle", () =>
      Effect.gen(function* () {
        const f = fixture()
        const r = yield* Repo
        f.write("z", "discarded original\n")
        const backup = yield* r.discard(id(f.root), [p("z")])
        let pause = () => {}
        let release = () => {}
        const paused = new Promise<void>((resolve) => {
          pause = resolve
        })
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        vi.mocked(rename).mockImplementation(async (from, to) => {
          if (basename(String(from)).startsWith(".gitui-restore-")) {
            pause()
            await gate
          }
          await real.rename(from, to)
        })
        const restoring = yield* Effect.forkChild(r.restoreDiscard(id(f.root), backup!.id, null))
        yield* Effect.promise(() => paused)
        let cancelled = false
        const cancellation = yield* Effect.forkChild(
          Fiber.interrupt(restoring).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                cancelled = true
              }),
            ),
          ),
          { startImmediately: true },
        )
        const cancelledBeforeWritesSettled = cancelled
        const staging = yield* Effect.forkChild(r.stage(id(f.root), [p("z")]), { startImmediately: true })
        release()
        yield* Fiber.join(cancellation)
        yield* Fiber.join(staging)
        expect(cancelledBeforeWritesSettled).toBe(false)
        expect(f.git("show", ":z")).toBe("discarded original")
        f.write("z", "newer after cancel\n")
        expect(readFileSync(join(f.root, "z"), "utf8")).toBe("newer after cancel\n")
      }),
    )

    for (const phase of ["write", "sync", "rename"] as const) {
      it.effect(`cleans up temporary contents after a restore ${phase} failure and permits retry`, () =>
        Effect.gen(function* () {
          const f = fixture()
          const r = yield* Repo
          f.write("z", "saved working edit\n")
          const backup = yield* r.discard(id(f.root), [p("z")])
          vi.mocked(open).mockImplementation(async (path, flags, mode) => {
            const handle = await real.open(path, flags, mode)
            if (basename(String(path)).startsWith(".gitui-restore-")) {
              if (phase === "write") vi.spyOn(handle, "writeFile").mockRejectedValue(denied())
              if (phase === "sync") vi.spyOn(handle, "sync").mockRejectedValue(denied())
            }
            return handle
          })
          vi.mocked(rename).mockImplementation(async (from, to) => {
            if (phase === "rename" && basename(String(from)).startsWith(".gitui-restore-")) throw denied()
            await real.rename(from, to)
          })
          expect((yield* Effect.result(r.restoreDiscard(id(f.root), backup!.id, null)))._tag).toBe("Failure")
          expect(readdirSync(f.root).filter((name) => name.startsWith(".gitui-restore-"))).toEqual([])
          expect(readFileSync(join(f.root, "z"), "utf8")).toBe("base z\n")
          vi.mocked(open).mockImplementation(real.open)
          vi.mocked(rename).mockImplementation(real.rename)
          yield* r.restoreDiscard(id(f.root), backup!.id, null)
          expect(readFileSync(join(f.root, "z"), "utf8")).toBe("saved working edit\n")
        }),
      )
    }

    it.effect("lists surviving backups if retention removes a file during the read, but reports other I/O errors", () =>
      Effect.gen(function* () {
        const f = fixture()
        const r = yield* Repo
        f.write("z", "first edit\n")
        const older = yield* r.discard(id(f.root), [p("z")])
        f.write("z", "second edit\n")
        const newer = yield* r.discard(id(f.root), [p("z")])
        vi.mocked(open).mockImplementation(async (path, flags, mode) => {
          if (String(path).endsWith(`${older!.id}.json`)) await real.unlink(path)
          return real.open(path, flags, mode)
        })
        expect((yield* r.discardRecovery(id(f.root))).map((entry) => entry.id)).toEqual([newer!.id])
        vi.mocked(open).mockImplementation(async (path, flags, mode) => {
          if (String(path).endsWith(`${newer!.id}.json`)) throw denied()
          return real.open(path, flags, mode)
        })
        expect((yield* Effect.result(r.discardRecovery(id(f.root))))._tag).toBe("Failure")
        expect(readFileSync(join(f.root, "z"), "utf8")).toBe("base z\n")
      }),
    )
  },
)
