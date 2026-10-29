import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeSocket } from "@effect/platform-node"
import { expect, layer } from "@effect/vitest"
import { GitRpcs, RepoPath, type CredentialPrompt } from "@gitui/contracts"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import * as HttpServer from "effect/http/HttpServer"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import { makeRepo } from "../../../packages/git/src/testRepo.ts"
import { serverLayer } from "./server.ts"
import { filterFiles } from "../../web/src/lib/change-search.ts"

const clientEffect = Effect.gen(function* () {
  const { address } = yield* HttpServer.HttpServer
  if (address._tag === "UnixPathAddress") return yield* Effect.die("Expected TCP")
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket().pipe(
      Layer.provide([NodeSocket.layerWebSocket(`ws://127.0.0.1:${address.port}/rpc`), RpcSerialization.layerJson]),
    ),
  )
  return yield* RpcClient.make(GitRpcs).pipe(Effect.provide(protocol))
})
const fixtureEffect = Effect.acquireRelease(Effect.sync(makeRepo), (fixture) =>
  Effect.sync(() => rmSync(fixture.root, { recursive: true, force: true })),
)
const hook = (root: string, source: string) => {
  const path = join(root, ".git/hooks/pre-commit")
  writeFileSync(path, `#!/bin/sh\n${source}\n`)
  chmodSync(path, 0o700)
}

