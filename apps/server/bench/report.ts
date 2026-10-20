export interface Command {
  readonly args: string
  readonly atMs: number
  readonly ms: number
  readonly phase: "op" | "refresh" | "after"
}

export interface Sample {
  readonly scenario: string
  readonly rpcMs: number
  readonly settledMs: number | null
  readonly restarts: number
  readonly events: number
  readonly commands: ReadonlyArray<Command>
}

export interface Side {
  readonly label: string
  readonly checkout: string
  readonly commit: string
  readonly dirty: boolean
  readonly samples: ReadonlyArray<Sample>
}

export interface Results {
  readonly git: string
  readonly node: string
  readonly options: Readonly<Record<string, string>>
  readonly sides: ReadonlyArray<Side>
}

interface Spread {
  readonly median: number
  readonly min: number
  readonly max: number
}

const spread = (values: ReadonlyArray<number>): Spread => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  return { median, min: sorted[0]!, max: sorted.at(-1)! }
}

const ms = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)}ms`
const show = (s: Spread) => `${ms(s.median)} [${ms(s.min)}–${ms(s.max)}]`

const byScenario = (samples: ReadonlyArray<Sample>) => {
  const groups = new Map<string, Array<Sample>>()
  for (const sample of samples) groups.set(sample.scenario, [...(groups.get(sample.scenario) ?? []), sample])
  return groups
}

const opCommands = (sample: Sample) => sample.commands.filter((command) => command.phase === "op")

const medianSample = (samples: ReadonlyArray<Sample>) =>
  [...samples].sort((a, b) => a.rpcMs - b.rpcMs)[Math.floor(samples.length / 2)]!

export const formatSide = (side: Side) => {
  const lines = [`${side.label}: ${side.commit.slice(0, 10)}${side.dirty ? " (dirty)" : ""} ${side.checkout}`]
  for (const [scenario, samples] of byScenario(side.samples)) {
    const settled = samples.flatMap((sample) => (sample.settledMs === null ? [] : [sample.settledMs]))
    const typical = medianSample(samples)
    lines.push(
      `  ${scenario.padEnd(28)} n=${samples.length}  rpc ${show(spread(samples.map((s) => s.rpcMs)))}` +
        (settled.length > 0 ? `  settled ${show(spread(settled))}` : "") +
        `  events ${spread(samples.map((s) => s.events)).median}  restarts ${samples.reduce((n, s) => n + s.restarts, 0)}`,
    )
    for (const command of opCommands(typical)) {
      lines.push(`      +${ms(command.atMs).padStart(7)} ${ms(command.ms).padStart(7)}  git ${command.args}`)
    }
  }
  return lines.join("\n")
}

const verdict = (base: Spread, head: Spread) => {
  if (head.max < base.min) return `${(base.median / head.median).toFixed(1)}x faster`
  if (head.min > base.max) return `${(head.median / base.median).toFixed(1)}x slower`
  return "within spread"
}

export const formatComparison = (base: Side, head: Side) => {
  const lines = [`base ${base.label}: ${base.commit.slice(0, 10)}  head ${head.label}: ${head.commit.slice(0, 10)}`]
  const heads = byScenario(head.samples)
  for (const [scenario, baseSamples] of byScenario(base.samples)) {
    const headSamples = heads.get(scenario)
    if (headSamples === undefined) continue
    const metrics: Array<readonly [string, (sample: Sample) => number | null]> = [
      ["rpc", (sample) => sample.rpcMs],
      ["settled", (sample) => sample.settledMs],
    ]
    for (const [metric, pick] of metrics) {
      const a = baseSamples.flatMap((sample) => pick(sample) ?? [])
      const b = headSamples.flatMap((sample) => pick(sample) ?? [])
      if (a.length === 0 || b.length === 0) continue
      const [sa, sb] = [spread(a), spread(b)]
      lines.push(
        `  ${scenario.padEnd(28)} ${metric.padEnd(8)} ${show(sa).padEnd(26)} -> ${show(sb).padEnd(26)} ${verdict(sa, sb)}`,
      )
    }
  }
  return lines.join("\n")
}
