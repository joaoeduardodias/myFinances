import assert from 'node:assert'
import { test } from 'node:test'

import { docsEnabledSchema } from './docs-enabled'
import { jwtSecretSchema } from './jwt-secret'
import { webhookSecretSchema } from './webhook-secret'

/** Aceito quando o parse não lança. */
function accepts(value: string) {
  return jwtSecretSchema.safeParse(value).success
}

test('rejects the example value published in .env.example', () => {
  // Copiar o `.env.example` para `.env` é o caminho óbvio de quem sobe o
  // projeto pela primeira vez, e leva a assinar sessão com segredo público.
  assert.equal(accepts('change-me'), false)
})

test('rejects a secret shorter than 32 characters', () => {
  assert.equal(accepts(''), false)
  assert.equal(accepts('curto'), false)
  assert.equal(accepts('a'.repeat(31)), false)
})

test('accepts a secret of 32 characters or more', () => {
  assert.equal(accepts('a'.repeat(32)), true)
  // Saída típica de `openssl rand -hex 32`.
  assert.equal(accepts('f'.repeat(64)), true)
})

test('says what is wrong instead of failing mutely', () => {
  const curto = jwtSecretSchema.safeParse('curto')
  assert.match(curto.error!.issues[0].message, /32/)

  const exemplo = jwtSecretSchema.safeParse('change-me')
  assert.match(exemplo.error!.issues[0].message, /exemplo/i)
})

/** O valor que o schema entrega para o que veio no ambiente. */
function docsEnabled(value?: string) {
  return docsEnabledSchema.parse(value)
}

test('keeps the docs closed when nothing is set', () => {
  // Produção não declara a variável. O padrão é o que decide se o mapa da API
  // fica público, então ele precisa ser o lado fechado.
  assert.equal(docsEnabled(undefined), false)
})

test('keeps the docs closed for a string that says no', () => {
  // `z.coerce.boolean()` diria `true` aqui: toda string não vazia é truthy,
  // e "false" é uma string não vazia. É assim que uma variável desligada
  // publica a documentação.
  assert.equal(docsEnabled('false'), false)
  assert.equal(docsEnabled('0'), false)
})

test('opens the docs only when asked explicitly', () => {
  assert.equal(docsEnabled('true'), true)
  assert.equal(docsEnabled('1'), true)
})

test('PLUGGY_WEBHOOK_SECRET curto é recusado', () => {
  assert.throws(() => webhookSecretSchema.parse('curto'))
})

test('PLUGGY_WEBHOOK_SECRET ausente é aceito (webhook desligado)', () => {
  assert.equal(webhookSecretSchema.parse(undefined), undefined)
})
