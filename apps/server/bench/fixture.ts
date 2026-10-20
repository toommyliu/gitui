import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import type { Oid, RepoId } from "@gitui/contracts"

export const cacheDir = process.env.GITUI_BENCH_CACHE ?? join(homedir(), ".cache", "gitui-bench")

const upstream = "https://github.com/git/git.git"
const pin = "v2.47.0"
const mirror = join(cacheDir, "git.git")
const template = join(cacheDir, `template-2-${pin}`)

export const isolateGitConfig = () => {
  mkdirSync(cacheDir, { recursive: true })
  const config = join(cacheDir, "gitconfig")
  if (!existsSync(config)) writeFileSync(config, "")
  process.env.GIT_CONFIG_GLOBAL = config
  process.env.GIT_CONFIG_NOSYSTEM = "1"
}

export const git = (cwd: string, args: ReadonlyArray<string>, input?: string) =>
  execFileSync("git", args, { cwd, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trimEnd()

const buildTemplate = () => {
  if (!existsSync(mirror)) git(cacheDir, ["clone", "--bare", "--quiet", upstream, mirror])
  const work = mkdtempSync(join(cacheDir, "template-tmp-"))
  git(cacheDir, ["clone", "--quiet", "--local", "--no-checkout", mirror, work])
  const run = (...args: Array<string>) => git(work, args)
  const kept = new Set(run("tag", "--merged", pin).split("\n"))
  const dropped = run("for-each-ref", "--format=%(refname)")
    .split("\n")
    .filter((ref) => !(ref.startsWith("refs/tags/") && kept.has(ref.slice("refs/tags/".length))))
  git(work, ["update-ref", "--no-deref", "--stdin"], dropped.map((ref) => `delete ${ref}\n`).join(""))
  run("update-ref", "refs/remotes/origin/master", `${pin}^{commit}`)
  run("update-ref", "refs/remotes/origin/maint", "v2.46.2^{commit}")
  run("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master")
  run("config", "user.name", "Bench")
  run("config", "user.email", "bench@example.com")
  run("config", "gc.auto", "0")
  run("config", "maintenance.auto", "false")
  run("checkout", "-q", "-B", "main", pin)
  run("branch", "-q", "-u", "origin/master", "main")
  for (let i = 1; i <= 10; i++) {
    const base = run("rev-parse", `${pin}~${i * 15}`)
    const tip = run("commit-tree", `${base}^{tree}`, "-p", base, "-m", `topic ${i}`)
    run("update-ref", `refs/heads/topic/${i}`, tip)
    run("branch", "-q", "-u", "origin/master", `topic/${i}`)
  }
  for (const tag of ["v2.30.0", "v2.35.0", "v2.38.0", "v2.40.0", "v2.42.0", "v2.44.0"]) {
    run("branch", "-q", `stale/${tag}`, tag)
    run("branch", "-q", "-u", "origin/master", `stale/${tag}`)
  }
  for (const n of [1, 2]) {
    appendFileSync(join(work, "README.md"), `stash ${n}\n`)
    run("stash", "push", "-q", "-m", `bench stash ${n}`)
  }
  appendFileSync(join(work, ".git", "info", "exclude"), "node_modules/\n")
  run("commit-graph", "write", "--reachable")
  try {
    renameSync(work, template)
  } catch (error) {
    rmSync(work, { recursive: true, force: true })
    if (!existsSync(template)) throw error
  }
}

const sleep = (ms: number) => {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export interface Fixture {
  readonly root: RepoId
  readonly git: (...args: Array<string>) => string
  readonly oid: (rev: string) => Oid
  readonly worktree: (name: string, branch: string, options: { readonly create: boolean }) => string
  readonly ballast: (dir: string) => void
  readonly dispose: () => void
}

export const makeFixture = (ballastFiles: number): Fixture => {
  if (!existsSync(template)) buildTemplate()
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gitui-bench-")))
  const root = join(dir, "repo")
  execFileSync("cp", process.platform === "darwin" ? ["-cR", template, root] : ["-R", "--reflink=auto", template, root])
  git(root, ["update-index", "-q", "--refresh"])
  const run = (...args: Array<string>) => git(root, args)
  const ballast = (target: string) => {
    for (let i = 0; i < ballastFiles; i++) {
      const folder = join(target, "node_modules", `pkg-${Math.floor(i / 1000)}`, `dir-${Math.floor(i / 50) % 20}`)
      if (i % 50 === 0) mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, `file-${i}.js`), `module.exports = ${i}\n`)
    }
  }
  return {
    root: root as RepoId,
    git: run,
    oid: (rev) => run("rev-parse", "--verify", rev) as Oid,
    worktree: (name, branch, { create }) => {
      const path = join(dir, name)
      const checkedOut = Date.now()
      run("worktree", "add", "-q", ...(create ? ["-b", branch, path, "HEAD"] : [path, branch]))
      ballast(path)
      sleep(checkedOut + 1100 - Date.now())
      git(path, ["update-index", "-q", "--refresh"])
      return path
    },
    ballast,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}
