import type { Issue, ResolvedGolarOptions } from '@golar-rstack/core'

export interface DoneTap {
  name: string
  type: string
  fn: (...args: any[]) => void
}

export interface GolarPluginState {
  initialized: boolean
  watching: boolean
  options?: ResolvedGolarOptions
  /** Resolves to the issues of the most recently started run. */
  issuesPromise?: Promise<Issue[] | undefined>
  /** Cancels the in-flight run when a new build supersedes it. */
  abortController?: AbortController
  /** The dev server's own `done` tap, replayed to refresh the error overlay. */
  devServerDoneTap?: DoneTap
  iteration: number
}

export function createPluginState(): GolarPluginState {
  return { initialized: false, watching: false, iteration: 0 }
}
