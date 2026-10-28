import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()
const loadFinanceSnapshot = vi.fn()
const loadAnalysisInput = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('./load-finance-snapshot', () => ({ loadFinanceSnapshot }))
vi.mock('./load-analysis', () => ({ loadAnalysisInput }))

const { checkAlerts } = await import('./check-alerts')

const USER = 'user-1'
const TODAY = '2026-10-28'

const snapshot = (balanceCents: number) => ({
  accounts: [{ id: 'a1', type: 'BANK', name: 'Banco', balanceCents, creditLimitCents: null }],
  cardBills: [],
  cardsMissingCycle: [],
  recurrences: [],
  transactions: [],
})

const spendTx = (amountCents: number) => ({
  id: 't1',
  date: '2026-10-10',
  description: 'Supermercado',
  amountCents,
  category: 'Mercado',
  necessity: null,
  isTransfer: false,
  accountType: 'BANK',
  accountName: 'Banco',
})

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  loadFinanceSnapshot.mockReset()
  loadAnalysisInput.mockReset()
  prismaMock.user.findUnique.mockResolvedValue({ spendableNegative: false })
  prismaMock.categoryLimit.findMany.mockResolvedValue([])
  prismaMock.notification.findMany.mockResolvedValue([])
  loadFinanceSnapshot.mockResolvedValue(snapshot(100000))
  loadAnalysisInput.mockResolvedValue({ today: TODAY, transactions: [spendTx(-70000)], overrides: new Map() })
})

describe('checkAlerts', () => {
  it('lê só os limites ACTIVE do usuário e pula a análise sem limites', async () => {
    await checkAlerts(USER, TODAY)
    expect(prismaMock.categoryLimit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER, status: 'ACTIVE' } }),
    )
    expect(loadAnalysisInput).not.toHaveBeenCalled()
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled()
  })

  describe('com limite', () => {
    beforeEach(() => {
      prismaMock.categoryLimit.findMany.mockResolvedValue([
        { category: 'Mercado', limitCents: 80000 },
      ])
    })

    it('busca as chaves existentes e grava o aviso novo com skipDuplicates', async () => {
      await checkAlerts(USER, TODAY)
      expect(loadAnalysisInput).toHaveBeenCalledWith(USER, TODAY)
      expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER, dedupeKey: { startsWith: 'category:' } } }),
      )
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            userId: USER,
            kind: 'CATEGORY_WARNING',
            dedupeKey: 'category:Mercado:2026-10:80',
          }),
        ],
        skipDuplicates: true,
      })
    })

    it('não grava quando a chave já existe', async () => {
      prismaMock.notification.findMany.mockResolvedValue([
        { dedupeKey: 'category:Mercado:2026-10:80' },
      ])
      await checkAlerts(USER, TODAY)
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled()
    })
  })

  describe('saldo', () => {
    const income = {
      id: 'r1',
      accountId: 'a1',
      accountType: 'BANK',
      direction: 'IN',
      description: 'Salário',
      descriptionKey: 'salario',
      expectedAmountCents: 500000,
      dayRule: 'DAY_OF_MONTH',
      dayValue: 5,
      nonBusinessDayPolicy: 'NEXT_BUSINESS_DAY',
    }

    it('marca spendableNegative e avisa na troca para negativo', async () => {
      loadFinanceSnapshot.mockResolvedValue({ ...snapshot(-50000), recurrences: [income] })
      await checkAlerts(USER, TODAY)
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: { spendableNegative: true },
      })
      expect(prismaMock.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ kind: 'SPENDABLE_NEGATIVE', userId: USER })],
        skipDuplicates: true,
      })
    })

    it('não atualiza o usuário quando o estado não muda', async () => {
      loadFinanceSnapshot.mockResolvedValue({ ...snapshot(100000), recurrences: [income] })
      await checkAlerts(USER, TODAY)
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    it('volta spendableNegative a false quando fica positivo', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ spendableNegative: true })
      loadFinanceSnapshot.mockResolvedValue({ ...snapshot(100000), recurrences: [income] })
      await checkAlerts(USER, TODAY)
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: { spendableNegative: false },
      })
      expect(prismaMock.notification.createMany).not.toHaveBeenCalled()
    })
  })
})
