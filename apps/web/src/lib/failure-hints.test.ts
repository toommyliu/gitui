import { describe, expect, it } from "vite-plus/test"
import { authAdvice, failureHint } from "./failure-hints"

describe("failure hints", () => {
  it.each([
    ["Author identity unknown\n\n*** Please tell me who you are.", "identity"],
    ["fatal: empty ident name (for <ada@example.com>) not allowed", "identity"],
    ["error: gpg failed to sign the data\nfatal: failed to write commit object", "signing"],
    ["error: Couldn't load public key /Users/ada/.ssh/missing.pub: No such file or directory?", "signing"],
    [
      "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/a/b.git/'",
      "http-auth",
    ],
    ["git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.", "ssh-auth"],
    ["error: pathspec 'x' did not match any file(s) known to git", null],
  ] as const)("classifies %j as %s", (stderr, hint) => {
    expect(failureHint(stderr)).toBe(hint)
  })

  it("offers auth advice only for sign-in failures", () => {
    expect(authAdvice("git@github.com: Permission denied (publickey).")).toContain("ssh-add -l")
    expect(authAdvice("error: gpg failed to sign the data")).toBeNull()
  })
})
