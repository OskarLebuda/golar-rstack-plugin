import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveGolarOptions, runGolar } from '@golar-rstack/core'
import { describe, expect, it } from '@rstest/core'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.resolve(dirname, '../../../playground/rsbuild-vue')

/**
 * Runs golar against the fixture with no plugin involved.
 *
 * The plugin tests build on this. When they fail, this test says whether the
 * fault is in golar and the fixture or in the plugin wiring, which a failure
 * inside a compiler run cannot distinguish.
 */
describe('golar against the playground fixture', () => {
  it('reports both the SFC type error and the lint error', async () => {
    const options = resolveGolarOptions({ cwd: fixture }, { cwd: fixture, watch: false })
    const result = await runGolar(options)

    const summary = [
      `cwd: ${options.cwd}`,
      `exitCode: ${result.exitCode}`,
      `issues: ${JSON.stringify(result.issues, null, 2)}`,
      `raw output:\n${result.output}`,
    ].join('\n')

    // Assert on the summary so a CI failure carries golar's raw output, rather
    // than just reporting that an array was empty.
    expect(summary).toContain('TS2322')
    expect(summary).toContain('App.vue')
    expect(summary).toContain('explicit-anys')
  })

  it('reports the SFC type error even when the host forces colour', async () => {
    // What CI does: rstest hands its workers FORCE_COLOR=1, golar inherits it,
    // and its type checker switches to a layout the parser used to skip, so
    // every type error vanished while lint findings came through untouched.
    const previous = process.env.FORCE_COLOR
    process.env.FORCE_COLOR = '1'

    try {
      const options = resolveGolarOptions({ cwd: fixture }, { cwd: fixture, watch: false })
      const result = await runGolar(options)

      const summary = [
        `exitCode: ${result.exitCode}`,
        `issues: ${JSON.stringify(result.issues, null, 2)}`,
        `raw output:\n${result.output}`,
      ].join('\n')

      expect(summary).toContain('TS2322')
      expect(result.issues.some(issue => issue.origin === 'typecheck')).toBe(true)
    }
    finally {
      if (previous == null)
        delete process.env.FORCE_COLOR
      else
        process.env.FORCE_COLOR = previous
    }
  })
})
