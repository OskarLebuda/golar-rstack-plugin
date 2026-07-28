import path from 'node:path'
import { describe, expect, it } from '@rstest/core'
import { parseGolarOutput } from '../src/parse.js'

const cwd = '/project'
const options = {
  cwd,
  typecheckSeverity: 'error',
  lintSeverity: 'warning',
} as const

describe('parseGolarOutput', () => {
  it('parses typecheck diagnostics and resolves paths against cwd', () => {
    const output = [
      'Using config from ./golar.config.ts...',
      'src/App.vue(2,7): error TS2322: Type \'string\' is not assignable to type \'number\'.',
      'src/bad.ts(7,8): error TS2345: Argument of type \'string\' is not assignable to parameter of type \'number\'.',
    ].join('\n')

    const issues = parseGolarOutput(output, options)

    expect(issues).toHaveLength(2)
    expect(issues[0]).toEqual({
      severity: 'error',
      code: 'TS2322',
      message: 'Type \'string\' is not assignable to type \'number\'.',
      origin: 'typecheck',
      file: path.resolve(cwd, 'src/App.vue'),
      location: { line: 2, column: 7 },
    })
    expect(issues[1]?.code).toBe('TS2345')
  })

  it('parses the pretty typecheck layout golar emits when colour is on', () => {
    // Verbatim from a run with FORCE_COLOR set, ANSI codes aside: a dash before
    // the severity, then a blank line, the source frame and a summary.
    const output = [
      'Using config from ./golar.config.ts...',
      'src/math.ts:6:33: explicit-anys: Unexpected any. Specify a different type.',
      'src/App.vue:8:7 - error TS2322: Type \'number\' is not assignable to type \'string\'.',
      '',
      '8 const label: string = double(count.value)',
      '        ~~~~~',
      '',
      'Found 1 error in src/App.vue:8',
    ].join('\n')

    const issues = parseGolarOutput(output, options)

    expect(issues).toHaveLength(2)
    expect(issues[1]).toEqual({
      severity: 'error',
      code: 'TS2322',
      message: 'Type \'number\' is not assignable to type \'string\'.',
      origin: 'typecheck',
      file: path.resolve(cwd, 'src/App.vue'),
      location: { line: 8, column: 7 },
    })
    // The frame under the diagnostic is decoration, not an elaboration.
    expect(issues[1]?.message).not.toContain('~~~~~')
  })

  it('folds indented elaborations into the preceding message', () => {
    const output = [
      'src/multiline.ts(6,7): error TS2322: Type \'number[]\' is not assignable to type \'string[]\'.',
      '  Type \'number\' is not assignable to type \'string\'.',
    ].join('\n')

    const issues = parseGolarOutput(output, options)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toBe(
      'Type \'number[]\' is not assignable to type \'string[]\'.\n  Type \'number\' is not assignable to type \'string\'.',
    )
  })

  it('parses lint diagnostics, which use a colon-separated layout', () => {
    const output = 'src/lintme.ts:1:22: explicit-anys: Unexpected any. Specify a different type.'

    const issues = parseGolarOutput(output, options)

    expect(issues).toEqual([{
      severity: 'warning',
      code: 'explicit-anys',
      message: 'Unexpected any. Specify a different type.',
      origin: 'lint',
      file: path.resolve(cwd, 'src/lintme.ts'),
      location: { line: 1, column: 22 },
    }])
  })

  it('does not misread a typecheck diagnostic as a lint one', () => {
    const issues = parseGolarOutput(
      'src/bad.ts(1,14): error TS2322: Type \'string\' is not assignable to type \'number\'.',
      options,
    )

    expect(issues[0]?.origin).toBe('typecheck')
  })

  it('parses project-wide diagnostics that carry no position', () => {
    const issues = parseGolarOutput('error TS5083: Cannot read file \'tsconfig.json\'.', options)

    expect(issues).toEqual([{
      severity: 'error',
      code: 'TS5083',
      message: 'Cannot read file \'tsconfig.json\'.',
      origin: 'typecheck',
    }])
  })

  it('ignores CLI chatter and stack traces', () => {
    const output = [
      'Using config from ./golar.config.ts...',
      '(node:57123) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type is not specified.',
      'SyntaxError: The requested module \'@golar/vue\' does not provide an export named \'vue\'',
      '    at async loadConfig (file:///project/node_modules/golar/dist/config.js:13:30)',
    ].join('\n')

    expect(parseGolarOutput(output, options)).toEqual([])
  })

  it('keeps absolute paths untouched', () => {
    const issues = parseGolarOutput(
      '/elsewhere/src/a.ts(1,1): error TS1005: \';\' expected.',
      options,
    )

    expect(issues[0]?.file).toBe('/elsewhere/src/a.ts')
  })

  it('demotes informational diagnostics to warnings', () => {
    const issues = parseGolarOutput('src/a.ts(1,1): message TS6133: \'x\' is declared but never used.', options)

    expect(issues[0]?.severity).toBe('warning')
  })

  it('strips ANSI colour codes', () => {
    const esc = String.fromCharCode(27)
    const output = `${esc}[31msrc/a.ts(1,1): error TS2322: bad.${esc}[0m`

    expect(parseGolarOutput(output, options)[0]?.message).toBe('bad.')
  })
})
