import { env } from '@myfinances/env'

import { databaseReason, withReason } from '@/lib/database-reason'
import { prisma } from '@/lib/prisma'

/** Minimal surface needed to probe connectivity — keeps the check testable. */
type DatabaseProbe = {
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>
}

/** host:port/database from the connection string, without leaking credentials. */
function describeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl)
    return `${url.host}${url.pathname}`
  } catch {
    return 'o banco de dados configurado'
  }
}

/**
 * Fails fast at boot with a clear, actionable message when the database is
 * unreachable — instead of letting every request blow up with a generic 500.
 */
export async function checkDatabaseConnection(
  client: DatabaseProbe = prisma,
): Promise<void> {
  try {
    await client.$executeRaw`SELECT 1`
  } catch (error) {
    const target = describeTarget(env.DATABASE_URL)
    // Aqui o motivo fica, ao contrário da resposta HTTP: esta mensagem
    // não vai para o produtor, vai para o log do boot de quem está
    // montando o ambiente. "Senha recusada" e "banco não existe" pedem
    // conserto diferente de "Postgres não está rodando".
    const reason = databaseReason(error)
    throw new Error(
      withReason(
        `Não foi possível conectar ao banco de dados (${target}).`,
        reason,
      ) +
        ' Verifique se o Postgres está rodando (`docker compose up -d`) e se ' +
        'as migrations foram aplicadas ' +
        '(`pnpm --filter @myfinances/api db:migrate:deploy`).',
      { cause: error },
    )
  }
}
