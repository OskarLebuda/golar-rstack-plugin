import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import type { Issue } from './issue.js'
import { createInternalIssue, dedupeIssues, sortIssues } from './issue.js'
import type { ResolvedGolarOptions } from './options.js'
import { findGolarConfig, getGolarArgs } from './options.js'
import { parseGolarOutput, stripAnsi } from './parse.js'

export class GolarAbortError extends Error {
  constructor() {
    super('golar run aborted')
    this.name = 'GolarAbortError'
  }
}

export interface GolarRunResult {
  issues: Issue[]
  /** Raw combined output, kept for diagnostics when the CLI misbehaves. */
  output: string
  exitCode: number | null
  aborted: boolean
}

/**
 * Locates golar's entrypoint by walking up from `cwd`.
 *
 * `require.resolve('golar/package.json')` is not an option: golar's exports map
 * only exposes `./unstable` and `./unstable-tsgo`.
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

function createCommand(options: ResolvedGolarOptions): { command: string, args: string[] } {
  if (options.bin) {
    // An explicit .js entrypoint still needs a node host; anything else is
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
 * Runs golar once and returns the issues it reported.
 *
 * golar has no watch mode and no structured reporter, so every check is a fresh
 * process whose stdout gets parsed.
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
      env: options.env ? { ...process.env, ...options.env } : process.env,
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

        // A non-zero exit with nothing parsed means golar itself failed (bad
        // config, missing native addon, crash). Surface the output rather than
        // silently reporting a clean check.
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
