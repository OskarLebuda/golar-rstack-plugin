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
 * In `dev` the check runs asynchronously so it never delays HMR; results land
 * in the terminal and the browser error overlay. In `build` the compilation
 * waits for golar, so type errors fail the build.
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
            // Rsbuild's root is the natural place to look for golar.config.*.
            cwd: options.cwd ?? api.context.rootPath,
          }),
        )
      })
    },
  }
}

export default pluginGolar
