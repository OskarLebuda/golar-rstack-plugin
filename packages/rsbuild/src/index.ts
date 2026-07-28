import type { RsbuildPlugin } from '@rsbuild/core'
import type { GolarRspackPluginOptions } from '@golar-rstack/rspack'
import { GolarRspackPlugin } from '@golar-rstack/rspack'

export type { GolarRspackPluginOptions as GolarPluginOptions }
export type {
  GolarMode,
  GolarOptions,
  Issue,
  IssueFilter,
  IssueOrigin,
  IssueSeverity,
} from '@golar-rstack/rspack'

/**
 * Runs [golar](https://golar.dev) type checking and linting alongside the
 * Rsbuild compilation, in a separate process.
 *
 * While developing, the check runs asynchronously so it never delays HMR, and
 * results land in the terminal and the browser error overlay. During a build
 * the compilation waits for golar, so type errors fail the build.
 *
 * @param options Plugin options. `cwd` defaults to Rsbuild's `rootPath`, which
 * is where `golar.config.*` normally lives. See the package README for the
 * remaining defaults.
 * @returns The Rsbuild plugin to add to your config.
 */
export function pluginGolar(options: GolarRspackPluginOptions = {}): RsbuildPlugin {
  return {
    name: 'golar-rstack:rsbuild',

    setup(api) {
      api.modifyRspackConfig((config) => {
        config.plugins ??= []
        config.plugins.push(
          new GolarRspackPlugin({
            ...options,
            cwd: options.cwd ?? api.context.rootPath,
          }),
        )
      })
    },
  }
}

export default pluginGolar
