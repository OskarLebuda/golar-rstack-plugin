import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Configuration, Stats } from '@rspack/core'
import { rspack } from '@rspack/core'
import { describe, expect, it } from '@rstest/core'
import { GolarRspackPlugin } from '../src/index.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
// A real golar project: golar.config.ts, a Vue SFC type error, a lint error.
const fixture = path.resolve(dirname, '../../../playground/rsbuild-vue')

// Long enough for a cold golar start, short enough to leave room for the
// runner's own timeout so a stall reports what it saw instead of being killed.
const REPLAY_TIMEOUT_MS = 60_000

function createCompiler() {
  const config: Configuration = {
    context: fixture,
    mode: 'development',
    entry: path.join(dirname, 'fixture/entry.js'),
    output: { path: path.join(dirname, '__out__') },
    infrastructureLogging: { level: 'error' },
  }

  return rspack(config)
}

/**
 * Renders every diagnostic on a compilation, whichever plugin produced it.
 *
 * Filtering to this plugin's own errors hides the interesting case: when golar
 * cannot start, the plugin reports a plain Error, and a filtered view turns
 * that into an empty string that explains nothing.
 *
 * @param diagnostics A compilation's `errors` or `warnings`.
 * @returns One block of text describing all of them.
 */
function describeDiagnostics(diagnostics: unknown[]): string {
  if (diagnostics.length === 0)
    return '(none)'

  return diagnostics
    .map(d => (d instanceof Error ? `[${d.name}] ${d.message}` : String(d)))
    .join('\n--\n')
}

describe('golarRspackPlugin', () => {
  it('fails a build with the type error golar found inside the SFC', async () => {
    const plugin = new GolarRspackPlugin({ cwd: fixture, async: false })
    const compiler = createCompiler()
    plugin.apply(compiler)

    const stats = await new Promise<Stats>((resolve, reject) => {
      compiler.run((error, result) => {
        if (error || !result)
          reject(error ?? new Error('no stats'))
        else
          resolve(result)
      })
    })

    const report = [
      `errors:\n${describeDiagnostics(stats.compilation.errors)}`,
      `warnings:\n${describeDiagnostics(stats.compilation.warnings)}`,
    ].join('\n\n')

    expect(report).toContain('TS2322')
    expect(report).toContain('App.vue')
    // Lint issues stay warnings by default: golar itself exits 0 for them.
    expect(report).toContain('explicit-anys')

    await new Promise<void>(resolve => compiler.close(() => resolve()))
  })

  it('replays the dev-server done tap so the overlay receives issues', async () => {
    const plugin = new GolarRspackPlugin({ cwd: fixture, async: true })
    const compiler = createCompiler()
    plugin.apply(compiler)

    // Stand in for rsbuild's own tap, which is what the browser overlay
    // listens to. Registered after apply() so the interceptor records it.
    const seen: string[] = []
    let replayed: Stats | undefined

    const replays = new Promise<void>((resolve) => {
      compiler.hooks.done.tap('rsbuild-dev-server', (stats) => {
        seen.push(describeDiagnostics(stats.compilation.errors))
        // Called once by the build itself, then again by the plugin once
        // golar finishes. Only the replay carries golar's issues.
        if (stats.compilation.errors.length > 0) {
          replayed = stats
          resolve()
        }
      })
    })

    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, REPLAY_TIMEOUT_MS).unref?.()
    })

    const watching = compiler.watch({}, () => {})
    await Promise.race([replays, timeout])

    // On a stall this reports every tap invocation, so the failure says what
    // the dev server actually received instead of just timing out.
    const report = replayed
      ? describeDiagnostics(replayed.compilation.errors)
      : `tap never received errors. Invocations:\n${seen.join('\n==\n') || '(never called)'}`

    expect(report).toContain('TS2322')
    expect(report).toContain('App.vue')

    await new Promise<void>(resolve => watching.close(() => resolve()))
  })

  it('does not block the build in async mode', async () => {
    const plugin = new GolarRspackPlugin({ cwd: fixture, async: true })
    const compiler = createCompiler()
    plugin.apply(compiler)

    let stats: Stats | undefined
    const built = new Promise<void>((resolve) => {
      compiler.hooks.done.tap('test-observer', (result) => {
        stats ??= result
        resolve()
      })
    })

    const watching = compiler.watch({}, () => {})
    await built

    // The compilation completed without waiting for golar, so none of its
    // issues are attached yet.
    const golarErrors = stats!.compilation.errors
      .filter((e): e is Error => e instanceof Error && e.name === 'GolarIssueError')

    expect(describeDiagnostics(golarErrors)).toBe('(none)')

    await new Promise<void>(resolve => watching.close(() => resolve()))
  })
})
