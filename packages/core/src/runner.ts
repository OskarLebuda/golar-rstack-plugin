import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import type { Issue } from './issue.js'
import { createInternalIssue, dedupeIssues, sortIssues } from './issue.js'
import type { ResolvedGolarOptions } from './options.js'
import { findGolarConfig, getGolarArgs } from './options.js'
import { parseGolarOutput, stripAnsi } from './parse.js'

// golar's diagnostics are parsed, not shown, and colour changes their layout:
// with it on, the type checker switches to tsc's `--pretty` form, where a
// diagnostic reads `file:line:col - error TS1234:` instead of
// `file(line,col): error TS1234:`. Test runners and CI providers set
// FORCE_COLOR on the processes they spawn, so the format has to be pinned here
// rather than left to whatever the host decided.
const PLAIN_OUTPUT_ENV = {
  FORCE_COLOR: '0',
  NO_COLOR: '1',
}

export class GolarAbortError extends Error {
  constructor() {
    super('golar run aborted')
    this.name = 'GolarAbortError'
  }
}

export interface GolarRunResult {
  issues: Issue[]
  output: string
  exitCode: number | null
  aborted: boolean
}

/**
 * Locates golar's entrypoint by walking up the directory tree.
 *
 * `require.resolve('golar/package.json')` is not an option, because golar's
 * exports map only exposes `./unstable` and `./unstable-tsgo`.
 *
 * @param cwd The directory to start searching from.
 * @returns The path of `golar/dist/bin.js`, or `undefined` if golar is not
 * installed anywhere above `cwd`.
 */
export function resolveGolarBin(cwd: string): string | undefined {
  let dir = path.resolve(cwd)

  while (true) {
    const entry = path.join(dir, 'node_modules', 'golar', 'dist', 'bin.js')
    if (fs.existsSync(entry))
      return entry

    const parent = path.dirname(dir)
    if (parent === dir)
      return undefined
    dir = parent
  }
}

/**
 * Works out how to launch golar.
 *
 * @param options Resolved options, whose `bin` field overrides the lookup.
 * @returns The command to run and the arguments that select the entrypoint.
 * @throws If golar cannot be found and no `bin` was given.
 */
function createCommand(options: ResolvedGolarOptions): { command: string, args: string[] } {
  if (options.bin) {
    // An explicit .js entrypoint still needs a node host. Anything else is
    // assumed to be directly executable.
    return options.bin.endsWith('.js')
      ? { command: process.execPath, args: [options.bin] }
      : { command: options.bin, args: [] }
  }

  const resolved = resolveGolarBin(options.cwd)
  if (!resolved) {
    throw new Error(
      `Could not find the "golar" package from "${options.cwd}". `
      + 'Install it with `pnpm add -D golar`, or set the `bin` option.',
    )
  }

  return { command: process.execPath, args: [resolved] }
}

/**
 * Runs golar once and collects the issues it reports.
 *
 * golar has no watch mode and no structured reporter, so every check is a fresh
 * process whose output gets parsed. A non-zero exit that yields no issues means
 * golar itself failed, and the raw output is reported instead of a clean check.
 *
 * @param options Resolved options describing where and how to run golar.
 * @param signal Aborting this kills the child process, which is how a new build
 * cancels a check that is still running.
 * @returns The issues found, along with the raw output and exit code.
 * @throws {GolarAbortError} If `signal` is aborted before or during the run.
 * @throws If no golar config exists in the working directory, or golar cannot
 * be located or spawned.
 */
export async function runGolar(
  options: ResolvedGolarOptions,
  signal?: AbortSignal,
): Promise<GolarRunResult> {
  if (signal?.aborted)
    throw new GolarAbortError()

  if (!findGolarConfig(options.cwd)) {
    throw new Error(
      `No golar config found in "${options.cwd}". `
      + 'Create a `golar.config.ts` there, or point the `cwd` option at the directory that has one.',
    )
  }

  const { command, args: commandArgs } = createCommand(options)
  const args = [...commandArgs, ...getGolarArgs(options)]

  return await new Promise<GolarRunResult>((resolve, reject) => {
    let settled = false
    let output = ''

    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // A caller who sets these explicitly gets what they asked for, including
      // colour, which the parser then has to cope with.
      env: { ...process.env, ...PLAIN_OUTPUT_ENV, ...options.env },
    })

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      child.stdout?.removeAllListeners()
      child.stderr?.removeAllListeners()
      child.removeAllListeners()
    }

    const settle = (fn: () => void) => {
      if (settled)
        return
      settled = true
      cleanup()
      fn()
    }

    function onAbort() {
      child.kill('SIGKILL')
      settle(() => reject(new GolarAbortError()))
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.on('error', error => settle(() => reject(error)))

    child.on('close', (exitCode) => {
      settle(() => {
        const issues = sortIssues(dedupeIssues(parseGolarOutput(output, {
          cwd: options.cwd,
          typecheckSeverity: options.typecheckSeverity,
          lintSeverity: options.lintSeverity,
        })))

        if (exitCode !== 0 && issues.length === 0) {
          issues.push(createInternalIssue(
            `golar exited with code ${exitCode}.\n${stripAnsi(output).trim()}`,
          ))
        }

        resolve({ issues, output, exitCode, aborted: false })
      })
    })
  })
}
