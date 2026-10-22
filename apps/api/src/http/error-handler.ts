import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod'
import { z, ZodError } from 'zod'

import { databaseReason } from '@/lib/database-reason'
import { Prisma } from '@/prisma/generated/client'

import { BadRequestError } from './routes/_errors/bad-request-error'
import { ConflictError } from './routes/_errors/conflict-error'
import { NotFoundError } from './routes/_errors/not-found-error'
import { UnauthorizedError } from './routes/_errors/unauthorized-error'

// As mensagens de validação vão para a tela como vieram do Zod, que fala
// inglês por padrão. A configuração é global e vale a partir daqui: este
// módulo é carregado pelo servidor e pelo app dos testes.
z.config(z.locales.pt())

/**
 * Recusas do próprio Fastify (corpo grande demais, JSON quebrado) chegam com
 * texto em inglês. O código delas é estável; o texto, não.
 */
const fastifyClientErrorMessage: Record<string, string> = {
  FST_ERR_CTP_BODY_TOO_LARGE:
    'Os dados enviados passam do tamanho máximo permitido.',
  FST_ERR_CTP_INVALID_JSON_BODY: 'Os dados enviados estão em formato inválido.',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'A requisição chegou sem dados.',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'Formato de envio não suportado.',
  // Do `@fastify/multipart`: o limite é o `MAX_PAYSLIP_BYTES` do storage.
  FST_REQ_FILE_TOO_LARGE: 'O arquivo passa de 5 MB',
  FST_FILES_LIMIT: 'Envie um arquivo por vez.',
  FST_INVALID_MULTIPART_CONTENT_TYPE: 'Envie o arquivo como formulário (multipart/form-data).',
}

/** Human-readable label (pt-BR) for where invalid data came from. */
const validationContextLabel: Record<string, string> = {
  body: 'corpo da requisição',
  params: 'parâmetros da rota',
  querystring: 'parâmetros de busca',
  headers: 'cabeçalhos',
}

/** Builds "campo: mensagem; outro.campo: mensagem" from field problems. */
function formatIssues(issues: { path: string; message: string }[]): string {
  return issues
    .map(({ path, message }) => `${path || '(raiz)'}: ${message}`)
    .join('; ')
}

/**
 * Nome, para o usuário, de cada campo que um índice único protege.
 *
 * A chave é a coluna sem `_` (`password_hash` e `passwordHash` viram `passwordhash`):
 * o Prisma manda o nome do campo, e o driver adapter, o da coluna. Campo fora
 * daqui (hash de token, id externo) não é algo que a pessoa digitou, e a
 * resposta cai na frase genérica em vez de expor a coluna.
 */
const uniqueFieldLabel: Record<string, string> = {
  email: 'e-mail',
  name: 'nome',
}

/**
 * Os campos que o índice único recusou, já com o nome legível.
 *
 * O Prisma 7 com driver adapter não preenche mais `meta.target`: os campos
 * vêm em `meta.driverAdapterError.cause.constraint.fields`, com o nome da
 * coluna. Lê os dois, e devolve vazio se algum campo não tiver nome legível.
 */
function uniqueFieldLabels(meta: Record<string, unknown> | undefined): string {
  const adapterFields = (
    meta?.driverAdapterError as
      | { cause?: { constraint?: { fields?: unknown } } }
      | undefined
  )?.cause?.constraint?.fields
  const raw = Array.isArray(adapterFields)
    ? adapterFields
    : Array.isArray(meta?.target)
      ? meta.target
      : typeof meta?.target === 'string'
        ? [meta.target]
        : []

  const keys = raw
    .filter((field): field is string => typeof field === 'string')
    .map((field) => field.replace(/_/g, '').toLowerCase())
  const labels = keys.map((key) => uniqueFieldLabel[key])
  if (labels.length === 0 || labels.some((label) => !label)) return ''
  return labels.join(', ')
}

/**
 * Aponta o usuário para o log em vez de despejar o motivo na tela.
 *
 * Nome de tabela, de coluna e trecho de SQL não ajudam quem está conferindo as contas,
 * e descrevem nossa infraestrutura para qualquer um que provoque um erro. O
 * motivo real fica no log, junto deste código.
 */
function withReference(explanation: string, reference: string): string {
  return `${explanation} Código de referência: ${reference}.`
}

/**
 * Turns a Prisma known-request error into a clear, actionable HTTP response.
 *
 * O status segue de quem é a culpa, porque o cliente decide por ele: 4xx é
 * recusa do dado enviado, e reenviar o mesmo dado não adianta; 5xx é problema
 * nosso, e vale tentar de novo depois que consertarmos. Errar esse lado ou
 * descarta trabalho do usuário, ou deixa a fila girando para sempre.
 */
