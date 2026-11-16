import { describe, expect, it } from "vite-plus/test"
import { splitMentions } from "./commit-mentions"

const hashes = (text: string) => splitMentions(text).flatMap((part) => (part.kind === "hash" ? [part.text] : []))

describe("splitMentions", () => {
  it("finds short and full hashes in a sentence", () => {
    expect(hashes("This reverts commit 4137bed2f1c0a9e8d7b6a5f4e3d2c1b0a9f8e7d6.")).toEqual([
      "4137bed2f1c0a9e8d7b6a5f4e3d2c1b0a9f8e7d6",
    ])
    expect(hashes("error: could not apply 494bd95... fix(web): remove worktrees")).toEqual(["494bd95"])
  })

  it("finds both ends of a range", () => {
    expect(hashes("compare a44d5ae..ffa5e8f")).toEqual(["a44d5ae", "ffa5e8f"])
  })

  it("keeps the surrounding text intact", () => {
    const text = "(cherry picked from commit 167548f)"
    expect(
      splitMentions(text)
        .map((part) => part.text)
        .join(""),
    ).toBe(text)
  })

  it("keeps hashes made only of digits", () => {
    expect(hashes("The regression came from 3762203.")).toEqual(["3762203"])
  })

  it("ignores words, uuids and paths", () => {
    expect(hashes("the facade was defaced")).toEqual([])
    expect(hashes("id 3f2a9c1e-77b4-4c2d-9e1f-0a1b2c3d4e5f")).toEqual([])
    expect(hashes("see github.com/org/repo/commit/494bd95")).toEqual([])
    expect(hashes("ABC1234DEF")).toEqual([])
  })
})
