import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts'],
  splitting: false,
  sourcemap: true,
  clean: true,
  // Todo pacote do workspace publica TypeScript cru (`main` aponta para o
  // fonte), então precisa entrar no bundle: deixado externo, o `dist` pediria
  // um `.ts` que o Node não sabe carregar.
  noExternal: [/^@myfinances\//],
  external: ['@prisma/client', '.prisma/client'],
})
