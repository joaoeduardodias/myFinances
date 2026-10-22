import path from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Suíte que fala com um Postgres de verdade. Fora do `vitest.config.ts` de
 * propósito: `pnpm test` roda em CI sem banco e não pode depender disto.
 *
 * `fileParallelism: false` porque os testes disputam advisory lock e linhas
 * da mesma organização — em paralelo um veria a espera do outro como falha.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./src/test/integration-setup.ts'],
    fileParallelism: false,
    // Um teste espera de propósito por um lock segurado por outra transação.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
