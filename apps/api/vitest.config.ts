import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    // A suíte de integração abre conexão de verdade e tem config
    // própria (`vitest.integration.config.ts`). Aqui tudo é mock.
    exclude: ['**/node_modules/**', 'src/**/*.integration.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
