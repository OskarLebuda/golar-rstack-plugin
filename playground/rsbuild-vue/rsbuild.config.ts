import { pluginGolar } from '@golar-rstack/rsbuild'
import { defineConfig } from '@rsbuild/core'
import { pluginVue } from '@rsbuild/plugin-vue'

export default defineConfig({
  plugins: [
    pluginVue(),
    pluginGolar(),
  ],
  source: {
    entry: { index: './src/main.ts' },
  },
})
