import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'scratch']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Experimental react-hooks RC rules (eslint-plugin-react-hooks v6) flag
      // idiomatic patterns (query→state sync effects, ref assignment, useMemo
      // accumulators) that are correct here. Keep them visible as warnings; the
      // stable rules (rules-of-hooks, exhaustive-deps) remain enforced.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  // shadcn/ui primitives are vendored and must not be modified (see CLAUDE.md).
  // Their variant-export pattern inherently trips react-refresh; the experimental
  // react-hooks RC rules also fire on these correct upstream patterns.
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/purity': 'off',
    },
  },
  // Provider files intentionally colocate a context hook with their provider
  // component — a standard, accepted pattern that trips react-refresh.
  {
    files: ['src/providers/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // lightweight-charts plugin primitives use the documented `const self = this`
  // pattern inside nested renderer object literals to bridge into the chart's
  // render callbacks — `this` cannot be lexically preserved there.
  {
    files: ['src/lib/chart/primitives/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
])
