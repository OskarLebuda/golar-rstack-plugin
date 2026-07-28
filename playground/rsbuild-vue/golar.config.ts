import { defineConfig, rules } from 'golar/unstable'
import '@golar/vue'

export default defineConfig({
  lint: {
    use: [
      {
        files: ['src/**/*.{ts,vue}'],
        rules: rules({ 'explicit-anys': true }),
      },
    ],
  },
})
