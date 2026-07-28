import type { Compiler } from '@rspack/core'
import type { GolarOptions, Issue } from '@golar-rstack/core'
import {
  GolarAbortError,
  formatIssue,
  formatIssueSummary,
  resolveGolarOptions,
  runGolar,
} from '@golar-rstack/core'
import { prepareIssues, pushIssues } from './report.js'
import type { GolarPluginState } from './state.js'
import { createPluginState } from './state.js'

const PLUGIN_NAME = 'GolarRspackPlugin'

/** Dev servers whose `done` tap can be replayed to refresh the error overlay. */
const DEV_SERVER_TAPS = ['webpack-dev-server', 'rspack-dev-server', 'rsbuild-dev-server']

export interface GolarRspackPluginOptions extends GolarOptions {
  /**
   * Push asynchronously-found issues to the dev server so they appear in the
   * browser error overlay.
   * @default true
   */
  devServer?: boolean
}

/**
 * Runs [golar](https://golar.dev) — type checking and linting for TypeScript
 * and embedded languages (Vue, Svelte, Astro, Ember) — in a separate process,
 * and reports what it finds as Rspack errors and warnings.
 */
export class GolarRspackPlugin {
  private readonly options: GolarRspackPluginOptions

  constructor(options: GolarRspackPluginOptions = {}) {
    this.options = options
  }

  apply(compiler: Compiler): void {
    const state = createPluginState()
    const logger = compiler.getInfrastructureLogger(PLUGIN_NAME)

    this.interceptDevServerTap(compiler, state)
    this.tapInitialization(compiler, state)
    this.tapCompilationToRunGolar(compiler, state, logger)
    this.tapCloseToAbort(compiler, state)
  }

  /**
   * Records the dev server's `done` tap so async results can be replayed into
   * the overlay. Installed in `apply` so the interceptor is in place before the
   * dev server registers its own tap.
   */
  private interceptDevServerTap(compiler: Compiler, state: GolarPluginState) {
    if (this.options.devServer === false)
      return

    compiler.hooks.done.intercept({
      register: (tap: any) => {
        if (DEV_SERVER_TAPS.includes(tap.name) && tap.type === 'sync')
          state.devServerDoneTap = tap
        return tap
      },
    })
  }

  /**
   * `async` defaults differ between build and watch, so options are resolved on
   * the first run — that is the earliest point where the mode is known.
   */
  private tapInitialization(compiler: Compiler, state: GolarPluginState) {
    const initialize = (watching: boolean) => {
      if (state.initialized)
        return
      state.initialized = true
      state.watching = watching
      state.options = resolveGolarOptions(this.options, {
        cwd: compiler.context ?? process.cwd(),
        watch: watching,
      })

      if (state.options.async)
        this.tapDoneToReportAsync(compiler, state)
      else
        this.tapAfterCompileToReport(compiler, state)
    }

    compiler.hooks.run.tap(PLUGIN_NAME, () => initialize(false))
    compiler.hooks.watchRun.tap(PLUGIN_NAME, () => initialize(true))
  }

  /** Starts a golar run for each compilation, superseding any in-flight run. */
  private tapCompilationToRunGolar(
    compiler: Compiler,
    state: GolarPluginState,
    logger: ReturnType<Compiler['getInfrastructureLogger']>,
  ) {
    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
      // Only react to the compiler this plugin was registered on, not children.
      if (compilation.compiler !== compiler)
        return

      const options = state.options
      if (!options)
        return

      const iteration = ++state.iteration

      state.abortController?.abort()
      const abortController = new AbortController()
      state.abortController = abortController

      // Chain rather than overlap: golar is a full-project check backed by a
      // native process, so two concurrent runs would just contend for CPU.
      state.issuesPromise = (state.issuesPromise ?? Promise.resolve(undefined))
        .catch(() => undefined)
        .then(async () => {
          if (abortController.signal.aborted)
            return undefined

          logger.debug(`Running golar, iteration ${iteration}.`)

          try {
            const result = await runGolar(options, abortController.signal)
            logger.debug(`golar iteration ${iteration} found ${result.issues.length} issue(s).`)
            return result.issues
          }
          catch (error) {
            if (error instanceof GolarAbortError) {
              logger.debug(`golar iteration ${iteration} aborted.`)
              return undefined
            }
            // Configuration and resolution failures surface on the compilation.
            compilation.errors.push(error as Error)
            return undefined
          }
          finally {
            if (state.abortController === abortController)
              state.abortController = undefined
          }
        })
    })
  }

  /** Blocking mode: the compilation waits for golar and owns its issues. */
  private tapAfterCompileToReport(compiler: Compiler, state: GolarPluginState) {
    compiler.hooks.afterCompile.tapPromise(PLUGIN_NAME, async (compilation) => {
      if (compilation.compiler !== compiler || !state.options)
        return

      const issues = await state.issuesPromise
      if (!issues)
        return

      pushIssues(compilation, prepareIssues(issues, state.options), state.options)
    })
  }

  /**
   * Async mode: the build is never held up. Issues are logged when they arrive
   * and, if a dev server is listening, replayed into its `done` tap so the
   * browser overlay updates.
   */
  private tapDoneToReportAsync(compiler: Compiler, state: GolarPluginState) {
    const logger = compiler.getInfrastructureLogger(PLUGIN_NAME)

    compiler.hooks.done.tap(PLUGIN_NAME, (stats) => {
      if (stats.compilation.compiler !== compiler || !state.options)
        return

      const options = state.options
      const issuesPromise = state.issuesPromise

      void (async () => {
        let issues: Issue[] | undefined
        try {
          issues = await issuesPromise
        }
        catch {
          return
        }

        // A newer build already started; its result is the one that counts.
        if (!issues || state.issuesPromise !== issuesPromise)
          return

        const prepared = prepareIssues(issues, options)

        if (prepared.length === 0) {
          logger.info('No golar issues found.')
          return
        }

        logger.error(formatIssueSummary(prepared))

        for (const issue of prepared) {
          logger.error(formatIssue(issue, {
            cwd: options.cwd,
            formatter: options.formatter,
          }))
        }

        // Replaying the dev server's tap re-sends the stats over the HMR
        // socket, which is what makes the browser overlay pick these up.
        if (state.devServerDoneTap) {
          pushIssues(stats.compilation, prepared, options)
          state.devServerDoneTap.fn(stats)
        }
      })()
    })
  }

  private tapCloseToAbort(compiler: Compiler, state: GolarPluginState) {
    const abort = () => {
      state.abortController?.abort()
      state.abortController = undefined
    }

    compiler.hooks.watchClose.tap(PLUGIN_NAME, abort)
    compiler.hooks.shutdown?.tap(PLUGIN_NAME, abort)
  }
}
