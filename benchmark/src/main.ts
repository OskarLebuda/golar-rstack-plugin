import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { generateCase } from './cases.ts'
import { median, runBuild } from './measure.ts'

const TOOLS = ['none', 'golar', 'ts-checker'] as const
const LABELS: Record<string, string> = {
  'none': 'rspack alone (baseline)',
  'golar': '@golar-rstack/rspack',
  'ts-checker': 'ts-checker-rspack-plugin',
}

interface Options {
  sizes: number[]
  runs: number
  warmups: number
}

/**
 * Reads the command line.
 *
 * @param argv Arguments after the script name.
 * @returns The requested sizes and repetition counts.
 */
function parseOptions(argv: string[]): Options {
  const flag = (name: string): string[] => {
    const at = argv.indexOf(`--${name}`)
    if (at === -1)
      return []

    const values: string[] = []
    for (let i = at + 1; i < argv.length && !argv[i]!.startsWith('--'); i++)
      values.push(argv[i]!)

    return values
  }

  const sizes = flag('sizes').map(Number).filter(Number.isFinite)
  const runs = Number(flag('runs')[0])
  const warmups = Number(flag('warmups')[0])

  return {
    sizes: sizes.length > 0 ? sizes : [100, 400],
    runs: Number.isFinite(runs) ? runs : 5,
    warmups: Number.isFinite(warmups) ? warmups : 1,
  }
}

/**
 * Checks that every plugin found the same problems before any timing is shown.
 *
 * A checker that silently misses diagnostics will look fast, so speed is only
 * worth reporting once the tools are known to agree.
 *
 * @param results What each tool reported.
 * @throws If two plugins disagree about what is wrong with the fixture.
 */
function assertSameDiagnostics(results: Map<string, string[]>): void {
  const checkers = [...results].filter(([tool]) => tool !== 'none')
  const [first, ...rest] = checkers

  if (!first)
    return

  for (const [tool, found] of rest) {
    if (JSON.stringify(found) !== JSON.stringify(first[1])) {
      throw new Error(
        `${tool} and ${first[0]} disagree, so the timings below would compare different work.\n`
        + `  ${first[0]}: ${JSON.stringify(first[1])}\n`
        + `  ${tool}: ${JSON.stringify(found)}`,
      )
    }
  }

  if (first[1].length === 0)
    throw new Error('No diagnostics found at all: the fixture is not exercising the checkers.')
}

const options = parseOptions(process.argv.slice(2))
const root = path.join(import.meta.dirname, '..')
const runner = path.join(import.meta.dirname, 'run-build.ts')
const casesDir = path.join(root, '.cases')

const rows: string[] = []

for (const size of options.sizes) {
  // One seeded error is enough for the gate: what matters is that both plugins
  // see the same thing, not how much of it there is.
  const generated = generateCase(casesDir, { size, errors: 1 })
  console.error(`\n=== ${size} components (${size} SFCs + ${size} modules) ===`)

  const medians = new Map<string, number>()
  const diagnostics = new Map<string, string[]>()

  for (const tool of TOOLS) {
    for (let i = 0; i < options.warmups; i++)
      await runBuild(runner, tool, generated.dir)

    const samples: number[] = []
    let found: string[] = []

    for (let i = 0; i < options.runs; i++) {
      const outcome = await runBuild(runner, tool, generated.dir)
      samples.push(outcome.durationMs)
      found = outcome.found
    }

    medians.set(tool, median(samples))
    diagnostics.set(tool, found)
    console.error(`  ${LABELS[tool]}: median ${median(samples)} ms  [${samples.join(', ')}]`)
  }

  assertSameDiagnostics(diagnostics)
  console.error(`  diagnostics agree: ${JSON.stringify(diagnostics.get('golar'))}`)

  const golar = medians.get('golar')!
  const tsChecker = medians.get('ts-checker')!
  rows.push(
    `| ${size} | ${medians.get('none')} ms | ${tsChecker} ms | ${golar} ms | ${(tsChecker / golar).toFixed(2)}× |`,
  )
}

const report = [
  '# golar vs ts-checker, cold blocking check',
  '',
  `Node ${process.version} on ${process.platform}. Median of ${options.runs} runs after ${options.warmups} warmup(s).`,
  '',
  'Each run is an rspack compilation whose entry is one trivial module, so the',
  'figure is the checker rather than the bundler. The baseline column shows how',
  'little rspack itself contributes. Bundling of the components, `async: true`,',
  'watch rebuilds and memory are not measured.',
  '',
  '| components | rspack alone | ts-checker-rspack-plugin | @golar-rstack/rspack | ratio |',
  '| --- | --- | --- | --- | --- |',
  ...rows,
  '',
].join('\n')

fs.writeFileSync(path.join(root, 'results.md'), report)
console.log(`\n${report}`)
