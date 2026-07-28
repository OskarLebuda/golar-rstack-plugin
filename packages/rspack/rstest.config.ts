import { defineConfig } from '@rstest/core'

export default defineConfig({
  include: ['tests/**/*.test.ts'],
  testTimeout: 120_000,
})
