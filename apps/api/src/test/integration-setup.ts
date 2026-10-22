/**
 * Trava e diagnóstico da suíte de integração.
 *
 * Os testes de `*.test.ts` mockam o Prisma e nunca abrem conexão. Estes aqui
 * fazem o contrário: existem justamente para o SQL que o mock não sabe imitar
 * — advisory lock, `FOR UPDATE`, tipo de retorno de função do Postgres. Por
 * isso escrevem linha de verdade, e por isso a trava é mais dura que a do
 * seed: host local não basta, o nome do banco precisa terminar em `test`.
 * Apontar isto para o `myfinances` de desenvolvimento sujaria o banco de quem
 * está trabalhando.
 */

/** `myfinances_test`, `myfinances-test`, `test`. */
const TEST_DATABASE = /(^|[_-])test$/

const HOW_TO =
  'Crie o `.env.e2e` (veja o CLAUDE.md), suba o Postgres e aplique as ' +
  'migrations:\n' +
  '  pnpm --filter @myfinances/api env:load:e2e prisma migrate deploy'

export function assertIntegrationDatabase(
  env: { NODE_ENV?: string; DATABASE_URL?: string } = process.env,
) {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Teste de integração recusado: NODE_ENV é "production". Ele grava no banco.',
    )
  }

  if (!env.DATABASE_URL) {
    throw new Error(
      `Teste de integração recusado: DATABASE_URL não está definida.\n${HOW_TO}`,
    )
  }

  let url: URL
  try {
    url = new URL(env.DATABASE_URL)
  } catch {
    throw new Error(
      'Teste de integração recusado: DATABASE_URL não é uma URL válida.',
    )
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!TEST_DATABASE.test(database)) {
    throw new Error(
      `Teste de integração recusado: DATABASE_URL aponta para "${database}", ` +
        `que não é um banco de teste (o nome precisa terminar em "test").\n${HOW_TO}`,
    )
  }
}

assertIntegrationDatabase()
