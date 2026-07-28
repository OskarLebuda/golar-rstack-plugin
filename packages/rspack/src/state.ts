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
  issuesPromise?: Promise<Issue[] | undefined>
  abortController?: AbortController
  devServerDoneTap?: DoneTap
  iteration: number
}

/**
 * Creates the mutable state a single compiler instance needs.
 *
 * @returns Fresh state, with no run started and nothing initialized.
 */
export function createPluginState(): GolarPluginState {
  return { initialized: false, watching: false, iteration: 0 }
}
