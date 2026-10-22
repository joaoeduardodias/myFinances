import { env } from '@myfinances/env'

import { WEBHOOK_SECRET_HEADER } from '@/http/routes/webhooks/pluggy-webhook'
import { createPluggyClient } from '@/lib/pluggy/client'

const url = process.argv[2]
if (!url) {
  console.error('Uso: pnpm pluggy:webhook <url>  (ex.: https://api.exemplo.com/webhooks/pluggy)')
  process.exit(1)
}

if (!env.PLUGGY_WEBHOOK_SECRET) {
  console.error('PLUGGY_WEBHOOK_SECRET não está definido (mínimo de 32 caracteres). Defina-o no .env antes de cadastrar o webhook.')
  process.exit(1)
}

const client = createPluggyClient({
  baseUrl: env.PLUGGY_BASE_URL,
  clientId: env.PLUGGY_CLIENT_ID,
  clientSecret: env.PLUGGY_CLIENT_SECRET,
})

try {
  await client.registerWebhook(url, {
    [WEBHOOK_SECRET_HEADER]: env.PLUGGY_WEBHOOK_SECRET,
  })
  console.log(`Webhook cadastrado na Pluggy: ${url}`)
} catch (error) {
  console.error(`Falha ao cadastrar o webhook: ${(error as Error).message}`)
  process.exit(1)
}
