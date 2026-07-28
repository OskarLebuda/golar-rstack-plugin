# golar-rstack-plugin

Run [golar](https://golar.dev), which provides native-speed type checking and
type-aware linting built on `typescript-go`, as part of your Rspack or Rsbuild
build, in a separate process.

This is to golar what `ts-checker-rspack-plugin` / `fork-ts-checker-webpack-plugin`
are to `tsc`. The difference is what golar can check: it understands **embedded
languages**, so type errors inside `.vue`, `.svelte`, `.astro` and `.gts` files
are reported at their real position in the source file.

## Packages

| Package | Description |
| --- | --- |
| [`@golar-rstack/rsbuild`](./packages/rsbuild) | Rsbuild plugin |
| [`@golar-rstack/rspack`](./packages/rspack) | Rspack plugin |
| [`@golar-rstack/core`](./packages/core) | Shared runner and diagnostic parsing |

## Quick start

```bash
pnpm add -D @golar-rstack/rsbuild golar
```

golar is driven by its own config file, which it discovers in the working
directory. Create `golar.config.ts` in your project root:

```ts
import { defineConfig } from 'golar/unstable'
import '@golar/vue'

export default defineConfig({})
```

Then register the plugin:

```ts
// rsbuild.config.ts
import { pluginGolar } from '@golar-rstack/rsbuild'
import { defineConfig } from '@rsbuild/core'
import { pluginVue } from '@rsbuild/plugin-vue'

export default defineConfig({
  plugins: [pluginVue(), pluginGolar()],
})
```

For plain Rspack:

```ts
// rspack.config.ts
import { GolarRspackPlugin } from '@golar-rstack/rspack'

export default {
  plugins: [new GolarRspackPlugin()],
}
```

## How it behaves

**In `build`** the compilation waits for golar, so type errors fail the build:

```
error   Build error:
File: src/App.vue:8:7
  × src/App.vue:8:7
  │ type TS2322: Type 'number' is not assignable to type 'string'.
  │    7 | // Type error inside an SFC
  │ >  8 | const label: string = double(count.value)
  │      |       ^
```

**In `dev`** the check runs asynchronously so it never delays HMR. Results
arrive in the terminal shortly after the build, and are pushed into the browser
error overlay.

Each build supersedes the previous check. An in-flight golar run is killed when
a new compilation starts, so a fast edit loop never queues up stale results.

## Options

```ts
pluginGolar({
  mode: 'all',                  // 'all' | 'typecheck' | 'lint'
  cwd: process.cwd(),           // where golar.config.* lives
  async: undefined,             // default: true in dev, false in build
  typecheckSeverity: 'error',
  lintSeverity: 'warning',
  formatter: 'codeframe',       // 'codeframe' | 'basic'
  failOnError: true,
  devServer: true,
  filter: issue => true,
  bin: undefined,               // custom golar executable
  args: [],                     // extra CLI arguments
  env: undefined,
})
```

### `mode`

Maps to golar's subcommands: `all` runs the bare `golar` command (lint +
typecheck, golar's recommended mode), `typecheck` and `lint` run only that
phase.

### `lintSeverity`

Lint findings default to `warning` rather than `error`, because **golar itself
exits 0 when only lint rules fire**. Reporting them as errors would fail builds
that golar considers passing. Set it to `'error'` if you want them to block.

### `cwd`

golar has no `--config` flag. It discovers `golar.config.*` relative to its
working directory, so this option is how the config gets selected. It defaults
to the Rsbuild root or the Rspack context.

## Requirements

- Node.js >= 22.12 (golar's own requirement)
- `golar` installed in the project

## Caveats

golar has no watch mode and no structured reporter, which shapes two things:

- **Every check is a full project run.** There is no incremental session to
  reuse, so large projects re-check from scratch on each build. golar is fast
  enough that this is usually fine, but it is not the incremental behaviour
  `tsc --watch` gives you.
- **Diagnostics are recovered by parsing stdout.** golar's output format is not
  a stable API, so a future release could change it. The parser is covered by
  tests pinned to the formats emitted by golar 0.1.10.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter playground-rsbuild-vue dev
```

## License

MIT
