import { z } from 'zod'

/**
 * Forma única de um e-mail no banco: sem espaço nas pontas, em caixa baixa.
 *
 * Conta, convite e login comparam e-mail por igualdade exata. Sem isto,
 * "Diego@fazenda.com.br" convidado e "diego@fazenda.com.br" cadastrado viram
 * pessoas diferentes, e o convite nunca pode ser aceito. Todo e-mail que entra
 * na API passa por aqui antes de ser gravado ou procurado.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** E-mail recebido do cliente, já normalizado (`normalizeEmail`). */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())
