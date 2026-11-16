import { describe, expect, it } from "vite-plus/test"
import { splitCoAuthors } from "./trailers"

const author = { name: "Ada", email: "ada@example.com" }

describe("splitCoAuthors", () => {
  it("takes co-author trailers out of the message", () => {
    const result = splitCoAuthors(
      "Fix the parser\n\nHandles empty input.\n\nCo-authored-by: Grace <grace@example.com>\nco-authored-by: Linus <linus@example.com>",
      author,
    )
    expect(result.message).toBe("Fix the parser\n\nHandles empty input.")
    expect(result.coAuthors).toEqual([
      { name: "Grace", email: "grace@example.com" },
      { name: "Linus", email: "linus@example.com" },
    ])
  })

  it("drops the author and repeated co-authors", () => {
    const result = splitCoAuthors(
      "Pair on it\n\nCo-authored-by: Ada <ADA@example.com>\nCo-authored-by: Grace <grace@example.com>\nCo-authored-by: G <grace@example.com>",
      author,
    )
    expect(result.coAuthors).toEqual([{ name: "Grace", email: "grace@example.com" }])
  })

  it("keeps a message without trailers as it is", () => {
    expect(splitCoAuthors("Just a subject", author)).toEqual({ message: "Just a subject", coAuthors: [] })
  })
})
