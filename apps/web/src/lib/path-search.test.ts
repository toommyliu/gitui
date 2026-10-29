import { describe, expect, it } from "vite-plus/test"
import { searchPaths } from "./path-search"

const paths = ["README.md", "docs/apple.md", "src/app.ts", "src/lib/app-shell.ts", "src/lib/map.ts"]

describe("finding a tracked file by path", () => {
  it("lists files in their original order when the query is empty", () => {
    expect(searchPaths(paths, "  ", 2)).toEqual({ matches: ["README.md", "docs/apple.md"], total: 5 })
  })

  it("ranks file name matches before directory matches, then shorter paths", () => {
    expect(searchPaths(paths, "app", 10)).toEqual({
      matches: ["src/app.ts", "docs/apple.md", "src/lib/app-shell.ts"],
      total: 3,
    })
    expect(searchPaths(paths, "lib", 10).matches).toEqual(["src/lib/map.ts", "src/lib/app-shell.ts"])
  })

  it("requires every term and ignores case", () => {
    expect(searchPaths(paths, "SRC App", 10).matches).toEqual(["src/app.ts", "src/lib/app-shell.ts"])
  })

  it("counts every match while returning only the limit", () => {
    expect(searchPaths(paths, "s", 1)).toEqual({ matches: ["src/app.ts"], total: 4 })
  })
})