function handleKnownPrismaError(
  error: Prisma.PrismaClientKnownRequestError,
  reply: FastifyReply,
  reference: string,
) {
  const model = (error.meta?.modelName as string | undefined) ?? undefined

  switch (error.code) {
    case 'P2025':
      return reply.status(404).send({
        message: model
          ? `Registro de ${model} não encontrado.`
          : 'Registro não encontrado.',
      })
    case 'P2002': {
      const fields = uniqueFieldLabels(error.meta)
      return reply.status(409).send({
        message: fields
          ? `Já existe um registro com este valor para: ${fields}.`
          : 'Já existe um registro com estes dados.',
      })
    }
    case 'P2003':
      return reply.status(409).send({
        message:
          'Operação bloqueada: existem registros relacionados que dependem deste, ou o vínculo aponta para um registro que não existe.',
      })
    case 'P2014':
      return reply.status(409).send({
        message:
          'A operação quebraria um vínculo obrigatório entre registros.',
      })
    case 'P2000':
      return reply.status(400).send({
        message: 'Um dos valores enviados excede o tamanho máximo permitido.',
      })
    case 'P2011':
      return reply.status(400).send({
        message: 'Um campo obrigatório não foi preenchido.',
      })
    case 'P2004':
      return reply.status(400).send({
        message: 'O banco de dados recusou os valores enviados.',
      })
    // Conflito de escrita concorrente. Não é culpa de ninguém e a próxima
    // tentativa costuma passar, então 409 e não 500.
    case 'P2034':
      return reply.status(409).send({
        message:
          'Outra operação mexeu nestes mesmos registros agora. Tente novamente.',
      })
    // Daqui para baixo a culpa é nossa: SQL quebrado, transação estourada,
    // pool esgotado. O cliente não conserta reenviando dado diferente, então
    // a resposta não tenta explicar — aponta o log.
    case 'P2010':
      return reply.status(500).send({
        message: withReference(
          'Uma consulta ao banco de dados falhou.',
          reference,
        ),
      })
    case 'P2024':
      return reply.status(503).send({
        message: withReference(
          'O banco de dados não respondeu a tempo: todas as conexões estão ocupadas.',
          reference,
        ),
      })
    case 'P2028':
      return reply.status(500).send({
        message: withReference(
          'A transação no banco de dados falhou.',
          reference,
        ),
      })
    default:
      return reply.status(500).send({
        message: withReference('Falha no banco de dados.', reference),
      })
  }
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Request payload failed schema validation (body/params/query/headers).
  if (hasZodFastifySchemaValidationErrors(error)) {
    const context = error.validationContext ?? 'requisição'
    const label = validationContextLabel[context] ?? context
    const issues = error.validation.map((item) => ({
      path: item.instancePath.replace(/^\//, '').replace(/\//g, '.'),
      message: item.message ?? 'valor inválido',
    }))
    return reply.status(400).send({
      message: `Dados inválidos no ${label}. ${formatIssues(issues)}`,
    })
  }

  // A ZodError thrown directly inside a handler.
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
    return reply.status(400).send({
      message: `Dados inválidos. ${formatIssues(issues)}`,
    })
  }

  if (error instanceof UnauthorizedError) {
    return reply.status(401).send({ message: error.message })
  }
  if (error instanceof BadRequestError) {
    return reply.status(400).send({ message: error.message })
  }
  if (error instanceof ConflictError) {
    // O instanceof estreita para FastifyError (o `details` é opcional).
    const { details } = error as ConflictError
    return reply.status(409).send({ ...details, message: error.message })
  }
  if (error instanceof NotFoundError) {
    return reply.status(404).send({ message: error.message })
  }

  // Um código por requisição, o mesmo na tela e no log.
  const reference = String(request.id)

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Registrar antes de responder, sempre. A resposta aponta o código; o log
    // guarda o motivo real e o `meta`, para quem for consertar.
    request.log.error(
      {
        err: error,
        reference,
        prismaCode: error.code,
        prismaMeta: error.meta,
        reason: databaseReason(error),
      },
      'Database request failed',
    )
    return handleKnownPrismaError(error, reply, reference)
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    // Consulta malformada é bug nosso, não dado errado do cliente: nenhum
    // corpo diferente faria esta consulta passar. Por isso 500, e não 400.
    request.log.error(
      { err: error, reference, reason: databaseReason(error) },
      'Malformed Prisma query',
    )
    return reply.status(500).send({
      message: withReference(
        'A consulta ao banco de dados está malformada.',
        reference,
      ),
    })
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    request.log.error(
      { err: error, reference, reason: databaseReason(error) },
      'Unknown database failure',
    )
    return reply.status(500).send({
      message: withReference('O banco de dados recusou a operação.', reference),
    })
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) {
    request.log.error(
      { err: error, reference, reason: databaseReason(error) },
      'Prisma engine panic',
    )
    return reply.status(500).send({
      message: withReference(
        'O motor do banco de dados caiu durante a operação.',
        reference,
      ),
    })
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    request.log.error(
      { err: error, reference, reason: databaseReason(error) },
      'Database connection failed',
    )
    return reply.status(503).send({
      message: withReference(
        'Não foi possível conectar ao banco de dados.',
        reference,
      ),
    })
  }

  // Response failed to match its declared schema — a server-side contract bug.
  if (isResponseSerializationError(error)) {
    request.log.error(
      { err: error, method: error.method, url: error.url },
      'Response serialization error',
    )
    return reply.status(500).send({
      message: 'A resposta do servidor não corresponde ao formato esperado.',
    })
  }

  // O limitador lança um FastifyError com status próprio. Sem este branch ele
  // cairia no 500 genérico logo abaixo, e o cliente ouviria "erro interno"
  // quando o servidor está justamente funcionando como devia.
  if (error.statusCode === 429) {
    return reply.status(429).send({
      message:
        error.message ||
        'Tentativas demais. Aguarde alguns minutos e tente novamente.',
    })
  }

  // Outra recusa do Fastify por dado do cliente. Sem este branch ela viraria
  // 500 "erro interno", e o usuário reenviaria o mesmo dado esperando passar.
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      message:
        fastifyClientErrorMessage[error.code] ??
        'A requisição foi recusada. Confira os dados e tente novamente.',
    })
  }

  // Unknown/unexpected error: log the real cause, never leak it to the client.
  request.log.error(error)

  // send error to some observability platform

  return reply.status(500).send({
    message: withReference(
      'Erro interno do servidor. A equipe foi notificada.',
      reference,
    ),
  })
}
