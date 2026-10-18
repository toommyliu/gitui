import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

let tick = 0

export const fixtureEnv = () => {
  tick += 60
  const date = `${1_700_000_000 + tick} +0000`
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Ada",
    GIT_AUTHOR_EMAIL: "ada@example.com",
    GIT_COMMITTER_NAME: "Ada",
    GIT_COMMITTER_EMAIL: "ada@example.com",
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  }
}

export const makeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "gitui-"))
  const git = (...args: Array<string>) =>
    execFileSync("git", args, { cwd: root, env: fixtureEnv(), encoding: "utf8" }).trimEnd()
  const raw = (...args: Array<string>) => execFileSync("git", args, { cwd: root, env: fixtureEnv() })
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const commit = (message: string) => {
    git("commit", "-q", "--allow-empty", "-m", message)
    return git("rev-parse", "HEAD")
  }
  git("init", "-q", "-b", "main")
  return { root, git, raw, write, commit }
}
