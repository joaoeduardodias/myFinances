import { prisma } from '@/lib/prisma'
import { isRecordNotFound } from '@/lib/prisma-errors'

import type { UserSessionStore } from './user-session-service'

export const prismaUserSessionStore: UserSessionStore = {
  create(input) {
    return prisma.userSession.create({ data: input })
  },
  findByRefreshTokenHash(refreshTokenHash) {
    return prisma.userSession.findUnique({ where: { refreshTokenHash } })
  },  findByPreviousRefreshTokenHash(previousRefreshTokenHash: string) {
    return prisma.userSession.findUnique({
      where: { previousRefreshTokenHash },
    })
  },
  async revokeReused(id: string, revokedAt: Date) {
    await prisma.userSession.update({ where: { id }, data: { revokedAt } })
  },

  async updateRefreshTokenHash(
    id,
    refreshTokenHash,
    currentRefreshTokenHash,
    rotatedAt,
  ) {
    try {
      return await prisma.userSession.update({
        where: { id, refreshTokenHash: currentRefreshTokenHash, revokedAt: null },
        data: {
          refreshTokenHash,
          previousRefreshTokenHash: currentRefreshTokenHash,
          refreshTokenRotatedAt: rotatedAt,
        },
      })
    } catch (error) {
      if (isRecordNotFound(error)) return null
      throw error
    }
  },
  revoke(id, revokedAt) {
    return prisma.userSession.update({
      where: { id },
      data: { revokedAt },
    })
  },
  async revokeAllForUser(userId, revokedAt) {
    await prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    })
  },
}
