import { parsePatchFiles } from "@pierre/diffs"
import { describe, expect, it } from "vite-plus/test"
import { editorLine } from "./lines"

const [patch] = parsePatchFiles(`diff --git a/example.ts b/example.ts
--- a/example.ts
+++ b/example.ts
@@ -10,4 +10,5 @@
 before
-removed
+replacement
+extra
 after
 end
`)
const file = patch!.files[0]!

describe("opening a selected diff line in an editor", () => {
  it("keeps a line on the new side", () => {
    expect(editorLine(file, { start: 12, end: 12, side: "additions" })).toBe(12)
  })
  it("maps old context to its new line after an insertion", () => {
    expect(editorLine(file, { start: 12, end: 12, side: "deletions" })).toBe(13)
  })
  it("opens the replacement location for a deleted line", () => {
    expect(editorLine(file, { start: 11, end: 11, side: "deletions" })).toBe(11)
  })
})
