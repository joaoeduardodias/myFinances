import fastifyCookie from '@fastify/cookie'
import fastifyJwt from '@fastify/jwt'
import { type FastifyInstance, fastify } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { vi } from 'vitest'

import { errorHandler } from '@/http/error-handler'
import { newRequestReference } from '@/lib/request-reference'

export const TEST_JWT_SECRET = 'test-secret'

export function uuid(seed: number | string = 1) {
  const raw = String(seed)
  let hex = ''
  for (let i = 0; i < raw.length; i++) {
    hex += raw.charCodeAt(i).toString(16)
  }
  hex = hex.padStart(12, '0').slice(-12)
  return `11111111-1111-4111-8111-${hex}`
}

export type RoutePlugin = (app: FastifyInstance) => Promise<void>

export async function buildTestApp(
  ...plugins: RoutePlugin[]
): Promise<FastifyInstance> {
  const app = fastify({
    genReqId: newRequestReference,
  }).withTypeProvider<ZodTypeProvider>()
  app.setSerializerCompiler(serializerCompiler)
  app.setValidatorCompiler(validatorCompiler)
  app.setErrorHandler(errorHandler)
  await app.register(fastifyJwt, { secret: TEST_JWT_SECRET })
  await app.register(fastifyCookie)

  for (const plugin of plugins) {
    await app.register(plugin)
  }

  await app.ready()
  return app
}

export async function signToken(
  app: FastifyInstance,
  payload: Record<string, unknown> = { sub: 'test-user-id' },
) {
  return app.jwt.sign(payload)
}

export function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` }
}

export function resetPrismaMocks(prisma: unknown) {
  const visit = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const value = (obj as Record<string, unknown>)[key]
      if (typeof value === 'function' && 'mockReset' in value) {
        ;(value as { mockReset: () => void }).mockReset()
      } else if (value && typeof value === 'object') {
        visit(value)
      }
    }
  }
  visit(prisma)
}

export function makePrismaMock() {
  const model = () => ({
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    createManyAndReturn: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
  })

  const prisma = {
    user: model(),
    userSession: model(),
    connection: model(),
    account: model(),
    transaction: model(),
    cardBill: model(),
    categoryRule: model(),
    recurrence: model(),
    payslip: model(),
    payslipLine: model(),
    $transaction: vi.fn((callback) => callback(prisma)),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  }

  return prisma
}
