import type { Issue, ResolvedGolarOptions } from '@golar-rstack/core'
import { formatIssue } from '@golar-rstack/core'
import { GolarIssueError } from './error.js'

interface CompilationLike {
  errors: unknown[]
  warnings: unknown[]
}

/**
 * Applies the user's filter and the `failOnError` downgrade to a set of issues.
 *
 * When `failOnError` is off, errors become warnings rather than being dropped,
 * so problems stay visible without breaking the build.
 *
 * @param issues The issues reported by golar.
 * @param options Resolved options carrying the filter and the failure policy.
 * @returns The issues to report, which may be the input array unchanged.
 */
export function prepareIssues(issues: Issue[], options: ResolvedGolarOptions): Issue[] {
  const filtered = options.filter ? issues.filter(issue => options.filter!(issue)) : issues

  if (options.failOnError)
    return filtered

  return filtered.map(issue =>
    issue.severity === 'error' ? { ...issue, severity: 'warning' as const } : issue,
  )
}

/**
 * Attaches issues to a compilation so Rspack reports and counts them.
 *
 * @param compilation The compilation to push onto. Mutated in place.
 * @param issues The issues to report, already passed through `prepareIssues`.
 * @param options Resolved options controlling how each issue is formatted.
 */
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
