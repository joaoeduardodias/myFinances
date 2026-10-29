import type { IsoDate } from '@/lib/today'

import { refreshAdvisorSummaryInBackground } from './advisor-summary'
import { checkAlertsSafely } from './check-alerts'

/** Único gancho para "entraram transações": alarmes agora, resumo do consultor em segundo plano. */
export async function onNewTransactions(userId: string, today: IsoDate): Promise<void> {
  await checkAlertsSafely(userId, today)
  refreshAdvisorSummaryInBackground(userId, today)
}
