import { z } from 'zod'

/** O que o `.env.example` traz — e o que ninguém pode subir em produção. */
const VALORES_DE_EXEMPLO = ['change-me', 'changeme', 'secret', 'test-secret']

/** `openssl rand -hex 32` devolve 64 caracteres; 32 é o piso, não a meta. */
const MINIMO = 32

/**
 * Regra do segredo que assina toda sessão.
 *
 * Mora fora do `index.ts` porque lá o `createEnv` roda no import e exige o
 * ambiente inteiro preenchido: a regra ficaria impossível de testar sozinha.
 *
 * Falhar no boot é deliberado, e segue o que `ASAAS_WEBHOOK_TOKEN` já fazia: um
 * segredo fraco não dá erro nenhum — a API sobe, assina tokens normalmente, e a
 * falha só aparece quando alguém forja um JWT com o `sub` de outra pessoa.
 */
export const jwtSecretSchema = z.string().superRefine((valor, ctx) => {
  // O valor de exemplo é conferido primeiro, e não depois do comprimento: todo
  // exemplo é curto, então a regra de tamanho responderia antes e mandaria a
  // pessoa alongar um segredo que o problema real é estar publicado no git.
  if (VALORES_DE_EXEMPLO.includes(valor.trim().toLowerCase())) {
    ctx.addIssue({
      code: 'custom',
      message:
        'JWT_SECRET ainda é um valor de exemplo — gere um com: openssl rand -hex 32',
    })
    return
  }

  if (valor.length < MINIMO) {
    ctx.addIssue({
      code: 'custom',
      message: `JWT_SECRET precisa de ao menos ${MINIMO} caracteres — gere um com: openssl rand -hex 32`,
    })
  }
})
