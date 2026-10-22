import { describe, expect, it } from 'vitest'

import { buildTestApp } from '@/test/helpers'

import { health } from './health'

describe('GET /health', () => {
  it('GET /health responde ok', async () => {
    const app = await buildTestApp(health)

    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})
