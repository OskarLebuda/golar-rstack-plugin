import type { Issue, ResolvedGolarOptions } from '@golar-rstack/core'
import { formatIssue } from '@golar-rstack/core'
import { GolarIssueError } from './error.js'

/** Applies the user's filter and the `failOnError` downgrade. */
export function prepareIssues(issues: Issue[], options: ResolvedGolarOptions): Issue[] {
  const filtered = options.filter ? issues.filter(issue => options.filter!(issue)) : issues

  if (options.failOnError)
    return filtered

  // Keep reporting, but never break the build.
  return filtered.map(issue => (issue.severity === 'error' ? { ...issue, severity: 'warning' as const } : issue))
}

interface CompilationLike {
  errors: unknown[]
  warnings: unknown[]
}

/** Pushes issues onto a compilation so Rspack reports and counts them. */
export function pushIssues(
  compilation: CompilationLike,
  issues: Issue[],
  options: ResolvedGolarOptions,
): void {
  for (const issue of issues) {
    const error = new GolarIssueError(
      formatIssue(issue, { cwd: options.cwd, formatter: options.formatter }),
      issue,
    )

    if (issue.severity === 'warning')
      compilation.warnings.push(error)
    else
      compilation.errors.push(error)
  }
}
