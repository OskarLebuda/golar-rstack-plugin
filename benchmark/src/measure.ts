import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface BuildOutcome {
  durationMs: number
  modules: number
  /** Diagnostics as `file TScode`, sorted, for comparing tools against each other. */
  found: string[]
}

/**
 * Runs one measured compilation in a fresh process.
 *
 * @param runner Path of the per-run script.
 * @param tool Which plugin to measure, or `none` for the bundler baseline.
 * @param caseDir The generated project to check.
 * @returns What that compilation cost and found.
 * @throws If the child fails or writes something unparseable.
 */
export async function runBuild(
  runner: string,
  tool: string,
  caseDir: string,
): Promise<BuildOutcome> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--experimental-strip-types', runner, tool, caseDir],
    // Colour changes how diagnostics are laid out, and they are compared as text.
    { env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }, maxBuffer: 64 * 1024 * 1024 },
  )

  const line = stdout.trim().split('\n').at(-1) ?? ''
  const parsed = JSON.parse(line) as BuildOutcome & { failed?: string }

  if (parsed.failed)
    throw new Error(`${tool} failed: ${parsed.failed}`)

  return parsed
}

/**
 * Picks the middle value of a set of samples.
 *
 * The median rather than the mean, because one scheduling hiccup would drag an
 * average somewhere no run ever was.
 *
 * @param values The samples.
 * @returns The median.
 */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}
