import { describe, expect, it } from "vite-plus/test"
import { changeBreakdown, fileKind } from "./file-kind"

describe("sorting a changed file by its path", () => {
  it.each([
    ["apps/server/src/ws.ts", "code"],
    ["src/latest.ts", "code"],
    ["src/Latest.java", "code"],
    ["src/contest.py", "code"],
    ["src/mockingbird.ts", "code"],
    ["src/testimonials/List.tsx", "code"],
    ["src/testUtils.ts", "code"],
    ["apps/web/src/foo.test.ts", "tests"],
    ["apps/web/src/Foo.browser.test.tsx", "tests"],
    ["src/foo.spec.js", "tests"],
    ["pkg/server_test.go", "tests"],
    ["tests/test_api.py", "tests"],
    ["conftest.py", "tests"],
    ["src/main/java/RequestTest.java", "tests"],
    ["Sources/AppTests.swift", "tests"],
    ["src/HTTPTest.java", "tests"],
    ["spec/models/user_spec.rb", "tests"],
    ["src/__tests__/helpers.ts", "tests"],
    ["src/__mocks__/fs.ts", "mocks"],
    ["test/fixtures/pr.json", "mocks"],
    ["src/__snapshots__/view.test.ts.snap", "mocks"],
    ["src/api.mock.ts", "mocks"],
    ["src/mockServer.ts", "mocks"],
    ["pkg/testdata/input.txt", "mocks"],
    ["pnpm-lock.yaml", "generated"],
    ["apps/web/package-lock.json", "generated"],
    ["go.sum", "generated"],
    ["src/routeTree.gen.ts", "generated"],
    ["src/__generated__/types.ts", "generated"],
    ["dist/app.min.js", "generated"],
  ] as const)("%s is %s", (path, kind) => {
    expect(fileKind(path)).toBe(kind)
  })
})

describe("splitting a change's line counts by file kind", () => {
  it("sums each kind and counts binary files as no lines", () => {
    expect(
      changeBreakdown([
        { path: "src/a.ts", additions: 10, deletions: 2 },
        { path: "src/b.ts", additions: 5, deletions: 1 },
        { path: "src/a.test.ts", additions: 40, deletions: 0 },
        { path: "pnpm-lock.yaml", additions: 300, deletions: 120 },
        { path: "assets/logo.png", additions: null, deletions: null },
      ]),
    ).toEqual({
      code: { additions: 15, deletions: 3 },
      tests: { additions: 40, deletions: 0 },
      mocks: { additions: 0, deletions: 0 },
      generated: { additions: 300, deletions: 120 },
    })
  })
})
