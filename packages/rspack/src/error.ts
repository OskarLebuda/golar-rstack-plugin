import path from 'node:path'
import process from 'node:process'
import type { Issue } from '@golar-rstack/core'

/**
 * An error shaped the way Rspack expects.
 *
 * Rspack only renders `loc` for errors carrying a real `NormalModule`, which
 * this plugin has no way to supply, so the position is folded into `file`
 * instead. This is the same workaround ts-checker-rspack-plugin uses.
 */
export class GolarIssueError extends Error {
  readonly hideStack = true
  file?: string

  /**
   * @param message The formatted text Rspack will display.
   * @param issue The issue this error was built from, kept so consumers can
   * inspect the original diagnostic.
   */
  constructor(message: string, readonly issue: Issue) {
    super(message)
    this.name = 'GolarIssueError'

    if (issue.file) {
      const relative = path.relative(process.cwd(), issue.file)
      this.file = relative.startsWith('..') ? issue.file : relative

      if (issue.location)
        this.file += `:${issue.location.line}:${issue.location.column}`
    }

    Error.captureStackTrace(this, this.constructor)
  }
}
