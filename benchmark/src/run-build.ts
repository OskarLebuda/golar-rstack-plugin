import path from 'node:path'
import process from 'node:process'
import { rspack } from '@rspack/core'
import { GolarRspackPlugin } from '@golar-rstack/rspack'
import { TsCheckerRspackPlugin } from 'ts-checker-rspack-plugin'

/**
 * Runs one compilation and reports what it cost.
 *
 * This is a separate process on purpose: a checker that kept a program, a
 * worker or a warm module graph between runs would make the second measurement
 * meaningless, and both plugins under test do keep state.
 *
 * Invoked as: run-build.ts <tool> <caseDir>
 */

const [tool, caseDir] = process.argv.slice(2) as [string, string]

/**
 * Builds the plugin under test.
 *
 * @param name Which plugin to construct.
 * @returns The configured plugin instance.
 * @throws If the name is not one of the plugins this benchmark knows.
 */
function createPlugin(name: string) {
  if (name === 'golar')
    return new GolarRspackPlugin({ cwd: caseDir, async: false })

  if (name === 'ts-checker') {
    return new TsCheckerRspackPlugin({
      async: false,
      typescript: {
        // The wrapper the plugin's own README prescribes for Vue support.
        typescriptPath: '@esctn/vue-tsc-api',
        configFile: path.join(caseDir, 'tsconfig.json'),
      },
    })
  }

  if (name === 'none')
    return undefined

  throw new Error(`Unknown tool "${name}".`)
}

const plugin = createPlugin(tool)

const compiler = rspack({
  context: caseDir,
  mode: 'development',
  // A single trivial module, so the measurement is the checker rather than the
  // bundler. The baseline tool ('none') exists to show how little of the
  // number rspack itself accounts for.
  entry: path.join(import.meta.dirname, 'entry.js'),
  output: { path: path.join(import.meta.dirname, '..', '.out', tool) },
  infrastructureLogging: { level: 'error' },
  plugins: plugin ? [plugin] : [],
})

const started = performance.now()

compiler.run((error, stats) => {
  if (error || !stats) {
    console.log(JSON.stringify({ failed: String(error) }))
    process.exit(1)
  }

  const durationMs = Math.round(performance.now() - started)

  // File and code only. The two plugins render frames differently and put the
  // path in different places — golar in the message, ts-checker in `file` —
  // so the gate compares what was found, not how it was printed. Positions are
  // left out because the plugins count SFC lines from different origins.
  const found = [...stats.compilation.errors, ...stats.compilation.warnings]
    .flatMap((issue) => {
      const message = issue instanceof Error ? issue.message : String(issue)
      const code = /TS\d+/.exec(message)?.[0]
      if (!code)
        return []

      const from = (issue as { file?: string }).file ?? message
      const file = /[\w./-]+\.(?:vue|ts)/.exec(from)?.[0]

      return [`${path.basename(file ?? '?')} ${code}`]
    })
    .sort()

  console.log(JSON.stringify({ durationMs, modules: stats.compilation.modules.size, found }))
  compiler.close(() => process.exit(0))
})
