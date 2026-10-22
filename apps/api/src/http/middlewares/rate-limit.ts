import fastifyRateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import fastifyPlugin from 'fastify-plugin'

/** E-mail do corpo, quando houver — a chave das rotas de conta. */
function bodyEmail(request: FastifyRequest): string | null {
  const body = request.body
  if (!body || typeof body !== 'object' || !('email' in body)) return null
  const email = (body as { email?: unknown }).email
  return typeof email === 'string' && email.length > 0
    ? email.toLowerCase()
    : null
}

/**
 * Limitador de requisições da API.
 *
 * O store é o de memória do plugin, e não Redis, porque a hospedagem roda uma
 * instância só — os baldes vivem no mesmo processo que decide. No dia em que
 * houver mais de uma instância isto precisa de store compartilhado, senão o
 * limite se multiplica pelo número de réplicas.
 *
 * `hook: 'preHandler'` em vez do `onRequest` padrão: as rotas de conta montam a
 * chave com o e-mail do corpo, que só existe depois do parse.
 */
export const rateLimiter = fastifyPlugin(async (app: FastifyInstance) => {
  await app.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    hook: 'preHandler',
    // O plugin *lança* o que este builder devolve, e o `error-handler` decide
    // pelo `statusCode`. Devolver um objeto simples aqui faria o 429 chegar lá
    // irreconhecível e sair como 500 — o servidor dizendo "erro interno"
    // justamente quando está funcionando como devia.
    errorResponseBuilder: (_request, context) => {
      const error = new Error(
        'Tentativas demais. Aguarde alguns minutos e tente novamente.',
      ) as Error & { statusCode: number }
      error.statusCode = context.statusCode
      return error
    },
  })
})

/**
 * Login: a chave é o e-mail, não o IP. Força bruta contra uma conta específica
 * vem de vários IPs, e é a conta que precisa ser protegida. O IP continua
 * coberto pelo limite global. Cai no IP quando não há e-mail no corpo, para o
 * balde nunca ser compartilhado por todo mundo.
 */
export const loginRateLimit = {
  rateLimit: {
    max: 10,
    timeWindow: '15 minutes',
    keyGenerator: (request: FastifyRequest) =>
      `login:${bodyEmail(request) ?? request.ip}`,
  },
}

/**
 * Recuperação de senha: chave por e-mail porque o abuso aqui não é entrar na
 * conta, é usar a API como gerador de e-mail contra um terceiro. Quem recebe é
 * o dono do endereço, então é o endereço que tem que ter teto.
 */
export const passwordRecoverRateLimit = {
  rateLimit: {
    max: 5,
    timeWindow: '1 hour',
    keyGenerator: (request: FastifyRequest) =>
      `recover:${bodyEmail(request) ?? request.ip}`,
  },
}

/**
 * Cadastro: chave por IP, e não por e-mail. Criar contas em massa é abuso de
 * quem chama — um e-mail diferente por tentativa faria o limite por e-mail
 * nunca disparar.
 */
export const signUpRateLimit = {
  rateLimit: {
    max: 5,
    timeWindow: '1 hour',
    keyGenerator: (request: FastifyRequest) => `signup:${request.ip}`,
  },
}
