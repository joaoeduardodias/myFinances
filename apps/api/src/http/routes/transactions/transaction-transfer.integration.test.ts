import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toDbDate } from '@/lib/db-date'
import { prisma } from '@/lib/prisma'
import { authHeaders, buildTestApp, signToken } from '@/test/helpers'

import { updateTransactionTransfer } from './update-transaction-transfer'

const EMAIL = 'transfer@transaction-transfer.integration.test'

describe('marcar transferência à mão (Postgres real)', () => {
  let app: FastifyInstance
  let headers: Record<string, string>
  let userId: string
  let caixaId: string
  let bradescoId: string

  async function tx(accountId: string, date: string, amountCents: number, extra: object = {}) {
    const created = await prisma.transaction.create({
      data: {
        userId,
        accountId,
        date: toDbDate(date),
        description: 'PIX',
        descriptionKey: 'pix',
        amountCents,
        status: 'POSTED',
        source: 'PLUGGY',
        ...extra,
      },
    })
    return created.id
  }

  async function markTransfer(id: string) {
    const res = await app.inject({
      method: 'PATCH',
      url: `/transactions/${id}/transfer`,
      headers,
      payload: { isTransfer: true },
    })
    expect(res.statusCode).toBe(204)
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } })
    const user = await prisma.user.create({ data: { name: 'Transfer', email: EMAIL, passwordHash: 'x' } })
    userId = user.id
    const [caixa, bradesco] = await Promise.all(
      ['Caixa', 'Bradesco'].map((name) =>
        prisma.account.create({ data: { userId, type: 'BANK', name, balanceCents: 0 } }),
      ),
    )
    caixaId = caixa.id
    bradescoId = bradesco.id
    app = await buildTestApp(updateTransactionTransfer)
    headers = authHeaders(await signToken(app, { sub: userId }))
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } })
    await app.close()
  })

  it('liga a saída de uma conta à entrada na outra, mesmo com a saída já desmarcada antes', async () => {
    const out = await tx(caixaId, '2026-10-21', -58_000, { transferLocked: true })
    const inflow = await tx(bradescoId, '2026-10-21', 58_000)
    // A saída do Bradesco no mesmo dia é outra coisa: mesma conta da entrada.
    await tx(bradescoId, '2026-10-21', -58_000)

    await markTransfer(inflow)

    const rows = await prisma.transaction.findMany({
      where: { id: { in: [out, inflow] } },
      select: { id: true, isTransfer: true, transferPairId: true },
    })
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: out, isTransfer: true, transferPairId: inflow },
        { id: inflow, isTransfer: true, transferPairId: out },
      ]),
    )
  })

  it('não rouba a perna de um par que já existe', async () => {
    const pairedOut = await tx(caixaId, '2026-09-10', -10_000, { isTransfer: true })
    const pairedIn = await tx(bradescoId, '2026-09-10', 10_000, {
      isTransfer: true,
      transferPairId: pairedOut,
    })
    const lone = await tx(caixaId, '2026-09-10', -10_000)

    await markTransfer(lone)

    const loneRow = await prisma.transaction.findUniqueOrThrow({ where: { id: lone } })
    expect(loneRow).toMatchObject({ isTransfer: true, transferPairId: null })
    const pairedInRow = await prisma.transaction.findUniqueOrThrow({ where: { id: pairedIn } })
    expect(pairedInRow.transferPairId).toBe(pairedOut)
  })
})
