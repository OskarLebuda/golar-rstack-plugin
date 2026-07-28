# @golar-rstack/core

Shared internals for the [golar](https://golar.dev) Rstack plugins: spawning the
golar CLI, parsing its diagnostics, and formatting issues.

You usually want [`@golar-rstack/rsbuild`](https://www.npmjs.com/package/@golar-rstack/rsbuild)
or [`@golar-rstack/rspack`](https://www.npmjs.com/package/@golar-rstack/rspack)
instead. This package is published for reuse by other bundler integrations.

## Why a parser

golar ships no machine-readable reporter, so diagnostics are recovered from
stdout. It emits two unrelated layouts:

```
typecheck   src/App.vue(2,7): error TS2322: Type 'string' is not assignable to type 'number'.
lint        src/math.ts:6:33: explicit-anys: Unexpected any. Specify a different type.
```

Indented lines elaborate on the diagnostic above them and are folded into its
message. This is not a stable API. The parser is covered by tests pinned to the
formats emitted by golar 0.1.10.

## Usage

```ts
import { formatIssue, resolveGolarOptions, runGolar } from '@golar-rstack/core'

const options = resolveGolarOptions({ mode: 'all' }, { cwd: process.cwd(), watch: false })
const { issues } = await runGolar(options)

for (const issue of issues)
  console.log(formatIssue(issue, { cwd: options.cwd, formatter: 'codeframe' }))
```

`runGolar` accepts an `AbortSignal`; aborting kills the child process, which is
how a new build cancels an in-flight check.

## License

MIT
