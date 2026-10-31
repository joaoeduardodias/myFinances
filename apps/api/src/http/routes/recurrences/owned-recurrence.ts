import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'

/** O recorrente do usuário, ou 404: recurso de outro usuário não existe para ele. */
export async function findOwnedRecurrence(userId: string, id: string) {
  const recurrence = await prisma.recurrence.findFirst({
    select: { id: true, direction: true, kind: true, payrollDeduction: true },
    where: { id, userId },
  })
  if (!recurrence) throw new NotFoundError('Recorrência não encontrada.')
  return recurrence
}
