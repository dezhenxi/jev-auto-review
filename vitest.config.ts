import { defineConfig } from 'vitest/config'

/**
 * Suites run in forked workers: they bind loopback stub servers and drive real
 * plugin lifecycles through the Loader, which worker threads cannot isolate.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Types-only files carry no executable code.
      exclude: ['src/types.ts'],
      // 100% or it does not merge, per file so one covered file cannot subsidize another.
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      reporter: ['text'],
    },
  },
})
