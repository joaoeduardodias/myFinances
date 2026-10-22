import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'

import { authHeaders, buildTestApp, signToken } from '@/test/helpers'

import { auth } from './auth'

async function route(app: FastifyInstance) {
  await app.register(auth)
  app.get('/me', async (request) => ({
    userId: await request.getCurrentUserId(),
  }))
}

describe('auth', () => {
  it('devolve o sub do token válido', async () => {
    const app = await buildTestApp(route)
    const token = await signToken(app, { sub: 'user-1' })

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: authHeaders(token),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ userId: 'user-1' })
  })

  it('responde 401 sem token', async () => {
    const app = await buildTestApp(route)

    const response = await app.inject({ method: 'GET', url: '/me' })

    expect(response.statusCode).toBe(401)
  })

  it('responde 401 com token assinado por outro segredo', async () => {
    const app = await buildTestApp(route)
    const forged = await signToken(await buildTestApp(), { sub: 'user-1' })

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: authHeaders(`${forged}x`),
    })

    expect(response.statusCode).toBe(401)
  })
})
