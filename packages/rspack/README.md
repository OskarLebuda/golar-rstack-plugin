# @golar-rstack/rspack

Run [golar](https://golar.dev) type checking and type-aware linting in a
separate process as an Rspack plugin.

Because golar is built on `typescript-go` and understands embedded languages,
type errors inside `.vue`, `.svelte`, `.astro` and `.gts` files are reported at
their real position in the source file.

Using Rsbuild? Use [`@golar-rstack/rsbuild`](https://www.npmjs.com/package/@golar-rstack/rsbuild)
instead.

## Install

```bash
pnpm add -D @golar-rstack/rspack golar
```

## Usage

Create `golar.config.ts` in your project root. golar discovers it relative to
its working directory:

```ts
import { defineConfig } from 'golar/unstable'
import '@golar/vue'

export default defineConfig({})
```

```ts
// rspack.config.ts
import { GolarRspackPlugin } from '@golar-rstack/rspack'

export default {
  plugins: [new GolarRspackPlugin()],
}
```

In watch mode the check runs asynchronously and is pushed to the dev server's
error overlay. In a one-off build the compilation waits for golar, so type
errors fail the build.

## Options

See the [repository README](https://github.com/OskarLebuda/golar-rstack-plugin#options)
for the full list. Two worth knowing up front:

- `lintSeverity` defaults to `'warning'`, because golar exits 0 when only lint
  rules fire.
- `cwd` defaults to the compiler `context` and is what selects the golar config,
  since golar has no `--config` flag.

## Requirements

- Node.js >= 22.12
- `golar` installed in the project

## License

MIT