layer(serverLayer({ host: "127.0.0.1", port: 0, webDist: null, trustedOrigins: [] }))("Commit workflow RPC", (it) => {
  it.effect("commits hidden staged files while limiting matching-file stage actions", () =>
    Effect.gen(function* () {
      const c = yield* clientEffect
      const f = yield* fixtureEffect
      f.commit("Base")
      f.write("hidden.txt", "already staged\n")
      f.git("add", "hidden.txt")
      f.write("visible.txt", "stage this match\n")
      f.write("unrelated.txt", "leave unstaged\n")
      const { id: repo } = yield* c.OpenRepo({ path: f.root })
      const matching = filterFiles((yield* c.GetStatus({ repo })).entries, "visible")
      yield* c.Stage({ repo, paths: matching.map((file) => file.path) })
      expect(f.git("diff", "--cached", "--name-only").split("\n")).toEqual(["hidden.txt", "visible.txt"])
      const updates = yield* Stream.runCollect(c.Commit({ repo, message: "Commit every staged file", amend: false }))
      expect(updates.at(-1)).toEqual({ _tag: "Committed", oid: f.git("rev-parse", "HEAD") })
      expect(f.git("ls-tree", "-r", "--name-only", "HEAD").split("\n")).toEqual(["hidden.txt", "visible.txt"])
      expect((yield* c.GetFileRevision({ repo, revision: "HEAD", path: RepoPath.make("hidden.txt") })).content).toEqual(
        {
          _tag: "Text",
          content: "already staged\n",
        },
      )
      expect(f.git("status", "--porcelain")).toBe("?? unrelated.txt")
    }).pipe(Effect.scoped),
  )

  it.effect("commits partially staged new files without consuming a selected-file stash", () =>
    Effect.gen(function* () {
      const c = yield* clientEffect
      const fixture = yield* fixtureEffect
      fixture.write("notes.txt", "before\n")
      fixture.git("add", "notes.txt")
      fixture.commit("Base")
      const { id: repo } = yield* c.OpenRepo({ path: fixture.root })
      const path = RepoPath.make("new.txt")
      fixture.write(path, "first\nsecond\n")
      fixture.write("notes.txt", "after\n")
      fixture.write("unrelated.txt", "leave this alone\n")
      yield* c.ApplyLines({ repo, action: "stage", path, lines: [{ side: "new", line: 1, text: "first" }] })
      yield* c.StashPush({
        repo,
        message: "Park notes",
        includeUntracked: false,
        paths: [RepoPath.make("notes.txt")],
        keepIndex: true,
      })
      const stash = (yield* c.GetRefs({ repo })).stashes[0]!
      expect(readFileSync(join(fixture.root, path), "utf8")).toBe("first\nsecond\n")
      expect(readFileSync(join(fixture.root, "notes.txt"), "utf8")).toBe("before\n")
      const updates = yield* Stream.runCollect(c.Commit({ repo, message: "Only the first line", amend: false }))
      expect(updates.at(-1)).toEqual({ _tag: "Committed", oid: fixture.git("rev-parse", "HEAD") })
      expect(fixture.git("show", "HEAD:new.txt")).toBe("first")
      yield* c.StashApply({ repo, oid: stash.oid, drop: false })
      expect(readFileSync(join(fixture.root, path), "utf8")).toBe("first\nsecond\n")
      expect(readFileSync(join(fixture.root, "notes.txt"), "utf8")).toBe("after\n")
      expect(readFileSync(join(fixture.root, "unrelated.txt"), "utf8")).toBe("leave this alone\n")
      expect(fixture.git("diff", "--cached", "--name-only")).toBe("")
    }).pipe(Effect.scoped),
  )

  it.effect("keeps identity local, reads inherited config, and streams hooks and a real commit result", () =>
    Effect.gen(function* () {
      const c = yield* clientEffect
      const fixture = yield* fixtureEffect
      const { id: repo } = yield* c.OpenRepo({ path: fixture.root })
      const included = join(fixture.root, "identity.config")
      writeFileSync(
        included,
        "[user]\n name = Inherited Ada\n email = inherited@example.test\n[commit]\n gpgsign = false\n",
      )
      fixture.git("config", "--unset-all", "user.name")
      fixture.git("config", "--unset-all", "user.email")
      fixture.git("config", "include.path", included)
      const inherited = yield* c.GetCommitIdentity({ repo })
      expect(inherited.name).toBe("Inherited Ada")
      expect(inherited.email).toBe("inherited@example.test")
      expect(inherited.local.name).toBeNull()
      const original = readFileSync(included, "utf8")
      yield* c.SetCommitIdentity({
        repo,
        settings: {
          name: "Local Ada",
          email: "local@example.test",
          signing: false,
          signingKey: null,
          signingFormat: null,
        },
      })
      expect((yield* c.GetCommitIdentity({ repo })).name).toBe("Local Ada")
      fixture.write("file.txt", "one\n")
      fixture.git("add", "file.txt")
      hook(fixture.root, "echo 'Checking staged files'; echo 'Hook stderr is live' >&2")
      yield* c.SetDraft({ repo, message: "keep until success" })
      const updates = yield* Stream.runCollect(c.Commit({ repo, message: "Create a real commit", amend: false }))
      expect(
        updates
          .filter((u) => u._tag === "Output")
          .map((u) => u.text)
          .join("\n"),
      ).toContain("Hook stderr is live")
      expect(updates.at(-1)).toEqual({ _tag: "Committed", oid: fixture.git("rev-parse", "HEAD") })
      expect(fixture.git("log", "-1", "--format=%an <%ae>|%s")).toBe(
        "Local Ada <local@example.test>|Create a real commit",
      )
      expect(yield* c.GetDraft({ repo })).toBe("")
      yield* c.SetCommitIdentity({
        repo,
        settings: { name: null, email: null, signing: null, signingKey: null, signingFormat: null },
      })
      expect((yield* c.GetCommitIdentity({ repo })).name).toBe("Inherited Ada")
      expect(readFileSync(included, "utf8")).toBe(original)
    }).pipe(Effect.scoped),
  )

  it.effect("redacts prompt answers from output and logs, rejects cross-repo answers, and recovers from cancel", () =>
    Effect.gen(function* () {
      const c = yield* clientEffect
      const fixture = yield* fixtureEffect
      const other = yield* fixtureEffect
      const { id: repo } = yield* c.OpenRepo({ path: fixture.root })
      const { id: otherRepo } = yield* c.OpenRepo({ path: other.root })
      fixture.write("file.txt", "staged\n")
      fixture.git("add", "file.txt")
      fixture.git("config", "commit.gpgsign", "false")
      hook(
        fixture.root,
        `answer=$("$GIT_ASKPASS" 'Password for fake local helper:') || exit 1\nprintf '%s' "$answer"\nsleep 0.05\nprintf '\\n'\necho "$answer" >&2`,
      )
      const ready = yield* Deferred.make<void>()
      const next = yield* Deferred.make<CredentialPrompt>()
      const listener = yield* Effect.forkScoped(
        Stream.runForEach(c.CredentialPrompts({ repo }), (prompts) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(ready, undefined)
            if (prompts[0]) yield* Deferred.succeed(next, prompts[0])
          }),
        ),
      )
      yield* Deferred.await(ready)
      const committing = yield* Effect.forkScoped(
        Stream.runCollect(c.Commit({ repo, message: "With fake authentication", amend: false })),
      )
      const prompt = yield* Deferred.await(next)
      expect(prompt.secret).toBe(true)
      expect(
        yield* c.AnswerCredentialPrompt({ repo: otherRepo, id: prompt.id, answer: Redacted.make("wrong-repo") }),
      ).toBe(false)
      const fakeAnswer = "  fake-value-for-secrecy-test  "
      expect(yield* c.AnswerCredentialPrompt({ repo, id: prompt.id, answer: Redacted.make(fakeAnswer) })).toBe(true)
      const updates = yield* Fiber.join(committing)
      expect(JSON.stringify(updates)).not.toContain(fakeAnswer.trim())
      expect(JSON.stringify(updates)).toContain("[redacted]")
      const logs = Option.getOrThrow(yield* Stream.runHead(c.CommandLog({ repo })))
      expect(JSON.stringify(logs)).not.toContain(fakeAnswer.trim())
      expect(yield* c.AnswerCredentialPrompt({ repo, id: prompt.id, answer: null })).toBe(false)
      yield* Fiber.interrupt(listener)
      fixture.write("file.txt", "second\n")
      fixture.git("add", "file.txt")
      yield* c.SetDraft({ repo, message: "Retained after cancellation" })
      const cancellation = yield* Effect.forkScoped(
        Stream.runForEach(c.CredentialPrompts({ repo }), (prompts) =>
          Effect.forEach(prompts, (p) => c.AnswerCredentialPrompt({ repo, id: p.id, answer: null })),
        ),
      )
      hook(fixture.root, '"$GIT_ASKPASS" "Password for fake local helper:"; sleep 1; touch should-not-exist')
      const before = fixture.git("rev-parse", "HEAD")
      const result = yield* Effect.result(Stream.runDrain(c.Commit({ repo, message: "Cancelled", amend: false })))
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure" && result.failure._tag === "GitError")
        expect(result.failure.stderr).toContain("Authentication cancelled")
      expect(fixture.git("rev-parse", "HEAD")).toBe(before)
      expect(existsSync(join(fixture.root, "should-not-exist"))).toBe(false)
      expect(yield* c.GetDraft({ repo })).toBe("Retained after cancellation")
      yield* Fiber.interrupt(cancellation)
    }).pipe(Effect.scoped),
  )

  it.effect("preserves drafts on hook/signing failure and uses the configured signing program", () =>
    Effect.gen(function* () {
      const c = yield* clientEffect
      const fixture = yield* fixtureEffect
      const { id: repo } = yield* c.OpenRepo({ path: fixture.root })
      fixture.write("file.txt", "staged\n")
      fixture.git("add", "file.txt")
      fixture.git("config", "commit.gpgsign", "false")
      hook(fixture.root, "echo 'Hook blocked this commit' >&2; exit 7")
      yield* c.SetDraft({ repo, message: "Recoverable draft" })
      const hookError = yield* Effect.flip(Stream.runDrain(c.Commit({ repo, message: "Hook failure", amend: false })))
      expect(hookError._tag).toBe("GitError")
      if (hookError._tag === "GitError") expect(hookError.stderr).toContain("Hook blocked this commit")
      hook(fixture.root, "exit 0")
      const signer = join(fixture.root, "fake-signer")
      writeFileSync(signer, "#!/bin/sh\necho 'Configured signer unavailable. Unlock your signing key.' >&2\nexit 1\n")
      chmodSync(signer, 0o700)
      fixture.git("config", "gpg.program", signer)
      yield* c.SetCommitIdentity({
        repo,
        settings: {
          name: "Ada",
          email: "ada@example.test",
          signing: true,
          signingKey: "FAKE-KEY-ID",
          signingFormat: "openpgp",
        },
      })
      const identity = yield* c.GetCommitIdentity({ repo })
      expect(identity.signing).toBe(true)
      expect(identity.signingProgram).toBe(signer)
      const signError = yield* Effect.flip(
        Stream.runDrain(c.Commit({ repo, message: "Signing failure", amend: false })),
      )
      if (signError._tag === "GitError") expect(signError.stderr).toContain("Configured signer unavailable")
      else expect.fail("Expected a Git signing error")
      expect(yield* c.GetDraft({ repo })).toBe("Recoverable draft")
    }).pipe(Effect.scoped),
  )
  it.effect("uses a configured fake signer and retains author/message behavior when amending", () =>
    Effect.gen(function* () {
      const c = yield* clientEffect
      const fixture = yield* fixtureEffect
      fixture.write("file.txt", "original\n")
      fixture.git("add", "file.txt")
      const original = fixture.commit("Original author")
      const { id: repo } = yield* c.OpenRepo({ path: fixture.root })
      const signer = join(fixture.root, "fake-successful-signer")
      writeFileSync(
        signer,
        "#!/bin/sh\ncat >/dev/null\nprintf '[GNUPG:] SIG_CREATED D 1 10 00 0 FAKE\\n' >&2\nprintf '%s\\n' '-----BEGIN PGP SIGNATURE-----' 'fake-test-signature' '-----END PGP SIGNATURE-----'\n",
      )
      chmodSync(signer, 0o700)
      fixture.git("config", "gpg.program", signer)
      yield* c.SetCommitIdentity({
        repo,
        settings: {
          name: "New Committer",
          email: "new@example.test",
          signing: true,
          signingKey: "FAKE",
          signingFormat: "openpgp",
        },
      })
      yield* c.SetDraft({ repo, message: "Keep ordinary draft during amend" })
      const updates = yield* Stream.runCollect(c.Commit({ repo, message: "Amended with fake signer", amend: true }))
      expect(updates.at(-1)).toEqual({ _tag: "Committed", oid: fixture.git("rev-parse", "HEAD") })
      expect(fixture.git("rev-parse", "HEAD")).not.toBe(original)
      expect(fixture.git("cat-file", "commit", "HEAD")).toContain("gpgsig -----BEGIN PGP SIGNATURE-----")
      expect(fixture.git("log", "-1", "--format=%an <%ae>|%cn <%ce>|%s")).toBe(
        "Ada <ada@example.com>|New Committer <new@example.test>|Amended with fake signer",
      )
      expect(yield* c.GetDraft({ repo })).toBe("Keep ordinary draft during amend")
    }).pipe(Effect.scoped),
  )
  it.effect(
    "interrupts only this commit's process tree before the hook can mutate files",
    () =>
      Effect.gen(function* () {
        const c = yield* clientEffect
        const fixture = yield* fixtureEffect
        const { id: repo } = yield* c.OpenRepo({ path: fixture.root })
        fixture.write("file.txt", "staged\n")
        fixture.git("add", "file.txt")
        fixture.git("config", "commit.gpgsign", "false")
        hook(fixture.root, "echo 'Hook started'; sleep 1; touch hook-finished")
        yield* c.SetDraft({ repo, message: "Keep cancelled draft" })

        const updates = yield* Stream.runCollect(
          c.Commit({ repo, message: "Interrupted", amend: false }).pipe(Stream.take(1)),
        )

        expect(updates).toEqual([{ _tag: "Output", text: "Hook started" }])
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1300)))
        expect(existsSync(join(fixture.root, "hook-finished"))).toBe(false)
        expect(existsSync(join(fixture.root, ".git/index.lock"))).toBe(false)
        expect(yield* c.GetDraft({ repo })).toBe("Keep cancelled draft")
        hook(fixture.root, "echo 'Retry works'")

        const retry = yield* Stream.runCollect(c.Commit({ repo, message: "Retry", amend: false }))

        expect(retry.at(-1)).toEqual({ _tag: "Committed", oid: fixture.git("rev-parse", "HEAD") })
      }).pipe(Effect.scoped),
    { timeout: 15000 },
  )
  it.effect("streams noisy hook output while bounding failure diagnostics", () =>
    Effect.gen(function* () {
      const c = yield* clientEffect
      const fixture = yield* fixtureEffect
      const { id: repo } = yield* c.OpenRepo({ path: fixture.root })
      fixture.write("file.txt", "staged\n")
      fixture.git("add", "file.txt")
      fixture.git("config", "commit.gpgsign", "false")
      hook(
        fixture.root,
        `awk 'BEGIN { for (i = 0; i < 2000; i++) print "stdout hook " i }'
awk 'BEGIN { for (i = 0; i < 2000; i++) print "stderr hook " i }' >&2
echo 'fatal: Final hook failure' >&2
exit 1`,
      )
      let stdoutLines = 0
      const error = yield* Effect.flip(
        Stream.runForEach(c.Commit({ repo, message: "Noisy hook", amend: false }), (update) =>
          Effect.sync(() => {
            if (update._tag === "Output" && update.text.startsWith("stdout hook ")) stdoutLines++
          }),
        ),
      )
      expect(stdoutLines).toBe(2000)
      if (error._tag !== "GitError") return yield* Effect.die("Expected GitError")
      expect(error.stderr.length).toBeLessThanOrEqual(8192)
      expect(error.stderr).toContain("fatal: Final hook failure")
      expect(error.stderr).not.toContain("stderr hook 0\n")
    }).pipe(Effect.scoped),
  )
  it.effect("can have a completed commit when interrupted during a post-commit hook", () =>
    Effect.gen(function* () {
      const c = yield* clientEffect
      const fixture = yield* fixtureEffect
      const { id: repo } = yield* c.OpenRepo({ path: fixture.root })
      fixture.write("file.txt", "staged\n")
      fixture.git("add", "file.txt")
      fixture.git("config", "commit.gpgsign", "false")
      const postCommit = join(fixture.root, ".git/hooks/post-commit")
      writeFileSync(postCommit, "#!/bin/sh\necho post-commit-started\nsleep 5\ntouch post-hook-finished\n")
      chmodSync(postCommit, 0o700)
      yield* c.SetDraft({ repo, message: "Keep uncertain draft" })
      const output = yield* Stream.runCollect(
        c.Commit({ repo, message: "Commit before hook cancellation", amend: false }).pipe(Stream.take(1)),
      )
      expect(output).toEqual([{ _tag: "Output", text: "post-commit-started" }])
      expect(fixture.git("log", "-1", "--format=%s")).toBe("Commit before hook cancellation")
      expect(existsSync(join(fixture.root, "post-hook-finished"))).toBe(false)
      expect(yield* c.GetDraft({ repo })).toBe("Keep uncertain draft")
      expect((yield* c.GetStatus({ repo })).entries).toEqual([])
    }).pipe(Effect.scoped),
  )
  it.effect("redacts overlapping username and token answers from output, errors, and history", () =>
    Effect.gen(function* () {
      const c = yield* clientEffect
      const fixture = yield* fixtureEffect
      const { id: repo } = yield* c.OpenRepo({ path: fixture.root })
      fixture.write("file.txt", "staged\n")
      fixture.git("add", "file.txt")
      fixture.git("config", "commit.gpgsign", "false")
      hook(
        fixture.root,
        `username=$("$GIT_ASKPASS" 'Username for fake helper:') || exit 1
token=$("$GIT_ASKPASS" 'Password for fake helper:') || exit 1
echo "$token"
echo "fatal: $token" >&2
exit 1`,
      )
      const ready = yield* Deferred.make<void>()
      const answers: Array<boolean> = []
      const listener = yield* Effect.forkScoped(
        Stream.runForEach(c.CredentialPrompts({ repo }), (prompts) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(ready, undefined)
            for (const prompt of prompts) {
              answers.push(prompt.secret)
              yield* c.AnswerCredentialPrompt({
                repo,
                id: prompt.id,
                answer: Redacted.make(prompt.secret ? "github_pat_PRIVATE_FAKE_TOKEN" : "git"),
              })
            }
          }),
        ),
      )
      yield* Deferred.await(ready)
      const output: Array<string> = []
      const error = yield* Effect.flip(
        Stream.runForEach(c.Commit({ repo, message: "Overlapping fake answers", amend: false }), (update) =>
          Effect.sync(() => {
            if (update._tag === "Output") output.push(update.text)
          }),
        ),
      )
      if (error._tag !== "GitError") return yield* Effect.die("Expected GitError")
      const history = Option.getOrThrow(yield* Stream.runHead(c.CommandLog({ repo })))
      expect(answers).toEqual([false, true])
      for (const exposed of [output.join("\n"), error.stderr, JSON.stringify(history)]) {
        expect(exposed).toContain("[redacted]")
        expect(exposed).not.toContain("PRIVATE_FAKE_TOKEN")
      }
      yield* Fiber.interrupt(listener)
    }).pipe(Effect.scoped),
  )
})
