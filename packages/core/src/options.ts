import fs from 'node:fs'
import path from 'node:path'
import type { IssueSeverity } from './issue.js'

/** Which golar subcommand to run. */
export type GolarMode = 'all' | 'typecheck' | 'lint'

export type IssueFilter = (issue: {
  file?: string
  code: string
  severity: IssueSeverity
  origin: string
}) => boolean

export interface GolarOptions {
  /**
   * Directory golar runs in. golar has no `--config` flag — it discovers
   * `golar.config.*` relative to its working directory, so this is how the
   * config is selected. Defaults to the compiler context.
   */
  cwd?: string
  /**
   * `all` runs lint + typecheck (golar's default and recommended mode),
   * `typecheck` and `lint` run only that phase.
   * @default 'all'
   */
  mode?: GolarMode
  /**
   * Report issues without blocking the compilation. Errors arrive after the
   * build finishes, which keeps HMR fast.
   * @default true in watch/dev, false otherwise
   */
  async?: boolean
  /**
   * Severity used for typecheck diagnostics.
   * @default 'error'
   */
  typecheckSeverity?: IssueSeverity
  /**
   * Severity used for lint diagnostics. Defaults to `warning` because golar
   * itself exits 0 when only lint rules fire.
   * @default 'warning'
   */
  lintSeverity?: IssueSeverity
  /** Drop issues for which this returns `false`. */
  filter?: IssueFilter
  /**
   * How issues are rendered.
   * @default 'codeframe'
   */
  formatter?: 'basic' | 'codeframe'
  /** Path to the golar executable. Resolved from `cwd` when omitted. */
  bin?: string
  /** Extra arguments appended to the golar invocation. */
  args?: string[]
  /** Environment overrides for the golar process. */
  env?: Record<string, string | undefined>
  /**
   * Fail the build when issues are found.
   * @default true
   */
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

/** Mirrors the CLI's own discovery order. */
export function findGolarConfig(cwd: string): string | undefined {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(cwd, name)
    if (fs.existsSync(candidate))
      return candidate
  }
  return undefined
}

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

/** golar's subcommand for a mode — `all` is the bare invocation. */
export function getGolarArgs(options: ResolvedGolarOptions): string[] {
  const subcommand = options.mode === 'all' ? [] : [options.mode]
  return [...subcommand, ...options.args]
}
