import path from 'node:path'
import type { Issue, IssueSeverity } from './issue.js'

const ANSI_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

/**
 * Typecheck diagnostics use the plain (non-`--pretty`) tsc layout:
 *   src/App.vue(2,7): error TS2322: Type 'string' is not assignable to type 'number'.
 */
const TYPECHECK_PATTERN = /^(.+?)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/

/**
 * Lint diagnostics use a different layout — colon separated, rule name in place
 * of the TS code, and no severity word:
 *   src/lintme.ts:1:22: explicit-anys: Unexpected any. Specify a different type.
 */
const LINT_PATTERN = /^(.+?):(\d+):(\d+): ([\w@/-]+): (.*)$/

/**
 * Project-wide diagnostics carry no file position:
 *   error TS5083: Cannot read file 'tsconfig.json'.
 */
const GLOBAL_PATTERN = /^(error|warning) (TS\d+): (.*)$/

/** Emitted by the CLI before any diagnostics; not an issue. */
const HEADER_PATTERN = /^Using config from /

export interface ParseOptions {
  /** Directory the golar CLI ran in; relative paths resolve against it. */
  cwd: string
  /** Severity applied to typecheck diagnostics. */
  typecheckSeverity: IssueSeverity
  /** Severity applied to lint diagnostics. */
  lintSeverity: IssueSeverity
}

function resolveFile(cwd: string, file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(cwd, file)
}

/**
 * Parses golar's stdout into structured issues.
 *
 * golar has no machine-readable reporter, so this consumes the human output.
 * Continuation lines (TypeScript's elaborations) are indented and get folded
 * into the message of the diagnostic that opened them.
 */
export function parseGolarOutput(output: string, options: ParseOptions): Issue[] {
  const { cwd, typecheckSeverity, lintSeverity } = options
  const issues: Issue[] = []
  let current: Issue | undefined

  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.length === 0)
      continue

    // Indented lines elaborate on the diagnostic above them.
    if (/^\s/.test(line)) {
      if (current)
        current.message += `\n${line}`
      continue
    }

    if (HEADER_PATTERN.test(line)) {
      current = undefined
      continue
    }

    const typecheck = TYPECHECK_PATTERN.exec(line)
    if (typecheck) {
      const [, file, lineNo, column, severity, code, message] = typecheck
      current = {
        // `message`-level diagnostics are informational; never fail a build on them.
        severity: severity === 'message' ? 'warning' : typecheckSeverity,
        code: code!,
        message: message!,
        origin: 'typecheck',
        file: resolveFile(cwd, file!),
        location: { line: Number(lineNo), column: Number(column) },
      }
      issues.push(current)
      continue
    }

    const lint = LINT_PATTERN.exec(line)
    if (lint) {
      const [, file, lineNo, column, rule, message] = lint
      current = {
        severity: lintSeverity,
        code: rule!,
        message: message!,
        origin: 'lint',
        file: resolveFile(cwd, file!),
        location: { line: Number(lineNo), column: Number(column) },
      }
      issues.push(current)
      continue
    }

    const global = GLOBAL_PATTERN.exec(line)
    if (global) {
      const [, severity, code, message] = global
      current = {
        severity: severity === 'warning' ? 'warning' : typecheckSeverity,
        code: code!,
        message: message!,
        origin: 'typecheck',
      }
      issues.push(current)
      continue
    }

    // Anything else is CLI chatter (warnings from Node, stack traces on crash).
    // It is surfaced separately by the runner when the process fails.
    current = undefined
  }

  return issues
}
