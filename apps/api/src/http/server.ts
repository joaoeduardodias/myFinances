import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import fastifyMultipart from '@fastify/multipart'
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import { env } from '@myfinances/env'
import { fastify } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'

import { checkDatabaseConnection } from '@/lib/check-database-connection'
import { newRequestReference } from '@/lib/request-reference'

import { isAllowedOrigin } from './cors'
import { errorHandler } from './error-handler'
import { auth } from './middlewares/auth'
import { rateLimiter } from './middlewares/rate-limit'
import { multipartOptions } from './multipart'
import { getAccounts } from './routes/accounts/get-accounts'
import { acceptAdvisorGoal } from './routes/advisor/accept-advisor-goal'
import { askAdvisor } from './routes/advisor/ask-advisor'
import { clearAdvisorChat } from './routes/advisor/clear-advisor-chat'
import { endAdvisorGoal } from './routes/advisor/end-advisor-goal'
import { getAdvisor } from './routes/advisor/get-advisor'
import { getAnalysis } from './routes/analysis/get-analysis'
import { getAnalysisTransactions } from './routes/analysis/get-analysis-transactions'
import { authenticateWithPassword } from './routes/auth/authenticate-with-password'
import { createUser } from './routes/auth/create-user'
import { getProfile } from './routes/auth/get-profile'
import { logout } from './routes/auth/logout'
import { refreshSession } from './routes/auth/refresh-session'
import { getCards } from './routes/cards/get-cards'
import { updateCardCycle } from './routes/cards/update-card-cycle'
import { getCategories } from './routes/categories/get-categories'
import { getCategoryNecessities } from './routes/categories/get-category-necessities'
import { updateCategoryNecessity } from './routes/categories/update-category-necessity'
import { createConnectToken } from './routes/connections/create-connect-token'
import { createConnection } from './routes/connections/create-connection'
import { deleteConnection } from './routes/connections/delete-connection'
import { getConnections } from './routes/connections/get-connections'
import { syncAll } from './routes/connections/sync-all'
import { syncConnectionRoute } from './routes/connections/sync-connection'
import { getDashboard } from './routes/dashboard/get-dashboard'
import { health } from './routes/health/health'
import { declineCategoryLimit } from './routes/limits/decline-category-limit'
import { getCategoryLimits } from './routes/limits/get-category-limits'
import { updateCategoryLimit } from './routes/limits/update-category-limit'
import { getNotifications } from './routes/notifications/get-notifications'
import { readNotifications } from './routes/notifications/read-notifications'
import { deletePayslip } from './routes/payslips/delete-payslip'
import { getPayslip } from './routes/payslips/get-payslip'
import { getPayslipFile } from './routes/payslips/get-payslip-file'
import { getPayslips } from './routes/payslips/get-payslips'
import { updatePayslipLines } from './routes/payslips/update-payslip-lines'
import { uploadPayslip } from './routes/payslips/upload-payslip'
import { getPushPublicKey } from './routes/push/get-push-public-key'
import { subscribePush } from './routes/push/subscribe-push'
import { unsubscribePush } from './routes/push/unsubscribe-push'
import { createRecurrence } from './routes/recurrences/create-recurrence'
import { dismissRecurrence } from './routes/recurrences/dismiss-recurrence'
import { getRecurrences } from './routes/recurrences/get-recurrences'
import { updateRecurrence } from './routes/recurrences/update-recurrence'
import { createManualTransaction } from './routes/transactions/create-manual-transaction'
import { deleteManualTransaction } from './routes/transactions/delete-manual-transaction'
import { getTransactionSimilar } from './routes/transactions/get-transaction-similar'
import { getTransactions } from './routes/transactions/get-transactions'
import { saveTransactionRecurrence } from './routes/transactions/save-transaction-recurrence'
import { updateTransactionCategory } from './routes/transactions/update-transaction-category'
import { updateTransactionDescription } from './routes/transactions/update-transaction-description'
import { updateTransactionNecessity } from './routes/transactions/update-transaction-necessity'
import { updateTransactionTransfer } from './routes/transactions/update-transaction-transfer'
import { registerPluggyWebhook } from './routes/webhooks/pluggy-webhook'
import { registerWhatsappWebhook } from './routes/webhooks/whatsapp-webhook'
import { swaggerSchemaTransform, swaggerTransformObject } from './swagger'
import { trustProxy } from './trusted-proxy'


const app = fastify({
  logger: true,
  trustProxy,
  genReqId: newRequestReference,
}).withTypeProvider<ZodTypeProvider>()
app.setSerializerCompiler(serializerCompiler)
app.setValidatorCompiler(validatorCompiler)
app.setErrorHandler(errorHandler)

