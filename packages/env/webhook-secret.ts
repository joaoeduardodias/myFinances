import { z } from 'zod'

/**
 * Segredo que a Pluggy devolve em cada notificação de webhook.
 *
 * Opcional de propósito: sem ele o webhook fica desligado e a API segue só
 * com a sincronização manual. Mas, se vier, precisa ser forte — um segredo
 * curto deixaria qualquer um forjar uma notificação.
 *
 * Mora fora do `index.ts` pelo mesmo motivo do `jwt-secret.ts`: o `createEnv`
 * roda no import e exige o ambiente inteiro.
 */
export const webhookSecretSchema = z.string().min(32).optional()
