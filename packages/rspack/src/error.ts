import path from 'node:path'
import process from 'node:process'
import type { Issue } from '@golar-rstack/core'

/**
 * Error shape Rspack understands.
 *
 * Rspack renders `loc` only for errors carrying a real `module` (a
 * NormalModule instance). We have no module to attach, so the location is
 * folded into `file` instead — the same workaround ts-checker-rspack-plugin
 * uses.
 */
export class GolarIssueError extends Error {
  readonly hideStack = true
  file?: string

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
