import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // 'server-only' throws outside a React server environment by design.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup-env.ts'],
    // Engine tests share the local database; run files one at a time.
    fileParallelism: false,
    // Integration tests hit the local database, which is slower while the dev
    // server and a browser are also running.
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
})
