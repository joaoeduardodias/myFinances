import { env } from '@myfinances/env'

import { WEBHOOK_SECRET_HEADER } from '@/http/routes/webhooks/webhook-secret-header'
import { createPluggyClient } from '@/lib/pluggy/client'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  const rawUrl = process.argv[2]
  if (!rawUrl) {
    fail('Uso: pnpm pluggy:webhook <url>  (ex.: https://api.exemplo.com/webhooks/pluggy)')
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    fail(`URL inválida: ${rawUrl}`)
  }
  if (url.protocol !== 'https:') {
    fail('A URL do webhook precisa usar https://.')
  }

  const secret = env.PLUGGY_WEBHOOK_SECRET
  if (!secret) {
    fail('PLUGGY_WEBHOOK_SECRET não está definido (mínimo de 32 caracteres). Defina-o no .env antes de cadastrar o webhook.')
  }

  const client = createPluggyClient({
    baseUrl: env.PLUGGY_BASE_URL,
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  })

  try {
    await client.registerWebhook(url.toString(), { [WEBHOOK_SECRET_HEADER]: secret })
  } catch (error) {
    fail(`Falha ao cadastrar o webhook: ${(error as Error).message}`)
  }
  console.log(`Webhook cadastrado na Pluggy: ${url.toString()}`)
  process.exit(0)
}

main().catch((error) => fail(String(error)))