// Allowlist de uma entrada: a origem em que o próprio web é servido (em dev,
// `WEB_URL` aponta para o Vite). Era `origin: true`, que reflete qualquer
// site. `credentials` é só para o cookie `httpOnly` do refresh token
// (`routes/auth/session-cookie.ts`), que vive em `/sessions`; o resto da API
// segue autenticado pelo header `Authorization`.
app.register(fastifyCors, {
  origin: (origin, callback) =>
    callback(null, isAllowedOrigin(origin, env.WEB_URL)),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
})

app.register(fastifyCookie)

app.register(fastifyJwt, {
  secret: env.JWT_SECRET,
})

app.register(fastifyMultipart, multipartOptions)

// Antes das rotas: o limitador precisa do escopo raiz para alcançar todas.
app.register(rateLimiter)

const swaggerOptions: FastifyDynamicSwaggerOptions = {
  openapi: {
    info: {
      title: 'Api Documentation - myFinances',
      description: 'API documentation - myFinances',
      version: '1.0.0',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  transform:
    swaggerSchemaTransform as unknown as FastifyDynamicSwaggerOptions['transform'],
  transformObject:
    swaggerTransformObject as unknown as FastifyDynamicSwaggerOptions['transformObject'],
}

// Só quando pedido — ver `docs-enabled.ts` em `@myfinances/env`. O
// `fastifySwagger` entra junto: sozinho ele não serve rota, mas percorre e
// guarda o schema de tudo, e não há motivo para pagar isso quando ninguém vai
// ler. Antes das rotas, para o swagger enxergá-las.
if (env.API_DOCS_ENABLED) {
  app.register(fastifySwagger, swaggerOptions)

  app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  })
}

app.register(auth)

app.register(health)
app.register(createUser)
app.register(authenticateWithPassword)
app.register(refreshSession)
app.register(logout)
app.register(getProfile)
app.register(createConnectToken)
app.register(createConnection)
app.register(getConnections)
app.register(deleteConnection)
app.register(syncConnectionRoute)
app.register(syncAll)
app.register(getAccounts)
app.register(getRecurrences)
app.register(createRecurrence)
app.register(updateRecurrence)
app.register(dismissRecurrence)
app.register(getTransactions)
app.register(updateTransactionCategory)
app.register(updateTransactionDescription)
app.register(getTransactionSimilar)
app.register(saveTransactionRecurrence)
app.register(updateTransactionNecessity)
app.register(updateTransactionTransfer)
app.register(createManualTransaction)
app.register(deleteManualTransaction)
app.register(getCategories)
app.register(getCategoryNecessities)
app.register(updateCategoryNecessity)
app.register(getCategoryLimits)
app.register(updateCategoryLimit)
app.register(declineCategoryLimit)
app.register(getNotifications)
app.register(readNotifications)
app.register(getAdvisor)
app.register(askAdvisor)
app.register(clearAdvisorChat)
app.register(acceptAdvisorGoal)
app.register(endAdvisorGoal)
app.register(getPushPublicKey)
app.register(subscribePush)
app.register(unsubscribePush)
app.register(getCards)
app.register(updateCardCycle)
app.register(getDashboard)
app.register(getAnalysis)
app.register(getAnalysisTransactions)
app.register(uploadPayslip)
app.register(getPayslips)
app.register(getPayslip)
app.register(updatePayslipLines)
app.register(getPayslipFile)
app.register(deletePayslip)
// Sem `PLUGGY_WEBHOOK_SECRET` a rota nem existe: um webhook sem segredo seria
// um endpoint aberto que dispara sincronizações.
registerPluggyWebhook(app, env.PLUGGY_WEBHOOK_SECRET)
// Sem as quatro variáveis da Meta e a chave do Gemini a rota nem existe: não há
// como assinar nem interpretar, e um webhook aberto seria só superfície.
registerWhatsappWebhook(
  app,
  env.WHATSAPP_ACCESS_TOKEN &&
    env.WHATSAPP_APP_SECRET &&
    env.WHATSAPP_VERIFY_TOKEN &&
    env.WHATSAPP_PHONE_NUMBER_ID &&
    env.GEMINI_API_KEY
    ? {
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      appSecret: env.WHATSAPP_APP_SECRET,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    }
    : undefined,
)

async function start() {
  try {
    await checkDatabaseConnection()
  } catch (error) {
    console.error(`\n❌ ${(error as Error).message}\n`)
    process.exit(1)
  }

  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  console.log(`Server is running on http://0.0.0.0:${env.PORT}`)
}

start()
