import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

import { docsEnabledSchema } from './docs-enabled'
import { jwtSecretSchema } from './jwt-secret'
import { webhookSecretSchema } from './webhook-secret'

export { docsEnabledSchema } from './docs-enabled'
export { jwtSecretSchema } from './jwt-secret'
export { webhookSecretSchema } from './webhook-secret'

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(3333),
    DATABASE_URL: z.url(),
    JWT_SECRET: jwtSecretSchema,
    TIMEZONE: z.string().default('America/Sao_Paulo'),
    /** Origem do web, usada no CORS. */
    WEB_URL: z.url(),
    /** Padrão fechado — ver `docs-enabled.ts`. */
    API_DOCS_ENABLED: docsEnabledSchema,
    PLUGGY_CLIENT_ID: z.string(),
    PLUGGY_CLIENT_SECRET: z.string(),
    PLUGGY_BASE_URL: z.url().default('https://api.pluggy.ai'),
    /** Ausente = webhook desligado — ver `webhook-secret.ts`. */
    PLUGGY_WEBHOOK_SECRET: webhookSecretSchema,
    /** Ausente = lançamentos por WhatsApp não interpretam texto/foto. */
    GEMINI_API_KEY: z.string().optional(),
    /** WhatsApp Cloud API (Meta): sem as quatro, a rota do webhook não existe. */
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    /** Web Push: sem as três, os avisos não vão para o navegador. Gere com `npx web-push generate-vapid-keys`. */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    /** `mailto:` ou URL de contato, exigido pelos serviços de push. */
    VAPID_SUBJECT: z.string().optional(),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string(),
    S3_ACCESS_KEY_ID: z.string(),
    S3_SECRET_ACCESS_KEY: z.string(),
  },
  clientPrefix: 'VITE_',
  client: {
    VITE_API_URL: z.url(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
