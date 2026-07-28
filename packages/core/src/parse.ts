import path from 'node:path'
import type { Issue, IssueSeverity } from './issue.js'

// Matching the escape character is the whole point of stripping ANSI codes.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g

// Typecheck diagnostics use the plain (non `--pretty`) tsc layout:
//   src/App.vue(2,7): error TS2322: Type 'string' is not assignable to type 'number'.
const TYPECHECK_PATTERN = /^(.+?)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/

// With colour enabled the type checker switches to tsc's `--pretty` layout,
// which separates the position with a dash and follows the message with a
// source frame:
//   src/App.vue:2:7 - error TS2322: Type 'string' is not assignable to type 'number'.
// The runner pins colour off, so this only comes up when a caller overrides the
// environment, but a diagnostic silently dropped for looking different is the
// worst way to find that out.
const TYPECHECK_PRETTY_PATTERN = /^(.+?):(\d+):(\d+) - (error|warning|message) (TS\d+): (.*)$/

// Lint diagnostics use an unrelated layout: colon separated, rule name in place
// of the TS code, and no severity word:
//   src/lintme.ts:1:22: explicit-anys: Unexpected any. Specify a different type.
const LINT_PATTERN = /^(.+?):(\d+):(\d+): ([\w@/-]+): (.*)$/

// Project wide diagnostics carry no file position:
//   error TS5083: Cannot read file 'tsconfig.json'.
const GLOBAL_PATTERN = /^(error|warning) (TS\d+): (.*)$/

// Printed by the CLI before any diagnostics.
const HEADER_PATTERN = /^Using config from /

export interface ParseOptions {
  cwd: string
  typecheckSeverity: IssueSeverity
  lintSeverity: IssueSeverity
}

/**
 * Removes ANSI colour escape sequences from a string.
 *
 * @param value The text to clean.
 * @returns The text without escape sequences.
 */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

/**
 * Resolves a path reported by golar against the directory it ran in.
 *
 * @param cwd The working directory of the golar process.
 * @param file The path as printed by golar, absolute or relative.
 * @returns An absolute path.
 */
function resolveFile(cwd: string, file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(cwd, file)
}

/**
 * Parses golar's output into structured issues.
 *
 * golar has no machine readable reporter, so this consumes the human output.
 * Indented continuation lines are TypeScript's elaborations and get folded into
 * the message of the diagnostic that opened them. Lines matching nothing are
 * CLI chatter, such as Node warnings or a stack trace from a crash, and are
 * skipped. The runner surfaces those separately when the process fails.
 *
 * @param output The combined stdout and stderr of a golar run.
 * @param options Working directory and the severity to apply to each phase.
 * @returns The issues found, in the order golar reported them.
 */
export function parseGolarOutput(output: string, options: ParseOptions): Issue[] {
  const { cwd, typecheckSeverity, lintSeverity } = options
  const issues: Issue[] = []
  let current: Issue | undefined

  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.length === 0)
      continue

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
        // Informational diagnostics never fail a build.
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

    const pretty = TYPECHECK_PRETTY_PATTERN.exec(line)
    if (pretty) {
      const [, file, lineNo, column, severity, code, message] = pretty
      issues.push({
        severity: severity === 'message' ? 'warning' : typecheckSeverity,
        code: code!,
        message: message!,
        origin: 'typecheck',
        file: resolveFile(cwd, file!),
        location: { line: Number(lineNo), column: Number(column) },
      })
      // What follows a pretty diagnostic is its source frame, not an
      // elaboration, so nothing here accepts continuation lines.
      current = undefined
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

    current = undefined
  }

  return issues
}
