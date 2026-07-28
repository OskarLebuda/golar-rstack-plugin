import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Configuration, Stats } from '@rspack/core'
import { rspack } from '@rspack/core'
import { describe, expect, it } from '@rstest/core'
import { GolarRspackPlugin } from '../src/index.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
// A real golar project: golar.config.ts, a Vue SFC type error, a lint error.
const fixture = path.resolve(dirname, '../../../playground/rsbuild-vue')

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
 * Extracts only the diagnostics this plugin contributed.
 *
 * @param diagnostics A compilation's `errors` or `warnings`.
 * @returns The messages of the golar issues, joined by newlines.
 */
function golarMessages(diagnostics: unknown[]): string {
  return diagnostics
    .filter((d): d is Error => d instanceof Error && d.name === 'GolarIssueError')
    .map(d => d.message)
    .join('\n')
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

    const errors = golarMessages(stats.compilation.errors)
    expect(errors).toContain('TS2322')
    expect(errors).toContain('App.vue')

    // Lint issues stay warnings by default: golar itself exits 0 for them.
    expect(golarMessages(stats.compilation.warnings)).toContain('explicit-anys')

    await new Promise<void>(resolve => compiler.close(() => resolve()))
  })

  it('replays the dev-server done tap so the overlay receives issues', async () => {
    const plugin = new GolarRspackPlugin({ cwd: fixture, async: true })
    const compiler = createCompiler()
    plugin.apply(compiler)

    // Stand in for rsbuild's own tap, which is what the browser overlay
    // listens to. Registered after apply() so the interceptor records it.
    let replayed: Stats | undefined
    const replays = new Promise<void>((resolve) => {
      compiler.hooks.done.tap('rsbuild-dev-server', (stats) => {
        // Called once by the build itself, then again by the plugin once
        // golar finishes. Only the replay carries golar's issues.
        if (golarMessages(stats.compilation.errors)) {
          replayed = stats
          resolve()
        }
      })
    })

    const watching = compiler.watch({}, () => {})
    await replays

    const errors = golarMessages(replayed!.compilation.errors)
    expect(errors).toContain('TS2322')
    expect(errors).toContain('App.vue')

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

    // The compilation completed carrying none of golar's issues.
    expect(golarMessages(stats!.compilation.errors)).toBe('')

    await new Promise<void>(resolve => watching.close(() => resolve()))
  })
})
