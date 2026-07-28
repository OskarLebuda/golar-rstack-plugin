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
import type { DoneTap, GolarPluginState } from './state.js'
import { createPluginState } from './state.js'

const PLUGIN_NAME = 'GolarRspackPlugin'

// Dev servers whose `done` tap can be replayed to refresh the error overlay.
const DEV_SERVER_TAPS = ['webpack-dev-server', 'rspack-dev-server', 'rsbuild-dev-server']

export interface GolarRspackPluginOptions extends GolarOptions {
  devServer?: boolean
}

/**
 * Runs [golar](https://golar.dev), which type checks and lints TypeScript and
 * embedded languages such as Vue, Svelte and Astro, in a separate process, and
 * reports what it finds as Rspack errors and warnings.
 */
export class GolarRspackPlugin {
  private readonly options: GolarRspackPluginOptions

  /**
   * @param options Plugin options. See the package README for the defaults.
   */
  constructor(options: GolarRspackPluginOptions = {}) {
    this.options = options
  }

  /**
   * Registers the plugin on a compiler. Called by Rspack.
   *
   * @param compiler The compiler to attach to.
   */
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
   * the browser overlay.
   *
   * Installed from `apply` so the interceptor is in place before the dev server
   * registers its own tap.
   *
   * @param compiler The compiler being set up.
   * @param state State to store the captured tap on.
   */
  private interceptDevServerTap(compiler: Compiler, state: GolarPluginState) {
    if (this.options.devServer === false)
      return

    compiler.hooks.done.intercept({
      register: (tap) => {
        const candidate = tap as unknown as DoneTap
        if (DEV_SERVER_TAPS.includes(candidate.name) && candidate.type === 'sync')
          state.devServerDoneTap = candidate
        return tap
      },
    })
  }

  /**
   * Resolves options and installs the reporting hooks on the first run.
   *
   * This is deferred because the default for `async` depends on whether this is
   * a build or a watch, which is not known when `apply` runs.
   *
   * @param compiler The compiler being set up.
   * @param state State to mark as initialized.
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

  /**
   * Starts a golar run for each compilation, superseding any run still going.
   *
   * Runs are chained rather than overlapped, because golar is a whole project
   * check backed by a native process and concurrency would only contend for
   * CPU.
   *
   * @param compiler The compiler being set up.
   * @param state State holding the current run and its abort controller.
   * @param logger Infrastructure logger used for debug output.
   */
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

      state.issuesPromise = (state.issuesPromise ?? Promise.resolve(undefined))
        .catch(() => undefined)
        .then(async () => {
          if (abortController.signal.aborted)
            return undefined

          logger.debug(`Running golar, iteration ${iteration}.`)

          try {
            const result = await runGolar(options, abortController.signal)
            logger.debug(`golar iteration ${iteration} found ${result.issues.length} issue(s).`)
            // golar has no structured reporter, so its raw output is the only
            // way to tell a clean check apart from one whose diagnostics never
            // made it through the parser.
            logger.debug(
              `golar iteration ${iteration} exited with ${result.exitCode} and wrote:\n${result.output}`,
            )
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

  /**
   * Installs blocking reporting, where the compilation waits for golar and owns
   * the issues it found.
   *
   * @param compiler The compiler being set up.
   * @param state State holding the current run.
   */
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
   * Installs async reporting, where the build is never held up.
   *
   * Issues are logged when they arrive and, if a dev server is listening, its
   * `done` tap is replayed with the issues attached. That re-sends the stats
   * over the HMR socket, which is what makes the browser overlay show them.
   *
   * @param compiler The compiler being set up.
   * @param state State holding the current run and the captured dev server tap.
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

        // A newer build already started, so its result is the one that counts.
        if (!issues || state.issuesPromise !== issuesPromise)
          return

        const prepared = prepareIssues(issues, options)

        if (prepared.length === 0) {
          logger.info('No golar issues found.')
          return
        }

        logger.error(formatIssueSummary(prepared))

        for (const issue of prepared)
          logger.error(formatIssue(issue, { cwd: options.cwd, formatter: options.formatter }))

        if (state.devServerDoneTap) {
          pushIssues(stats.compilation, prepared, options)
          state.devServerDoneTap.fn(stats)
        }
      })()
    })
  }

  /**
   * Aborts any run still going when the compiler shuts down.
   *
   * @param compiler The compiler being set up.
   * @param state State holding the abort controller.
   */
  private tapCloseToAbort(compiler: Compiler, state: GolarPluginState) {
    const abort = () => {
      state.abortController?.abort()
      state.abortController = undefined
    }

    compiler.hooks.watchClose.tap(PLUGIN_NAME, abort)
    compiler.hooks.shutdown?.tap(PLUGIN_NAME, abort)
  }
}
