import { defineConfig, globalIgnores, js, ts } from '@rslint/core'

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/lib/**',
    '**/__out__/**',
    // The playground carries deliberate type and lint errors, which is the
    // point: they are the fixtures the plugin tests assert on.
    'playground/**',
  ]),
  js.configs.recommended,
  ts.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: ['./packages/*/tsconfig.json'],
      },
    },
  },
])
