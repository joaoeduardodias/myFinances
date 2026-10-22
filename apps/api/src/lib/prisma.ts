import { env } from '@myfinances/env'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/prisma/generated/client'

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })
export const prisma = new PrismaClient({ adapter })
