import fs from 'node:fs'
import path from 'node:path'
import type { Issue } from './issue.js'

const CONTEXT_LINES = 2

/**
 * Renders a small excerpt of the source around the issue with a caret under the
 * offending column. Hand-rolled so the package stays dependency-free.
 */
function renderCodeFrame(file: string, line: number, column: number): string | undefined {
  let source: string
  try {
    source = fs.readFileSync(file, 'utf8')
  }
  catch {
    return undefined
  }

  const lines = source.split(/\r?\n/)
  if (line < 1 || line > lines.length)
    return undefined

  const start = Math.max(1, line - CONTEXT_LINES)
  const end = Math.min(lines.length, line + CONTEXT_LINES)
  const gutterWidth = String(end).length
  const frame: string[] = []

  for (let n = start; n <= end; n++) {
    const isTarget = n === line
    const gutter = String(n).padStart(gutterWidth, ' ')
    frame.push(`${isTarget ? '>' : ' '} ${gutter} | ${lines[n - 1] ?? ''}`)

    if (isTarget) {
      const padding = ' '.repeat(Math.max(0, column - 1))
      frame.push(`  ${' '.repeat(gutterWidth)} | ${padding}^`)
    }
  }

  return frame.join('\n')
}

export interface FormatOptions {
  /** Paths are printed relative to this directory. */
  cwd: string
  formatter: 'basic' | 'codeframe'
}

/** Human-readable rendering of a single issue. */
export function formatIssue(issue: Issue, options: FormatOptions): string {
  const parts: string[] = []
  const origin = issue.origin === 'lint' ? 'lint' : 'type'

  if (issue.file) {
    const relative = path.relative(options.cwd, issue.file) || issue.file
    const position = issue.location ? `:${issue.location.line}:${issue.location.column}` : ''
    parts.push(`${relative}${position}`)
  }

  parts.push(`${origin} ${issue.code}: ${issue.message}`)

  let result = parts.join('\n')

  if (options.formatter === 'codeframe' && issue.file && issue.location) {
    const frame = renderCodeFrame(issue.file, issue.location.line, issue.location.column)
    if (frame)
      result += `\n${frame}`
  }

  return result
}

/** Summary line such as `Found 2 errors and 1 warning.` */
export function formatIssueSummary(issues: Issue[]): string {
  const errors = issues.filter(issue => issue.severity === 'error').length
  const warnings = issues.length - errors

  if (errors === 0 && warnings === 0)
    return 'No issues found.'

  const parts: string[] = []
  if (errors > 0)
    parts.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`)
  if (warnings > 0)
    parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`)

  return `Found ${parts.join(' and ')}.`
}
