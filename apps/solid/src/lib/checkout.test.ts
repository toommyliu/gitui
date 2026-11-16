import { GitError } from "@gitui/contracts"
import { describe, expect, it } from "vite-plus/test"
import { localChangesBlock } from "./checkout"

const failure = (stderr: string) => new GitError({ args: ["checkout", "feature"], exitCode: 1, stderr })

describe("localChangesBlock", () => {
  it("recognizes tracked changes that block a checkout", () => {
    expect(
      localChangesBlock(
        failure("error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\n"),
      ),
    ).toEqual({ includeUntracked: false })
  })

  it("asks to include untracked files when they are in the way", () => {
    expect(
      localChangesBlock(
        failure("error: The following untracked working tree files would be overwritten by checkout:\n\tb.txt\n"),
      ),
    ).toEqual({ includeUntracked: true })
  })

  it("ignores other failures", () => {
    expect(localChangesBlock(failure("fatal: invalid reference: nope"))).toBeNull()
    expect(localChangesBlock(new Error("would be overwritten by checkout:"))).toBeNull()
  })
})
