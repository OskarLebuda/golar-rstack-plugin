import fs from 'node:fs'
import path from 'node:path'
import type { IssueSeverity } from './issue.js'

export type GolarMode = 'all' | 'typecheck' | 'lint'

export type IssueFilter = (issue: {
  file?: string
  code: string
  severity: IssueSeverity
  origin: string
}) => boolean

export interface GolarOptions {
  cwd?: string
  mode?: GolarMode
  async?: boolean
  typecheckSeverity?: IssueSeverity
  lintSeverity?: IssueSeverity
  filter?: IssueFilter
  formatter?: 'basic' | 'codeframe'
  bin?: string
  args?: string[]
  env?: Record<string, string | undefined>
  failOnError?: boolean
}

export interface ResolvedGolarOptions {
  cwd: string
  mode: GolarMode
  async: boolean
  typecheckSeverity: IssueSeverity
  lintSeverity: IssueSeverity
  filter?: IssueFilter
  formatter: 'basic' | 'codeframe'
  bin?: string
  args: string[]
  env?: Record<string, string | undefined>
  failOnError: boolean
}

const CONFIG_FILENAMES = [
  'golar.config.ts',
  'golar.config.mts',
  'golar.config.mjs',
  'golar.config.cts',
  'golar.config.cjs',
  'golar.config.js',
]

/**
 * Looks for a golar config file, mirroring the CLI's own discovery order.
 *
 * @param cwd The directory golar will run in.
 * @returns The path of the first config found, or `undefined` if there is none.
 */
export function findGolarConfig(cwd: string): string | undefined {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(cwd, name)
    if (fs.existsSync(candidate))
      return candidate
  }

  return undefined
}

/**
 * Fills in the defaults for a set of user supplied options.
 *
 * Checking asynchronously is the default while watching, so a rebuild is never
 * held up, and off otherwise, so a one-off build fails on type errors. Lint
 * findings default to `warning` because golar exits 0 when only lint rules
 * fire, and reporting them as errors would fail builds golar considers clean.
 *
 * @param options The options given by the user.
 * @param context The working directory to fall back to, and whether this run is
 * a watch rather than a one-off build.
 * @returns Options with every field resolved.
 */
export function resolveGolarOptions(
  options: GolarOptions,
  context: { cwd: string, watch: boolean },
): ResolvedGolarOptions {
  return {
    cwd: options.cwd ? path.resolve(options.cwd) : context.cwd,
    mode: options.mode ?? 'all',
    async: options.async ?? context.watch,
    typecheckSeverity: options.typecheckSeverity ?? 'error',
    lintSeverity: options.lintSeverity ?? 'warning',
    filter: options.filter,
    formatter: options.formatter ?? 'codeframe',
    bin: options.bin,
    args: options.args ?? [],
    env: options.env,
    failOnError: options.failOnError ?? true,
  }
}

/**
 * Builds the argument list for a golar invocation.
 *
 * The `all` mode is the bare command, which is what golar recommends, so it
 * contributes no subcommand.
 *
 * @param options Resolved options carrying the mode and any extra arguments.
 * @returns The arguments to pass to the golar executable.
 */
export function getGolarArgs(options: ResolvedGolarOptions): string[] {
  const subcommand = options.mode === 'all' ? [] : [options.mode]
  return [...subcommand, ...options.args]
}
