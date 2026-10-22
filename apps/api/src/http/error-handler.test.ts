import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { Prisma } from '@/prisma/generated/client'
import { buildTestApp } from '@/test/helpers'

import { NotFoundError } from './routes/_errors/not-found-error'

/** Route that throws whatever the test hands it, to exercise the handler. */
function throwingRoute(error: unknown) {
  return async (app: FastifyInstance) => {
    app.get('/boom', async () => {
      throw error
    })
  }
}

async function requestBoom(error: unknown) {
  const app = await buildTestApp(throwingRoute(error))
  const response = await app.inject({ method: 'GET', url: '/boom' })
  return { statusCode: response.statusCode, body: response.json() }
}

describe('error handler — erros da aplicação', () => {
  it('NotFoundError vira 404', async () => {
    const { statusCode, body } = await requestBoom(new NotFoundError('x'))

    expect(statusCode).toBe(404)
    expect(body.message).toBe('x')
  })
})

/** Erro do Prisma como ele chega de verdade, com preâmbulo e tudo. */
function prismaError(
  code: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '7.5.0',
    meta,
  })
}

describe('error handler — falhas de banco', () => {
  it('não conta o motivo real ao cliente, e aponta o log pelo código', async () => {
    // A resposta dizia apenas "código P2010" e o motivo se perdia. Agora ele
    // existe, mas no log: nome de coluna e trecho de SQL não ajudam quem está
    // conferindo as contas, e descrevem nossa infraestrutura para qualquer um
    // que provoque um erro.
    const { statusCode, body } = await requestBoom(
      prismaError(
        'P2010',
        'Invalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. ' +
          "Code: `N/A`. Message: `Failed to deserialize column of type 'void'.`",
      ),
    )

    expect(body.message).not.toMatch(/deserialize|void|queryRaw|Raw query/)
    expect(body.message).toMatch(/Código de referência: [2-9A-HJ-NP-Z]{8}\./)
    // Culpa nossa, não do dado enviado.
    expect(statusCode).toBe(500)
  })

  it('nunca repassa nome de tabela, coluna ou SQL numa falha nossa', async () => {
    const vazamentos = [
      prismaError('P2010', 'relation "transactions" does not exist'),
      prismaError('P2028', 'Transaction already closed: inner transaction'),
      prismaError('P2024', 'Timed out fetching a connection from the pool'),
      prismaError('P9999', 'coluna amount_cents desconhecida'),
    ]
    for (const error of vazamentos) {
      const { body } = await requestBoom(error)
      expect(body.message).not.toMatch(
        /transactions|amount_cents|relation|Transaction already|pool/,
      )
      expect(body.message).toMatch(/Código de referência:/)
    }
  })

  it('dá um código diferente a cada requisição', async () => {
    const primeiro = await requestBoom(prismaError('P2010', 'falhou'))
    const segundo = await requestBoom(prismaError('P2010', 'falhou'))

    const codigo = (mensagem: string) =>
      /Código de referência: ([2-9A-HJ-NP-Z]{8})\./.exec(mensagem)?.[1]

    expect(codigo(primeiro.body.message)).toBeDefined()
    expect(codigo(primeiro.body.message)).not.toBe(
      codigo(segundo.body.message),
    )
  })

  it('separa culpa do dado de culpa nossa pelo status', async () => {
    const doCliente = [
      ['P2000', 400],
      ['P2011', 400],
      ['P2002', 409],
      ['P2003', 409],
      ['P2025', 404],
    ] as const
    for (const [code, status] of doCliente) {
      const { statusCode, body } = await requestBoom(prismaError(code, 'falhou'))
      expect(statusCode, code).toBe(status)
      // Recusa do dado se explica sozinha: não precisa de código nenhum.
      expect(body.message, code).not.toMatch(/Código de referência/)
    }

    // Conflito de escrita: ninguém errou, e a próxima tentativa costuma
    // passar.
    expect(
      (await requestBoom(prismaError('P2034', 'write conflict'))).statusCode,
    ).toBe(409)

    const nossa = ['P2010', 'P2028', 'P9999']
    for (const code of nossa) {
      const { statusCode } = await requestBoom(prismaError(code, 'falhou'))
      expect(statusCode, code).toBe(500)
    }
  })

  it('o 500 genérico também aponta o log', async () => {
    const { statusCode, body } = await requestBoom(new Error('qualquer coisa'))

    expect(statusCode).toBe(500)
    expect(body.message).toMatch(/Código de referência:/)
  })
})

describe('error handler — client errors in Portuguese', () => {
  it('answers schema validation failures with the Portuguese Zod message', async () => {
    const app = await buildTestApp(async (app) => {
      app
        .withTypeProvider<ZodTypeProvider>()
        .post(
          '/invites',
          { schema: { body: z.object({ email: z.email() }) } },
          async () => ({}),
        )
    })

    const response = await app.inject({
      method: 'POST',
      url: '/invites',
      payload: { email: 'x' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe(
      'Dados inválidos no corpo da requisição. email: Formato do endereço de e-mail inválido',
    )
  })

  it('keeps the status of a Fastify client error instead of turning it into 500', async () => {
    const app = await buildTestApp(async (app) => {
      app.post('/upload', { bodyLimit: 10 }, async () => ({}))
    })

    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      payload: { note: 'passa dos dez bytes' },
    })

    expect(response.statusCode).toBe(413)
    expect(response.json().message).toBe(
      'Os dados enviados passam do tamanho máximo permitido.',
    )
  })

  it('answers malformed JSON with 400 and a Portuguese message', async () => {
    const app = await buildTestApp(async (app) => {
      app.post('/upload', async () => ({}))
    })

    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': 'application/json' },
      payload: '{ quebrado',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe(
      'Os dados enviados estão em formato inválido.',
    )
  })
})

describe('error handler — duplicate records', () => {
  /** Formato do Prisma 7 com driver adapter, como o Postgres devolve. */
  function adapterUniqueError(fields: string[]) {
    return prismaError('P2002', 'Unique constraint failed', {
      modelName: 'User',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          kind: 'UniqueConstraintViolation',
          constraint: { fields },
        },
      },
    })
  }

  it('names the field the driver adapter reports', async () => {
    const { statusCode, body } = await requestBoom(
      adapterUniqueError(['email']),
    )

    expect(statusCode).toBe(409)
    expect(body.message).toBe(
      'Já existe um registro com este valor para: e-mail.',
    )
  })

  it('falls back to the generic sentence instead of exposing an internal column', async () => {
    const { body } = await requestBoom(
      adapterUniqueError(['refresh_token_hash']),
    )

    expect(body.message).toBe('Já existe um registro com estes dados.')
  })

  it('still reads the legacy target field', async () => {
    const { body } = await requestBoom(
      prismaError('P2002', 'Unique constraint failed', {
        target: ['email'],
      }),
    )

    expect(body.message).toBe(
      'Já existe um registro com este valor para: e-mail.',
    )
  })
})
