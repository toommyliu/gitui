export const FILE_KINDS = ["code", "tests", "mocks", "generated"] as const
export type FileKind = (typeof FILE_KINDS)[number]

const GENERATED_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "deno.lock",
  "flake.lock",
  "gemfile.lock",
  "go.sum",
  "gradle.lockfile",
  "mix.lock",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "packages.lock.json",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "podfile.lock",
  "poetry.lock",
  "pubspec.lock",
  "uv.lock",
  "yarn.lock",
])
const GENERATED_NAME =
  /(\.generated\.|\.gen\.|\.g\.dart$|\.pb\.go$|_pb2(_grpc)?\.py$|\.pb\.(cc|h)$|\.min\.(js|css)$|\.(js|css)\.map$)/
const GENERATED_DIRS = new Set(["__generated__", "generated"])

const MOCK_NAME = /(\.snap$|\.(mocks?|fixtures?|stubs?|fakes?)\.[^.]+$|^(mocks?|fixtures?|stubs?|fakes?)([-_.A-Z]|$))/
const MOCK_DIRS = new Set([
  "__fixtures__",
  "__mocks__",
  "__snapshots__",
  "fakes",
  "fixture",
  "fixtures",
  "mock",
  "mocks",
  "stubs",
  "testdata",
])

const TEST_NAME =
  /(\.(test|spec|e2e)\.[^.]+$|_(test|spec)\.[^.]+$|^test_.+\.py$|^conftest\.py$|^(vitest|jest)\.setup\.[^.]+$)/i
// Case-sensitive: `FooTest.java` is a test class, `Latest.java` is not.
const CLASS_TEST_NAME = /(Tests?|Spec)\.(java|kt|kts|scala|groovy|cs|php|swift|m)$/
const TEST_DIRS = new Set(["__tests__", "__test__", "cypress", "e2e", "spec", "specs", "test", "tests"])

export function fileKind(path: string): FileKind {
  const segments = path.split("/")
  const name = segments.pop() ?? ""
  const dirs = segments.map((segment) => segment.toLowerCase())
  const inDir = (set: ReadonlySet<string>) => dirs.some((dir) => set.has(dir))
  if (GENERATED_FILES.has(name.toLowerCase()) || GENERATED_NAME.test(name) || inDir(GENERATED_DIRS)) return "generated"
  if (MOCK_NAME.test(name) || inDir(MOCK_DIRS)) return "mocks"
  if (TEST_NAME.test(name) || CLASS_TEST_NAME.test(name) || inDir(TEST_DIRS)) return "tests"
  return "code"
}

export type LineCounts = { additions: number; deletions: number }

export function changeBreakdown(
  files: ReadonlyArray<{ path: string; additions: number | null; deletions: number | null }>,
): Record<FileKind, LineCounts> {
  const breakdown = {
    code: { additions: 0, deletions: 0 },
    tests: { additions: 0, deletions: 0 },
    mocks: { additions: 0, deletions: 0 },
    generated: { additions: 0, deletions: 0 },
  }
  for (const file of files) {
    const counts = breakdown[fileKind(file.path)]
    counts.additions += file.additions ?? 0
    counts.deletions += file.deletions ?? 0
  }
  return breakdown
}
