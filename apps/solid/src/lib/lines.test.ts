import { parsePatchFiles } from "@pierre/diffs"
import { describe, expect, it } from "vite-plus/test"
import { editorLine, wholeFile } from "./lines"

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

describe("deciding which diffs only take whole-file actions", () => {
  const files = parsePatchFiles(`diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4cb29ea..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
diff --git a/untracked.txt b/untracked.txt
new file mode 100644
index 0000000..8ff1852
--- /dev/null
+++ b/untracked.txt
@@ -0,0 +1,2 @@
+u1
+u2
diff --git a/old.txt b/new.txt
similarity index 57%
rename from old.txt
rename to new.txt
index 04ec35a..72c29dd 100644
--- a/old.txt
+++ b/new.txt
@@ -1,3 +1,3 @@
 x
-y
+y2
 z
diff --git a/link b/link
index 1764325..e0e6347 120000
--- a/link
+++ b/link
@@ -1 +1 @@
-keep.txt
\\ No newline at end of file
+run.sh
\\ No newline at end of file
diff --git a/newlink b/newlink
new file mode 120000
index 0000000..1764325
--- /dev/null
+++ b/newlink
@@ -0,0 +1 @@
+keep.txt
\\ No newline at end of file
diff --git a/sub b/sub
index c5d0cdf..da13329 160000
--- a/sub
+++ b/sub
@@ -1 +1 @@
-Subproject commit c5d0cdf891b89c6ed363d73496b75a259d07c74a
+Subproject commit da13329cb2d4fc7635d57470a95970ac0036e4a2
diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
index 4163036..ac23810
--- a/run.sh
+++ b/run.sh
@@ -1,2 +1,2 @@
 #!/bin/sh
-echo hi
+echo bye
`).flatMap((patch) => patch.files)
  const kinds = Object.fromEntries(files.map((file) => [file.name, wholeFile(file)]))

  it("lets text in new, deleted and renamed files take line actions", () => {
    expect(kinds).toMatchObject({ "gone.txt": null, "untracked.txt": null, "new.txt": null })
  })
  it("keeps symlinks, submodules and mode changes whole", () => {
    expect(kinds).toMatchObject({ link: "symlink", newlink: "symlink", sub: "submodule", "run.sh": "mode" })
  })
})
