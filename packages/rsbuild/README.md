# @golar-rstack/rsbuild

Run [golar](https://golar.dev) type checking and type-aware linting alongside
your Rsbuild build, in a separate process.

Because golar is built on `typescript-go` and understands embedded languages,
type errors inside `.vue`, `.svelte`, `.astro` and `.gts` files are reported at
their real position in the source file.

## Install

```bash
pnpm add -D @golar-rstack/rsbuild golar
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
// rsbuild.config.ts
import { pluginGolar } from '@golar-rstack/rsbuild'
import { defineConfig } from '@rsbuild/core'
import { pluginVue } from '@rsbuild/plugin-vue'

export default defineConfig({
  plugins: [pluginVue(), pluginGolar()],
})
```

In `dev` the check runs asynchronously so it never delays HMR; results land in
the terminal and the browser error overlay. In `build` the compilation waits for
golar, so type errors fail the build.

## Options

See the [repository README](https://github.com/OskarLebuda/golar-rstack-plugin#options)
for the full list. Two worth knowing up front:

- `lintSeverity` defaults to `'warning'`, because golar exits 0 when only lint
  rules fire.
- `cwd` defaults to Rsbuild's `rootPath` and is what selects the golar config,
  since golar has no `--config` flag.

## Requirements

- Node.js >= 22.12
- `golar` installed in the project

## License

MIT
