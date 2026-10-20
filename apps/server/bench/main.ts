import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { cacheDir, git } from "./fixture.ts"
import { formatComparison, formatSide, type Results, type Sample, type Side } from "./report.ts"

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rounds: { type: "string", default: "5" },
    only: { type: "string" },
    trials: { type: "string", default: "1" },
    ballast: { type: "string", default: "30000" },
    base: { type: "string" },
    compare: { type: "boolean", default: false },
  },
})

const here = resolve(import.meta.dirname, "../../..")

const load = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Results

if (options.compare) {
  const [a, b] = positionals.map(load)
  if (a === undefined || b === undefined) throw new Error("usage: bench --compare <base.json> <head.json>")
  console.log(formatComparison(a.sides.at(-1)!, b.sides.at(-1)!))
  process.exit(0)
}

const checkoutOf = (ref: string) => {
  const commit = git(here, ["rev-parse", "--verify", `${ref}^{commit}`])
  const dir = join(cacheDir, "checkouts", commit.slice(0, 12))
  if (!existsSync(join(dir, "node_modules"))) {
    if (!existsSync(dir)) {
      git(here, ["clone", "--quiet", "--shared", "--no-checkout", here, dir])
      git(dir, ["checkout", "--quiet", "--detach", commit])
    }
    execFileSync("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: dir, stdio: "inherit" })
  }
  return dir
}

const describe = (label: string, checkout: string) => ({
  label,
  checkout,
  commit: git(checkout, ["rev-parse", "HEAD"]),
  dirty: git(checkout, ["status", "--porcelain", "--untracked-files=no"]) !== "",
})

const sides = [
  ...(options.base === undefined ? [] : [describe(options.base, checkoutOf(options.base))]),
  describe("head", here),
]
for (const side of sides) {
  if (side.checkout !== here) cpSync(import.meta.dirname, join(side.checkout, "apps/server/bench"), { recursive: true })
}
const samples = new Map<string, Array<Sample>>(sides.map((side) => [side.label, []]))
const scratch = join(cacheDir, "rounds")
mkdirSync(scratch, { recursive: true })

const passthrough = [
  ...(options.only === undefined ? [] : ["--only", options.only]),
  "--trials",
  options.trials,
  "--ballast",
  options.ballast,
]

for (let round = 0; round < Number(options.rounds); round++) {
  const order = round % 2 === 0 ? sides : [...sides].reverse()
  for (const side of order) {
    console.error(`round ${round + 1}/${options.rounds} ${side.label}`)
    const out = join(scratch, `${process.pid}-${side.label.replace(/\W+/g, "_")}-${round}.json`)
    const result = spawnSync(
      process.execPath,
      [join(side.checkout, "apps/server/bench/round.ts"), "--out", out, ...passthrough],
      {
        cwd: join(side.checkout, "apps/server"),
        stdio: ["ignore", "ignore", "inherit"],
      },
    )
    if (result.status !== 0) throw new Error(`round ${round + 1} failed for ${side.label} (exit ${result.status})`)
    samples.get(side.label)!.push(...(JSON.parse(readFileSync(out, "utf8")) as Array<Sample>))
  }
}

const results: Results = {
  git: execFileSync("git", ["--version"], { encoding: "utf8" }).trim(),
  node: process.version,
  options: { rounds: options.rounds, trials: options.trials, ballast: options.ballast, only: options.only ?? "all" },
  sides: sides.map((side): Side => ({ ...side, samples: samples.get(side.label)! })),
}
const resultsDir = join(cacheDir, "results")
mkdirSync(resultsDir, { recursive: true })
const file = join(
  resultsDir,
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${sides.at(-1)!.commit.slice(0, 10)}.json`,
)
writeFileSync(file, JSON.stringify(results, null, 2))

for (const side of results.sides) console.log(`${formatSide(side)}\n`)
if (results.sides.length === 2) console.log(formatComparison(results.sides[0]!, results.sides[1]!))
console.log(`\nsaved ${file}`)
