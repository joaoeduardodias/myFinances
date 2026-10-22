# myFinances — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um app de finanças pessoais, multiusuário, que junta contas e cartões via Pluggy (Meu Pluggy). A tela inicial mostra saldo, o que falta pagar e quanto dá para gastar até o próximo recebimento. O app também detecta recorrentes, mostra as faturas e guarda holerites no R2.

**Architecture:**
- Monorepo pnpm + Turborepo no padrão do `~/projects/controlPec`, sem a parte SaaS.
- A API Fastify guarda tudo no Postgres via Prisma e sincroniza com a Pluggy por um único módulo (`lib/pluggy`).
- Toda regra de dinheiro (projeção, faturas, transferências, recorrentes, dias úteis) são funções puras em `apps/api/src/lib/finance/`, testadas isoladamente. As rotas só carregam dados do usuário e chamam essas funções.
- O web é uma SPA React que consome a API via ky + TanStack Query.

**Tech Stack:**
- Node 22 e TypeScript 5.
- API: Fastify 5, `fastify-type-provider-zod`, Zod 4, Prisma 7 + `@prisma/adapter-pg`, `@fastify/multipart`, `@aws-sdk/client-s3`.
- Web: React 19, Vite 6, Tailwind v4, shadcn/ui (new-york, zinc), React Router 7, TanStack Query 5, ky, react-hook-form, sonner.
- Testes: Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-myfinances-design.md`

**Referência de padrão:** `~/projects/controlPec`. Quando um passo diz "portar de X", copie o arquivo, troque o escopo `@fazenda/` por `@myfinances/` e remova tudo que fala de organização, membro, convite, CASL, founder, billing, desktop, Google ou e-mail.

## Global Constraints

- **Tudo em TypeScript.** Escopo dos pacotes: `@myfinances/*`. API na porta 3333, web na 5173, Postgres na **5435**, preso em `127.0.0.1` e com volume nomeado.
- **Nada pago.** Pluggy via conector **MeuPluggy**, que permite até 5 conexões e só uso pessoal. R2 no plano grátis.
- **Valores em centavos inteiros (`Int`)**, com sinal: `+` para dinheiro que entra na conta, `−` para dinheiro que sai. Para cartão, compra é `−` e pagamento é `+`.
  - A conversão do decimal da Pluggy acontece só em `toCents` e sempre usa o campo `type`: `CREDIT` vira `+|valor|` e `DEBIT` vira `−|valor|`.
- **Datas sem hora são strings `YYYY-MM-DD` (`IsoDate`) em toda função pura.** No Prisma usam `@db.Date`. O "hoje" é calculado no fuso `TIMEZONE` (`America/Sao_Paulo`).
- **Toda consulta filtra por `userId` do token.** Recurso de outro usuário responde 404, nunca 403.
- **O `clientSecret` da Pluggy e as chaves do R2 nunca saem da API.**
- **O webhook só existe se `PLUGGY_WEBHOOK_SECRET` estiver definida.** Ele confere o header `x-myfinances-webhook-secret` com comparação de tempo constante, responde `202` na hora e processa depois.
- **Holerite:** só PDF (bytes iniciais `%PDF-`), no máximo **5 MB**, bucket R2 privado. Download por URL assinada de **15 min**.
- **Janela da projeção:** de hoje até o próximo recebimento previsto, vindo de um recorrente de entrada confirmado. Sem nenhum confirmado, vai até o fim do mês, com aviso na tela.
- **Textos da interface em português do Brasil.**

## Review Focus

1. **Renovar a autorização do Meu Pluggy troca o `itemId`.** Ao ressincronizar, nenhuma transação pode ser duplicada: o upsert é pelo `pluggyTransactionId`. Teste na Task 7.
2. **Webhook com `itemId` desconhecido, evento repetido ou payload malformado** responde `202` (ou `400` quando o payload é inválido), não derruba o processo e não grava duas vezes. Teste na Task 9.
3. **Recorrente no dia 31 em fevereiro, abril etc.** cai no último dia do mês, e a política de dia não útil vale depois disso. Teste na Task 4.
4. **Upload de arquivo renomeado para `.pdf`, maior que 5 MB, ou o mesmo PDF duas vezes** responde 400, 413 e 409 com o id do existente, nessa ordem. Teste na Task 14.
5. **Salário previsto para hoje (janela de 0 dias) ou saldo negativo:** o valor por dia não divide por zero e o número negativo aparece como negativo. Teste na Task 6.

---

## Mapa de arquivos

```
myfinances/
├─ package.json, pnpm-workspace.yaml, turbo.json, .npmrc, .gitignore,
│  docker-compose.yml, .env.example, CLAUDE.md
├─ config/{eslint-config,prettier,typescript-config}/   (portados)
├─ packages/env/index.ts                                  (variáveis validadas)
├─ apps/api/
│  ├─ prisma/schema.prisma, prisma.config.ts
│  ├─ src/http/server.ts, error-handler.ts, cors.ts
│  ├─ src/http/middlewares/{auth,rate-limit}.ts
│  ├─ src/http/routes/_errors/*.ts
│  ├─ src/http/routes/{auth,connections,webhooks,accounts,transactions,
│  │                   categories,recurrences,cards,dashboard,payslips,health}/
│  ├─ src/lib/{prisma,storage,s3-endpoint,rotating-session-token,today}.ts
│  ├─ src/lib/pluggy/{client,types}.ts
│  ├─ src/lib/finance/{money,description-key,categories,business-days,
│  │                   recurrence-schedule,detect-recurrences,detect-transfers,
│  │                   card-bills,projection}.ts
│  ├─ src/lib/payslip/parse.ts
│  ├─ src/services/{sync-connection,wallet,load-finance-snapshot}.ts
│  ├─ src/scripts/register-pluggy-webhook.ts
│  └─ src/test/{setup,helpers,integration-setup}.ts
└─ apps/web/src/
   ├─ router.tsx, main.tsx, index.css
   ├─ auth/auth-context.tsx, components/{protected-route,app-layout,app-sidebar}.tsx
   ├─ components/ui/*  (shadcn, copiados do controlPec)
   ├─ http/{api,auth,dashboard,connections,transactions,recurrences,cards,payslips}.ts
   ├─ lib/{cookies,format,utils}.ts
   └─ pages/{login,register,home,transactions,cards,recurrences,payslips,
             payslip-detail,connections}.tsx
```

---

### Task 1: Monorepo, configs compartilhadas e env

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.gitignore`, `docker-compose.yml`, `.env.example`
- Create: `config/eslint-config/*`, `config/prettier/*`, `config/typescript-config/*` (portados de `controlPec/config/*`)
- Create: `packages/env/{package.json,index.ts,jwt-secret.ts,docs-enabled.ts,index.test.ts}`

**Interfaces:**
- Produces: `import { env } from '@myfinances/env'` com:
  - `server`: `PORT` (default 3333), `DATABASE_URL`, `JWT_SECRET` (`jwtSecretSchema` portado), `TIMEZONE` (default `America/Sao_Paulo`), `WEB_URL` (url, usada no CORS), `API_DOCS_ENABLED` (`docsEnabledSchema` portado), `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_BASE_URL` (default `https://api.pluggy.ai`), `PLUGGY_WEBHOOK_SECRET` (`z.string().min(32).optional()`), `S3_ENDPOINT`, `S3_REGION` (default `auto`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`;
  - `client`: `VITE_API_URL`.

- [ ] **Step 1: Criar a raiz.** Copie `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `.npmrc` e `.gitignore` do `controlPec`.
  - Nome `myfinances`.
  - No `turbo.json`, `build.env` fica `["DATABASE_URL", "VITE_*"]`, sem `SEO_NOINDEX`.
  - No `.gitignore`, tire as linhas de .NET, `.vs` e security-audit e acrescente `samples/`.
- [ ] **Step 2: `docker-compose.yml` — já feito.** `docker-compose.yml` e `docker/init-test-db.sql` já existem: imagem oficial `postgres:17-alpine` (não a bitnami, que saiu do Docker Hub), porta `127.0.0.1:5435`, bancos `myfinances` e `myfinances_test`, usuário/senha `docker`. Só confira que `docker compose ps` mostra `pg` rodando.
- [ ] **Step 3: Portar `config/*`** com nomes `@myfinances/eslint-config`, `@myfinances/prettier` e `@myfinances/ts-config`. Tire a dependência `@casl/ability` do ts-config.
- [ ] **Step 4: Escrever `packages/env/index.test.ts`**, portando os testes de `jwt-secret` e `docs-enabled` do `controlPec`. Acrescente:

```ts
test('PLUGGY_WEBHOOK_SECRET curto é recusado', () => {
  assert.throws(() => webhookSecretSchema.parse('curto'))
})
test('PLUGGY_WEBHOOK_SECRET ausente é aceito (webhook desligado)', () => {
  assert.equal(webhookSecretSchema.parse(undefined), undefined)
})
```

- [ ] **Step 5: Implementar `packages/env/index.ts`.** Siga a interface acima e exporte `webhookSecretSchema`.
- [ ] **Step 6: `.env.example`.** Uma linha comentada por variável.
  - Lembrete do R2 igual ao do `controlPec`: o endpoint é o da conta, não o do bucket.
  - Explique onde achar o Client ID e o Client Secret da Pluggy: Dashboard → Applications. O secret aparece uma vez só.
- [ ] **Step 7: Verificar.** Run: `pnpm install && pnpm --filter @myfinances/env test && docker compose up -d`. Expected: testes passam, e `docker compose ps` mostra `pg` rodando.
- [ ] **Step 8: Commit.** `chore: monorepo, configs e env`

---

### Task 2: Esqueleto da API com health e auth por e-mail/senha

**Files:**
- Create: `apps/api/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts,vitest.integration.config.ts,prisma.config.ts}`, portados.
  - O `package.json` mantém os scripts `dev`, `build`, `test`, `test:integration`, `lint`, `start`, `db:*` e `env:load*`. Tire os de storage, billing, lot-stays e admin. Acrescente `pluggy:webhook` (Task 9).
- Create: `apps/api/prisma/schema.prisma`, só com `User` e `UserSession`.
  - `User`: `id`, `name`, `email @unique`, `passwordHash`, `createdAt`, `updatedAt`, relações.
  - `UserSession`: igual ao do `controlPec`.
- Create (portados): `src/http/server.ts`, `src/http/error-handler.ts`, `src/http/cors.ts`, `src/http/swagger.ts`, `src/http/middlewares/{auth,rate-limit}.ts`, `src/http/routes/_errors/{bad-request,unauthorized,conflict}-error.ts`, `src/lib/{prisma,rotating-session-token,request-reference,check-database-connection}.ts`, `src/http/routes/auth/{create-user,authenticate-with-password,refresh-session,logout,get-profile,session-cookie,user-session-service,prisma-user-session-store}.ts`, `src/test/{setup,helpers,integration-setup}.ts`
- Create: `src/http/routes/_errors/not-found-error.ts`, `src/http/routes/health/health.ts`, `src/lib/today.ts`
- Test: os testes portados de cada rota de auth e do `error-handler`, mais `health.test.ts`, `today.test.ts` e `not-found` no `error-handler.test.ts`.

**Interfaces:**
- Produces:
  - `request.getCurrentUserId(): Promise<string>`, registrado pelo plugin `auth`. É o único `request.*` que sobra do `controlPec`.
  - `class NotFoundError extends Error`, que o `errorHandler` responde com `404 { message }`.
  - `todayIso(timezone = env.TIMEZONE, now = new Date()): IsoDate`.
  - `type IsoDate = string`, exportado de `src/lib/today.ts`.
  - `buildTestApp(...plugins)` e `signToken(app, payload)` em `src/test/helpers.ts`.
- Rotas:
  - `POST /users` `{ name, email, password(min 8) }`;
  - `POST /sessions/password`;
  - `POST /sessions/refresh`;
  - `POST /sessions/logout`;
  - `GET /profile` → `{ user: { id, name, email } }`;
  - `GET /health` → `{ status: 'ok' }`.

- [ ] **Step 1: Portar os arquivos.** Do `middlewares/auth.ts`, mantenha só `getCurrentUserId`, sem o bloco de desktop. Do `server.ts`, mantenha só a ordem dos plugins (cors, cookie, jwt, rate-limit, swagger, auth) e registre só as rotas desta task.
- [ ] **Step 2: Testes novos.**

```ts
// today.test.ts
it('usa o fuso de São Paulo na virada do dia', () => {
  expect(todayIso('America/Sao_Paulo', new Date('2026-10-23T02:30:00Z'))).toBe('2026-10-22')
})
// error-handler.test.ts
it('NotFoundError vira 404', async () => { /* rota que lança NotFoundError('x') → status 404, body.message 'x' */ })
// health.test.ts
it('GET /health responde ok', async () => { /* 200, { status: 'ok' } */ })
```

- [ ] **Step 3: Rodar.** Run: `pnpm --filter @myfinances/api test`. Expected: FAIL nos testes novos.
- [ ] **Step 4: Implementar** `today.ts` (com `Intl.DateTimeFormat('en-CA', { timeZone })`), `not-found-error.ts` e `health.ts`.
- [ ] **Step 5: Migration e verificação.** Run: `pnpm --filter @myfinances/api db:migrate --name init && pnpm --filter @myfinances/api test && pnpm --filter @myfinances/api lint`. Expected: tudo PASS. `pnpm --filter @myfinances/api dev` sobe e `curl localhost:3333/health` responde `{"status":"ok"}`.
- [ ] **Step 6: Commit.** `feat(api): esqueleto Fastify e auth por e-mail e senha`

---

### Task 3: Schema financeiro e utilitários básicos

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `src/lib/finance/{money,description-key,categories}.ts` com testes `*.test.ts`

**Interfaces:**
- Produces (Prisma, `@@map` em snake_case como no `controlPec`):
  - enums: `AccountType { BANK CREDIT WALLET }`, `TransactionStatus { PENDING POSTED }`, `TransactionSource { PLUGGY MANUAL SYSTEM }`, `RecurrenceDirection { IN OUT }`, `DayRule { DAY_OF_MONTH NTH_BUSINESS_DAY }`, `NonBusinessDayPolicy { ANTICIPATE POSTPONE KEEP }`, `RecurrenceStatus { SUGGESTED CONFIRMED DISMISSED }`, `PayslipType { MONTHLY ADVANCE THIRTEENTH VACATION }`, `PayslipStatus { UNRECOGNIZED RECOGNIZED MANUAL }`, `PayslipLineKind { EARNING DEDUCTION }`.
  - `Connection`: `id`, `userId`, `pluggyItemId @unique`, `connectorName`, `status String`, `consentExpiresAt DateTime?`, `lastSyncedAt DateTime?`, `lastError String?`, `createdAt`.
  - `Account`: `id`, `userId`, `connectionId?` (Cascade), `pluggyAccountId String? @unique`, `type AccountType`, `name`, `number?`, `balanceCents Int`, `closingDay Int?`, `dueDay Int?`, `updatedAt`. Índice único parcial: uma `WALLET` por usuário, via SQL na migration.
  - `Transaction`:
    - `id`, `userId`, `accountId` (Cascade), `pluggyTransactionId String? @unique`;
    - `date @db.Date`, `description`, `descriptionKey`, `amountCents Int`, `status`, `source`;
    - `pluggyCategory String?`, `category String?`, `categoryLocked Boolean @default(false)`;
    - `isTransfer Boolean @default(false)`, `transferLocked Boolean @default(false)`, `transferPairId String? @unique` (auto-relação, `SetNull`);
    - `installmentNumber Int?`, `totalInstallments Int?`, `createdAt`;
    - `@@index([userId, date])`.
  - `CardBill`: `id`, `userId`, `accountId` (Cascade), `pluggyBillId @unique`, `dueDate @db.Date`, `totalCents Int`, `paidCents Int`.
  - `CategoryRule`: `id`, `userId`, `descriptionKey`, `category`, `@@unique([userId, descriptionKey])`.
  - `Recurrence`: `id`, `userId`, `accountId` (Cascade), `description`, `descriptionKey`, `direction`, `expectedAmountCents Int` (positivo), `dayRule`, `dayValue Int`, `nonBusinessDayPolicy @default(ANTICIPATE)`, `status`, `createdAt`, `@@unique([userId, accountId, descriptionKey, direction])`.
  - `Payslip`: `id`, `userId`, `competence String` (`YYYY-MM`), `type`, `status`, `grossCents Int?`, `netCents Int?`, `fileKey`, `fileName`, `fileSha256`, `createdAt`, `@@unique([userId, fileSha256])`.
  - `PayslipLine`: `id`, `payslipId` (Cascade), `kind`, `description`, `reference String?`, `amountCents Int` (positivo), `position Int`.
- Produces (TS):
  - `toCents(value: number, type: 'CREDIT' | 'DEBIT'): number`;
  - `descriptionKey(description: string): string`;
  - `CATEGORIES` (readonly tuple) e `type Category`;
  - `mapPluggyCategory(raw: string | null | undefined): Category | null`.

- [ ] **Step 1: Testes.**

```ts
expect(toCents(212.45, 'DEBIT')).toBe(-21245)
expect(toCents(-212.45, 'DEBIT')).toBe(-21245)   // sinal vem do type, não do valor
expect(toCents(0.1 + 0.2, 'CREDIT')).toBe(30)    // arredonda, não trunca
expect(descriptionKey('PIX ENVIADO - João Açaí 12/03')).toBe(descriptionKey('Pix enviado joao acai'))
expect(descriptionKey('NETFLIX.COM PARC 02/12')).toBe('netflix com')
expect(mapPluggyCategory('Groceries')).toBe('Mercado')
expect(mapPluggyCategory('algo desconhecido')).toBeNull()
expect(mapPluggyCategory(null)).toBeNull()
```

- [ ] **Step 2: Rodar.** Run: `pnpm --filter @myfinances/api test src/lib/finance`. Expected: FAIL.
- [ ] **Step 3: Implementar.**
  - `descriptionKey`: minúsculas, NFD sem diacríticos, remove `parc nn/nn`, datas e dígitos, troca pontuação por espaço, junta espaços, `trim`, e tira os prefixos `pix enviado`, `pix recebido`, `compra cartao`, `pagamento`.
  - `CATEGORIES = ['Alimentação','Mercado','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Compras','Serviços','Impostos e taxas','Salário','Outras receitas','Outros']`.
  - `mapPluggyCategory`: tabela pequena das categorias em inglês da Pluggy para essas, a partir da lista em https://docs.pluggy.ai (Categories).
- [ ] **Step 4: Migration.** Run: `pnpm --filter @myfinances/api db:migrate --name finance && pnpm --filter @myfinances/api test`. Expected: PASS. A migration contém `CREATE UNIQUE INDEX ... ON accounts(user_id) WHERE type = 'WALLET'`.
- [ ] **Step 5: Commit.** `feat(api): schema financeiro, centavos e chave de descrição`

---

### Task 4: Dias úteis e calendário de recorrentes

**Files:**
- Create: `src/lib/finance/business-days.ts`, `src/lib/finance/recurrence-schedule.ts` + testes

**Interfaces:**
- Produces:
  - `bankHolidays(year: number): Set<IsoDate>` — feriados nacionais fixos (01-01, 04-21, 05-01, 09-07, 10-12, 11-02, 11-15, 11-20, 12-25) mais os móveis pela Páscoa: segunda e terça de Carnaval, Sexta-feira Santa e Corpus Christi.
    - É o calendário bancário. O dinheiro cai em dia de banco *(decisão: dia útil = segunda a sexta fora desses feriados)*.
  - `isBusinessDay(date: IsoDate): boolean`
  - `nthBusinessDay(year: number, month: number /*1-12*/, n: number): IsoDate`
  - `adjustToBusinessDay(date: IsoDate, policy: 'ANTICIPATE' | 'POSTPONE' | 'KEEP'): IsoDate`
  - `type RecurrenceRule = { dayRule: 'DAY_OF_MONTH' | 'NTH_BUSINESS_DAY'; dayValue: number; nonBusinessDayPolicy: 'ANTICIPATE' | 'POSTPONE' | 'KEEP' }`
  - `expectedDates(rule: RecurrenceRule, from: IsoDate, to: IsoDate): IsoDate[]` — uma data por mês, ordenadas, dentro de `[from, to]`.

- [ ] **Step 1: Testes.**

```ts
expect(bankHolidays(2026).has('2026-02-17')).toBe(true)   // terça de Carnaval
expect(bankHolidays(2026).has('2026-04-03')).toBe(true)   // Sexta-feira Santa
expect(bankHolidays(2026).has('2026-06-04')).toBe(true)   // Corpus Christi
expect(nthBusinessDay(2026, 11, 5)).toBe('2026-11-09')    // 02/11 feriado
expect(nthBusinessDay(2026, 9, 5)).toBe('2026-09-08')     // 07/09 feriado
expect(adjustToBusinessDay('2026-12-20', 'ANTICIPATE')).toBe('2026-12-18')
expect(adjustToBusinessDay('2026-12-20', 'POSTPONE')).toBe('2026-12-21')
expect(adjustToBusinessDay('2026-12-20', 'KEEP')).toBe('2026-12-20')
const r31 = { dayRule: 'DAY_OF_MONTH', dayValue: 31, nonBusinessDayPolicy: 'KEEP' } as const
expect(expectedDates(r31, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
const r28a = { dayRule: 'DAY_OF_MONTH', dayValue: 28, nonBusinessDayPolicy: 'ANTICIPATE' } as const
expect(expectedDates(r28a, '2026-02-01', '2026-02-28')).toEqual(['2026-02-27']) // 28/02/2026 é sábado
const salary = { dayRule: 'NTH_BUSINESS_DAY', dayValue: 5, nonBusinessDayPolicy: 'ANTICIPATE' } as const
expect(expectedDates(salary, '2026-10-22', '2026-12-31')).toEqual(['2026-11-09', '2026-12-07'])
```

- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.** Páscoa pelo algoritmo de Meeus/Butcher. Toda conta de data em UTC sobre `YYYY-MM-DD`, sem depender do fuso da máquina.
  - `DAY_OF_MONTH`: `min(dayValue, últimoDia)`, depois a política.
  - `NTH_BUSINESS_DAY`: ignora a política, porque já cai em dia útil.
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): dias úteis bancários e calendário de recorrentes`

---

### Task 5: Faturas de cartão calculadas

**Files:**
- Create: `src/lib/finance/card-bills.ts` + teste

**Interfaces:**
- Consumes: `IsoDate`.
- Produces:

```ts
type CardTx = { date: IsoDate; amountCents: number; isTransfer: boolean; installmentNumber?: number | null; totalInstallments?: number | null; description: string }
type PluggyBillLite = { dueDate: IsoDate; totalCents: number; paidCents: number }
type CardBillView = { accountId: string; closeDate: IsoDate; dueDate: IsoDate; amountCents: number; paidCents: number; remainingCents: number; status: 'CLOSED' | 'OPEN' | 'FUTURE'; transactions: CardTx[] }
function computeCardBills(input: { accountId: string; closingDay: number; dueDay: number; transactions: CardTx[]; pluggyBills: PluggyBillLite[]; today: IsoDate }): CardBillView[]
```

As regras:
- **Ciclo do vencimento de um mês M:**
  - Fecha no `closingDay` (limitado ao fim do mês). O fechamento fica no mesmo mês de M quando `closingDay < dueDay`, e no mês anterior quando não.
  - O ciclo inclui as transações com data em `(fechamentoAnterior, fechamento]`.
- **Valores do ciclo:**
  - `amountCents = −Σ amountCents` das transações não transferência do ciclo. É positivo quando há dívida, e um estorno abate.
  - `paidCents = Σ amountCents` das transações `isTransfer` positivas com data em `(fechamento, próximoFechamento]`.
- **Fatura da Pluggy:** se houver uma com `dueDate` a até 3 dias do vencimento calculado, `amountCents` passa a ser o `totalCents` dela e `paidCents = max(pluggy.paidCents, calculado)`.
- **Status:**
  - `CLOSED` se `today > closeDate`;
  - `OPEN` se `today` cai dentro do ciclo;
  - `FUTURE` se ainda vem.
- **Quais faturas retornar:** da última fechada até a última que tem transação, ou seja, as parcelas futuras que a Pluggy entrega como `PENDING` datadas no futuro. No máximo 12 faturas à frente.

- [ ] **Step 1: Testes.** Cartão com `closingDay: 3, dueDay: 10` e `today: '2026-10-01'`:
  - compra de −100,00 em 25/09 → fatura de vencimento 2026-10-10, `OPEN`, `amountCents: 10000`;
  - compra de −50,00 em 05/10 → fatura de 2026-11-10, `FUTURE`;
  - pagamento `isTransfer` de +100,00 em 08/10 → `paidCents` da fatura de outubro = 10000 e `remainingCents` = 0;
  - estorno de +20,00 não transferência no ciclo → `amountCents` 8000;
  - fatura da Pluggy com vencimento 2026-10-11 e total 12345 → `amountCents` 12345;
  - parcela 3/3 datada em 2026-12-20 → existe fatura com vencimento 2027-01-10;
  - `closingDay: 28, dueDay: 5` → a fatura de vencimento 2026-11-05 fecha em 2026-10-28.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): cálculo de faturas por ciclo`

---

### Task 6: Projeção da tela inicial

**Files:**
- Create: `src/lib/finance/projection.ts` + teste

**Interfaces:**
- Consumes: `expectedDates`, `RecurrenceRule` (Task 4) e `CardBillView` (Task 5).
- Produces:

```ts
type ProjectionTx = { accountId: string; date: IsoDate; amountCents: number; descriptionKey: string; isTransfer: boolean }
type ProjectionRecurrence = RecurrenceRule & { id: string; accountId: string; accountType: 'BANK' | 'CREDIT' | 'WALLET'; direction: 'IN' | 'OUT'; description: string; descriptionKey: string; expectedAmountCents: number }
type Payable = { kind: 'BILL' | 'RECURRENCE'; refId: string; description: string; dueDate: IsoDate; amountCents: number }
type Projection = {
  today: IsoDate; balanceCents: number
  nextIncome: { recurrenceId: string; description: string; date: IsoDate; amountCents: number } | null
  windowEnd: IsoDate; days: number; noIncomeConfigured: boolean
  payables: Payable[]; payableTotalCents: number; availableCents: number; perDayCents: number
}
function isOccurrenceMatched(rec: ProjectionRecurrence, expected: IsoDate, txs: ProjectionTx[]): boolean
function computeProjection(input: { today: IsoDate; accounts: { id: string; type: 'BANK' | 'CREDIT' | 'WALLET'; balanceCents: number }[]; recurrences: ProjectionRecurrence[]; transactions: ProjectionTx[]; cardBills: CardBillView[] }): Projection
```

As regras (spec, seção Objetivos 1):
- **`balanceCents`:** soma das contas `BANK` e `WALLET`.
- **Ocorrência cumprida:** existe transação não transferência na mesma conta, com o mesmo sinal da direção e data a até 5 dias da data esperada, que tenha o mesmo `descriptionKey` ou valor a até 10% de `expectedAmountCents`.
- **Próximo recebimento:**
  - Considera os recorrentes `IN` de contas `BANK` ou `WALLET` (`recurrences` já chega só com os confirmados).
  - É a menor data esperada não cumprida em `[today−5, today+62]`, com `date = max(data, today)`.
  - `windowEnd` = essa data. Sem nenhuma, `windowEnd` = último dia do mês e `noIncomeConfigured = true`.
- **Payables:**
  - Recorrentes `OUT` de contas `BANK` ou `WALLET` com data esperada não cumprida em `[today−5, windowEnd]`, valor `expectedAmountCents`. Recorrente de conta `CREDIT` nunca entra, porque já está na fatura.
  - Faturas com `remainingCents > 0` e `dueDate` em `[today−5, windowEnd]`, valor `remainingCents`.
  - Ordenados por `dueDate`.
- **Totais:**
  - `availableCents = balanceCents − payableTotalCents`. O recebimento que fecha a janela não entra.
  - `days = max(1, diasEntre(today, windowEnd))`.
  - `perDayCents = Math.trunc(availableCents / days)`.

- [ ] **Step 1: Testes.** Cenários, todos com `today` explícito:
  1. Hoje 2026-10-25, saldo 3.000,00, salário (5º dia útil) e vale (dia 20, ANTICIPATE) confirmados, com o vale já caído (transação de entrada em 2026-10-20). Aluguel `OUT` dia 1 de 1.500,00, ANTICIPATE, em conta bancária, e fatura com vencimento 03/11 de 800,00.
     - `nextIncome.date` = 2026-11-09.
     - `payables` = aluguel 2026-10-30 (o dia 01/11/2026 é domingo e o sábado 31/10 também não é útil) e a fatura de 2026-11-03.
     - `availableCents` = 300000 − 150000 − 80000 = 70000.
     - `days` = 15.
     - `perDayCents` = 4666.
  2. Recorrente `OUT` em conta `CREDIT` (Netflix) não aparece em `payables`.
  3. Mesmo cenário com `today` 2026-10-31 e transação de −1.500,00 na conta em 30/10 → aluguel cumprido e fora de `payables`.
  4. Sem recorrente `IN` → `noIncomeConfigured: true` e `windowEnd: '2026-10-31'`.
  5. Salário previsto para hoje e ainda não caído → `days: 1` e `perDayCents === availableCents`.
  6. Saldo 100,00 e a pagar 500,00 → `availableCents: -40000` e `perDayCents` negativo.
  7. Conta `CREDIT` com saldo não entra em `balanceCents`.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): projeção até o próximo recebimento`

---

### Task 7: Cliente Pluggy e sincronização de uma conexão

**Files:**
- Create: `src/lib/pluggy/{types,client}.ts` + `client.test.ts`
- Create: `src/lib/finance/detect-transfers.ts` + teste
- Create: `src/services/{wallet,sync-connection}.ts` + `sync-connection.test.ts` (Prisma mockado, como no `controlPec`)

**Interfaces:**
- Produces, no `lib/pluggy` (formatos conferidos na referência da API: `POST /auth`, `GET /items/{id}`, `GET /accounts?itemId=`, `GET /v2/transactions?accountId=&dateFrom=&after=`, `GET /bills?accountId=`):

```ts
type PluggyItem = { id: string; status: string; connector: { name: string }; consentExpiresAt?: string | null; error?: { code: string; message: string } | null }
type PluggyAccount = { id: string; type: 'BANK' | 'CREDIT'; subtype: string; name: string; number?: string; balance: number; creditData?: { balanceDueDate?: string; creditLimit?: number } | null }
type PluggyTransaction = { id: string; accountId: string; date: string; description: string; amount: number; type: 'CREDIT' | 'DEBIT'; status: 'PENDING' | 'POSTED'; category?: string | null; creditCardMetadata?: { installmentNumber?: number; totalInstallments?: number } | null }
type PluggyBill = { id: string; dueDate: string; totalAmount: number; payments?: { amount: number }[] }
class PluggyNotFoundError extends Error {}
function createPluggyClient(opts: { baseUrl: string; clientId: string; clientSecret: string; fetch?: typeof fetch; now?: () => number }): {
  getItem(itemId: string): Promise<PluggyItem>
  listAccounts(itemId: string): Promise<PluggyAccount[]>
  listTransactions(accountId: string, dateFrom: IsoDate): Promise<PluggyTransaction[]>
  listBills(accountId: string): Promise<PluggyBill[]>
}
export const pluggy = createPluggyClient({ baseUrl: env.PLUGGY_BASE_URL, ... })
```

- Produces, no `detect-transfers.ts`:
  - `isBillPaymentDescription(d: string): boolean` — `/pag(amento|to)?\.?\s*(de\s*)?fatura/i`;
  - `isWithdrawalDescription(d: string): boolean` — `/\bsaque\b/i`;
  - `detectTransferPairs(txs: { id: string; accountId: string; date: IsoDate; amountCents: number; isTransfer: boolean; transferLocked: boolean }[]): [string, string][]`. Forma o par com contas diferentes, `amountCents` opostos e iguais, e datas a até 3 dias. Ignora transações já `isTransfer` ou `transferLocked`. Cada transação entra em no máximo um par; ganha a data mais próxima e, no empate, a primeira pelo id.
- Produces, no `wallet.ts`:
  - `ensureWalletAccount(userId: string): Promise<Account>`: upsert da conta `WALLET` "Carteira";
  - `recomputeWalletBalance(walletId: string): Promise<void>`: o saldo é a soma das transações dela.
- Produces, no `sync-connection.ts`: `syncConnection(connectionId: string, opts?: { client?: PluggyClient; today?: IsoDate }): Promise<void>`, que:
  1. Lê o item e atualiza `status`, `connectorName`, `consentExpiresAt` e `lastError`.
  2. Faz upsert das contas por `pluggyAccountId`. Na conta `CREDIT`, preenche `dueDay` e `closingDay` (= dia de `due − 7`) a partir de `creditData.balanceDueDate`, mas só quando ainda estão nulos.
  3. Busca as transações a partir de `lastSyncedAt − 30 dias`, ou de `today − 365` na primeira vez. Faz upsert por `pluggyTransactionId`, atualizando também o `accountId`, porque um item renovado pode trazer contas novas.
     - `amountCents = toCents(amount, type)` e `descriptionKey` preenchida.
     - `category` = regra do usuário, senão `mapPluggyCategory`, e só quando `categoryLocked = false`.
  4. Faz upsert das faturas das contas `CREDIT` por `pluggyBillId`.
  5. Pareia as transferências do usuário nos últimos 90 dias com `detectTransferPairs` e grava `isTransfer` e `transferPairId` nos dois lados.
     - Débito em conta `BANK` com `isBillPaymentDescription` e sem par vira `isTransfer` sozinho.
     - Débito com `isWithdrawalDescription` e sem par cria uma transação `SYSTEM` de `+|valor|` na Carteira, pareada com ele.
  6. Grava `lastSyncedAt = now` e `lastError = null`.
  - Se a Pluggy falhar, grava `lastError` com a mensagem e relança.

- [ ] **Step 1: Testes do cliente** (`fetch` mockado):
  - `POST /auth` é chamado uma vez para duas chamadas seguidas;
  - depois de 100 min (`now` avançado), autentica de novo;
  - `listTransactions` segue `next` até `null` e concatena `results`;
  - 404 em `getItem` vira `PluggyNotFoundError`;
  - o header `X-API-KEY` vai em toda chamada.
- [ ] **Step 2: Testes de `detectTransferPairs`:**
  - −500 no banco A em 10/10 com +500 no banco B em 11/10 → par;
  - a mesma coisa com 4 dias de diferença → sem par;
  - duas candidatas → pareia a de data mais próxima;
  - `transferLocked` fica de fora;
  - `isBillPaymentDescription('PAGTO FATURA NUBANK') === true`.
- [ ] **Step 3: Testes do sync** (Prisma e cliente mockados):
  - primeira sincronização usa `dateFrom = today − 365`;
  - **o mesmo `pluggyTransactionId` vindo numa conta nova (item renovado) faz update, não create** (Review Focus 1);
  - categoria travada não é sobrescrita;
  - saque cria a transação `SYSTEM` na Carteira, pareada;
  - erro da Pluggy grava `lastError`.
- [ ] **Step 4: Rodar.** Expected: FAIL.
- [ ] **Step 5: Implementar.**
- [ ] **Step 6: Rodar.** Expected: PASS.
- [ ] **Step 7: Commit.** `feat(api): cliente Pluggy e sincronização`

---

### Task 8: Rotas de conexões, contas e sincronização

**Files:**
- Create: `src/http/routes/connections/{create-connection,get-connections,delete-connection,sync-connection,sync-all}.ts` + testes
- Create: `src/http/routes/accounts/get-accounts.ts` + teste
- Modify: `src/http/server.ts` (registrar)

**Interfaces:**
- Consumes: `pluggy.getItem` e `syncConnection` (Task 7).
- Rotas, todas autenticadas e filtradas por `userId`:
  - `POST /connections` `{ itemId: uuid }`:
    - chama `getItem`, que dá 400 "Item não encontrado na Pluggy" se vier `PluggyNotFoundError`;
    - 409 se o `pluggyItemId` já existir para qualquer usuário;
    - se não, cria e roda `syncConnection` → `201 { connection }`.
  - `GET /connections` → `{ connections: { id, connectorName, status, consentExpiresAt, lastSyncedAt, lastError }[] }`.
  - `DELETE /connections/:id` → 204. Apaga contas e transações em cascata e não mexe na Pluggy. 404 se não for do usuário.
  - `POST /connections/:id/sync` → 204.
  - `POST /sync` → `{ synced: number }`. Sincroniza as conexões do usuário com `lastSyncedAt` nulo ou com mais de **6 h**, ou todas com `?force=true`, uma de cada vez.
    - Uma falha não impede as outras e fica registrada em `lastError`.
    - O web chama esta rota ao abrir o app.
  - `GET /accounts` → `{ accounts: { id, type, name, number, balanceCents, closingDay, dueDay, connectorName }[] }`, incluindo a Carteira (`ensureWalletAccount`).

- [ ] **Step 1: Testes** com `buildTestApp` e Prisma mockado, um por regra acima. Inclua: o usuário B tenta `DELETE` e `sync` na conexão do usuário A → 404.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar e registrar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): conexões e sincronização sob demanda`

---

### Task 9: Webhook da Pluggy

**Files:**
- Create: `src/http/routes/webhooks/pluggy-webhook.ts` + teste
- Create: `src/scripts/register-pluggy-webhook.ts` (script `pluggy:webhook <url>`)
- Modify: `src/http/server.ts` (registra só se `env.PLUGGY_WEBHOOK_SECRET`)

**Interfaces:**
- Consumes: `syncConnection`.
- `POST /webhooks/pluggy`, sem auth de usuário e com o rate-limit global:
  - Header `x-myfinances-webhook-secret` diferente do configurado → 401 (`timingSafeEqual` com buffers de mesmo tamanho).
  - Body validado: `{ event: string, itemId?: string, transactionIds?: string[] }` → 400 se inválido.
  - Responde `202` e processa com `setImmediate`, fora do ciclo da resposta, porque a Pluggy exige 2XX em até 10 s.
    - `item/updated`, `item/created`, `transactions/created` e `transactions/updated`: acha a `Connection` pelo `itemId` e roda `syncConnection`. `itemId` desconhecido é ignorado.
    - `item/error`: grava `status` e `lastError` a partir de `GET /items/{id}`.
    - `transactions/deleted`: `deleteMany` por `pluggyTransactionId in transactionIds`.
  - Erros no processamento vão para `request.log.error` e nunca derrubam o processo.
- Script: `POST {PLUGGY_BASE_URL}/webhooks` com `{ url, event: 'all', headers: { 'x-myfinances-webhook-secret': env.PLUGGY_WEBHOOK_SECRET } }`.

- [ ] **Step 1: Testes:**
  - sem header → 401;
  - header errado com o mesmo tamanho → 401;
  - body sem `event` → 400;
  - `item/updated` com `itemId` conhecido → 202 e `syncConnection` chamado com o id;
  - `itemId` desconhecido → 202 e nada chamado;
  - o mesmo evento duas vezes → `syncConnection` duas vezes, sem erro (o sync é idempotente);
  - `transactions/deleted` → `deleteMany` com os ids;
  - `syncConnection` rejeitando → 202 e o processo segue;
  - com `PLUGGY_WEBHOOK_SECRET` ausente, a rota não existe → 404.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): webhook da Pluggy autenticado por header`

---

### Task 10: Detecção de recorrentes e rotas de recorrentes

**Files:**
- Create: `src/lib/finance/detect-recurrences.ts` + teste
- Create: `src/services/detect-and-store-recurrences.ts` + teste
- Create: `src/http/routes/recurrences/{get-recurrences,create-recurrence,update-recurrence,dismiss-recurrence}.ts` + testes
- Modify: `src/services/sync-connection.ts`: chama `detectAndStoreRecurrences(userId)` logo antes de gravar `lastSyncedAt`. Acrescente esse teste ao `sync-connection.test.ts`.

**Interfaces:**
- Consumes: `nthBusinessDay` (Task 4).
- Produces:

```ts
type RecurrenceCandidate = { accountId: string; descriptionKey: string; description: string; direction: 'IN' | 'OUT'; expectedAmountCents: number; dayRule: 'DAY_OF_MONTH' | 'NTH_BUSINESS_DAY'; dayValue: number }
function detectRecurrenceCandidates(txs: { accountId: string; date: IsoDate; amountCents: number; description: string; descriptionKey: string; isTransfer: boolean }[], known: { accountId: string; descriptionKey: string; direction: 'IN' | 'OUT' }[], today: IsoDate): RecurrenceCandidate[]
function detectAndStoreRecurrences(userId: string): Promise<number> // cria SUGGESTED, retorna quantos
```

Limiares *(decisão do plano)*:
- **Janela e agrupamento:** olha 180 dias para trás e ignora transferências. Agrupa por `(accountId, descriptionKey, sinal)`.
- **Quando um grupo vira candidato:**
  - aparece em pelo menos **3 meses distintos**;
  - todo valor está a até **10%** da mediana;
  - a diferença entre o maior e o menor dia do mês é de no máximo **6**.
- **Valores sugeridos:**
  - `expectedAmountCents` = mediana em valor absoluto;
  - `dayValue` = mediana dos dias.
- **Quando sugerir `NTH_BUSINESS_DAY`:** só para `IN`, quando existe um `n` entre 1 e 10 tal que toda ocorrência cai exatamente em `nthBusinessDay(ano, mês, n)`.
- **Grupos já conhecidos:** um grupo que já existe em `known`, em qualquer status, inclusive `DISMISSED`, nunca volta. O `@@unique` do banco garante isso também.

Rotas:
- `GET /recurrences?status=` → lista com `account { name, type }`.
- `POST /recurrences`: manual, nasce `CONFIRMED`. Recebe `{ accountId, description, direction, expectedAmountCents, dayRule, dayValue(1..31, ou 1..23 no NTH), nonBusinessDayPolicy }`. Conta de outro usuário → 404.
- `PATCH /recurrences/:id`: mesmos campos, todos opcionais, mais `status: 'CONFIRMED'`. É assim que se confirma uma sugestão.
- `POST /recurrences/:id/dismiss` → `status DISMISSED`.

- [ ] **Step 1: Testes da detecção:**
  - Netflix −39,90 em 3 meses, dias 10, 11 e 10 → candidato `DAY_OF_MONTH` 10 com 3990;
  - salário em 2026-08-07, 2026-09-08 e 2026-10-07 → `NTH_BUSINESS_DAY` 5;
  - só 2 meses → nada;
  - valores 100, 100 e 150 → nada;
  - descartado em `known` → nada;
  - transferência → nada.
- [ ] **Step 2: Testes das rotas:**
  - criar com conta de outro usuário → 404;
  - `dayValue: 0` → 400;
  - confirmar uma sugestão muda o status;
  - descartar e rodar `detectAndStoreRecurrences` de novo não recria.
- [ ] **Step 3: Rodar.** Expected: FAIL.
- [ ] **Step 4: Implementar e registrar.**
- [ ] **Step 5: Rodar.** Expected: PASS.
- [ ] **Step 6: Commit.** `feat(api): recorrentes sugeridos e confirmados`

---

### Task 11: Transações, categorias e lançamento manual

**Files:**
- Create: `src/http/routes/transactions/{get-transactions,update-transaction-category,update-transaction-transfer,create-manual-transaction,delete-manual-transaction}.ts` + testes
- Create: `src/http/routes/categories/get-categories.ts`

**Interfaces:**
- Consumes: `CATEGORIES`, `descriptionKey`, `ensureWalletAccount` e `recomputeWalletBalance`.
- Rotas:
  - `GET /transactions?from&to&accountId&category&kind=income|expense|transfer&page=1`
    - Página de 50, ordenada por `date desc, id`.
    - `kind`: income = `amountCents > 0` e não transferência; expense = `< 0` e não transferência; transfer = `isTransfer`.
    - `category=none` traz as nulas.
    - Resposta: `{ transactions: [...], page, totalPages }`, com `account { name, type }`.
  - `PATCH /transactions/:id/category { category: z.enum(CATEGORIES) }`
    - grava a categoria com `categoryLocked = true`;
    - faz upsert de `CategoryRule(userId, descriptionKey)`;
    - aplica a mesma categoria às transações do usuário com a mesma chave e `categoryLocked = false`.
  - `PATCH /transactions/:id/transfer { isTransfer: boolean }`
    - grava nos dois lados do par: `transferLocked = true`;
    - com `false`, desfaz o `transferPairId`.
  - `POST /transactions` `{ date, description, amountCents (≠0), category? }` → cria na Carteira, `source MANUAL`, e recalcula o saldo.
  - `DELETE /transactions/:id` → só `MANUAL` (400 caso contrário). Recalcula o saldo.
  - `GET /categories` → `{ categories: CATEGORIES }`.

- [ ] **Step 1: Testes:**
  - o filtro `kind=expense` exclui transferências;
  - trocar a categoria cria a regra e atualiza as irmãs não travadas, mas não as travadas;
  - categoria fora da lista → 400;
  - desmarcar a transferência destrava os dois lados;
  - lançamento manual cai na Carteira e muda o saldo;
  - apagar transação `PLUGGY` → 400;
  - B acessa transação de A → 404.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar e registrar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): transações, categorias e lançamento manual`

---

### Task 12: Rotas de cartões e de painel

**Files:**
- Create: `src/services/load-finance-snapshot.ts` + teste
- Create: `src/http/routes/cards/{get-cards,update-card-cycle}.ts` + testes
- Create: `src/http/routes/dashboard/get-dashboard.ts` + teste

**Interfaces:**
- Consumes: `computeCardBills` (Task 5), `computeProjection` (Task 6) e `todayIso`.
- Produces: `loadFinanceSnapshot(userId: string, today: IsoDate): Promise<{ accounts; cardBills: CardBillView[]; cardsMissingCycle: { id: string; name: string }[]; recurrences: ProjectionRecurrence[]; transactions: ProjectionTx[] }>`.
  - Busca as transações de `today − 400 dias` até `+400 dias`.
  - Só traz recorrentes `CONFIRMED`.
  - Cartão sem `closingDay` ou `dueDay` vai para `cardsMissingCycle` e fica fora das faturas.
- Rotas:
  - `GET /cards` → `{ cards: { account, bills: CardBillView[] }[], cardsMissingCycle }`.
  - `PATCH /cards/:accountId { closingDay: 1..31, dueDay: 1..31 }` → 404 se não for `CREDIT` do usuário.
  - `GET /dashboard` → `Projection & { cardsMissingCycle }`.

- [ ] **Step 1: Testes:**
  - o snapshot separa o cartão sem ciclo;
  - `/dashboard` devolve `availableCents` calculado a partir de dados mockados;
  - `PATCH /cards` em conta `BANK` → 404;
  - `closingDay: 32` → 400.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar e registrar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): faturas por cartão e painel`

---

### Task 13: Storage R2

**Files:**
- Create: `src/lib/{storage,s3-endpoint}.ts` + testes. `s3-endpoint` é portado como está. `storage` fica enxuto.

**Interfaces:**
- Produces:
  - `MAX_PAYSLIP_BYTES = 5 * 1024 * 1024`;
  - `payslipKey(userId: string): string` → `${userId}/payslips/${randomUUID()}.pdf`;
  - `putFile(key: string, body: Buffer, contentType: 'application/pdf'): Promise<void>`;
  - `getSignedFileUrl(key: string, downloadName: string): Promise<string>`: GET assinado de 900 s, com `ResponseContentType: 'application/pdf'` e `ResponseContentDisposition: attachment; filename="<downloadName sanitizado>"`;
  - `deleteFile(key: string): Promise<void>`: loga e engole o erro, como o `deleteFiles` do `controlPec`.
- Sem CORS no bucket: o navegador nunca fala direto com o R2 para enviar, e o download é por navegação.

- [ ] **Step 1: Testes** (o S3Client mockado com `vi.mock('@aws-sdk/client-s3')`):
  - a chave começa com o `userId`;
  - o nome do download tem aspas e quebras de linha removidas;
  - `deleteFile` não lança quando o SDK falha.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): storage R2 para holerites`

---

### Task 14: Holerites na API

**Files:**
- Create: `src/lib/payslip/parse.ts` + teste
- Create: `src/http/routes/payslips/{upload-payslip,get-payslips,get-payslip,update-payslip-lines,get-payslip-file,delete-payslip}.ts` + testes
- Modify: `src/http/server.ts` (registrar `@fastify/multipart` com `limits: { fileSize: MAX_PAYSLIP_BYTES, files: 1 }`)

**Interfaces:**
- Consumes: `storage` (Task 13).
- Produces: `parsePayslip(pdf: Buffer): ParsedPayslip | null`, com `ParsedPayslip = { competence: string; grossCents: number; netCents: number; lines: { kind: 'EARNING' | 'DEDUCTION'; description: string; reference: string | null; amountCents: number }[] }`.
  - Na v1 não há layout conhecido e a função sempre retorna `null`. O leitor do layout da empresa do João entra aqui quando houver um PDF de exemplo, e aí também a rota `POST /payslips/:id/reprocess`.
- Rotas:
  - `POST /payslips` (multipart: `file`, `competence` `YYYY-MM`, `type` `PayslipType`):
    - arquivo que não começa com `%PDF-` → 400 "Envie um PDF";
    - estourou o tamanho → 413 "O arquivo passa de 5 MB" (trate `FST_REQ_FILE_TOO_LARGE` no `errorHandler`);
    - mesmo `sha256` para o usuário → 409 `{ message, payslipId }`;
    - se não, `putFile` e cria com `status` `RECOGNIZED` se `parsePayslip` retornar algo, ou `UNRECOGNIZED` → 201 `{ payslip }`;
    - se a gravação no banco falhar depois do upload, chama `deleteFile` (sem arquivo órfão).
  - `GET /payslips` → lista ordenada por `competence desc`, com `type`, `status`, `grossCents` e `netCents`.
  - `GET /payslips/:id` → `{ payslip, lines, reconciliation: { matched: boolean; transaction: { id, date, amountCents, description } | null } }`.
    - A conferência procura transação de entrada não transferência do usuário com `|amountCents − netCents| ≤ 100` e data entre o 1º dia da competência e o dia 15 do mês seguinte, e escolhe a de data mais próxima do 5º dia útil do mês seguinte (MONTHLY) ou do dia 20 da competência (ADVANCE).
    - Sem `netCents` → `matched: false` e `transaction: null`.
  - `PUT /payslips/:id/lines { grossCents?, netCents, lines[] }` → troca todas as linhas (`position` = índice) e grava `status MANUAL`.
  - `GET /payslips/:id/file` → `{ url }`.
  - `DELETE /payslips/:id` → apaga a linha e depois `deleteFile` → 204.

- [ ] **Step 1: Testes:**
  - `parsePayslip(Buffer.from('%PDF-1.4 qualquer'))` → `null`;
  - texto renomeado para `.pdf` → 400;
  - 6 MB → 413;
  - o mesmo PDF duas vezes → 409 com `payslipId`;
  - PDF válido → 201 com status `UNRECOGNIZED` e `putFile` chamado com uma chave que começa com o userId;
  - falha no `prisma.payslip.create` → `deleteFile` chamado;
  - `PUT lines` → status `MANUAL`;
  - conferência acha o depósito de 4.321,00 em 2026-11-09 para a competência 2026-10 com líquido 4.320,50;
  - competência `2026-13` → 400.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar e registrar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(api): holerites com upload, conferência e lançamento manual`

---

### Task 15: Isolamento entre usuários (integração com banco real)

**Files:**
- Create: `apps/api/src/http/routes/isolation.integration.test.ts`
- Create: `.env.e2e.example` com `DATABASE_URL=postgresql://docker:docker@localhost:5435/myfinances_test`

**Interfaces:**
- Consumes: todas as rotas das Tasks 8 a 12 e 14, montadas com `buildTestApp` e Prisma real.

- [ ] **Step 1: Escrever o teste.** Crie os usuários A e B direto no banco. Para A, crie conexão, conta, transação, recorrente, cartão e holerite (com o storage mockado). Com o token de B:
  - todo `GET` de lista (`/connections`, `/accounts`, `/transactions`, `/recurrences`, `/cards`, `/payslips`) vem sem nenhum item de A. `/accounts` traz só a Carteira de B;
  - todo acesso por id de A (`DELETE /connections/:id`, `POST /connections/:id/sync`, `PATCH /transactions/:id/category`, `PATCH /transactions/:id/transfer`, `PATCH /recurrences/:id`, `POST /recurrences/:id/dismiss`, `PATCH /cards/:id`, `GET /payslips/:id`, `GET /payslips/:id/file`, `PUT /payslips/:id/lines`, `DELETE /payslips/:id`) → 404;
  - `/dashboard` de B tem `balanceCents: 0`.
- [ ] **Step 2: Rodar.** Run: `pnpm --filter @myfinances/api env:load:e2e prisma migrate deploy && pnpm --filter @myfinances/api test:integration`. Expected: PASS. Se alguma rota vazar, corrija a rota e não o teste.
- [ ] **Step 3: Commit.** `test(api): isolamento entre usuários`

---

### Task 16: Esqueleto do web com login e cadastro

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,tsconfig.node.json,vite.config.ts,postcss.config.mjs,components.json,index.html}`, portados.
  - Sem os plugins de SEO, prerender e env-guard.
  - Dependências: as do `controlPec` web, sem CASL, `read-excel-file`, `exceljs`, `sharp`, `zustand` e Playwright.
- Create (portados): `src/{main.tsx,App.tsx,index.css,vite-env.d.ts}`, `src/components/ui/*` (alert-dialog, badge, button, calendar, card, dialog, dropdown-menu, input, label, popover, select, separator, sheet, sidebar, skeleton, sonner, table, tabs, textarea, tooltip, use-mobile), `src/lib/{cookies,utils,react-query}.ts`, `src/http/{api,get-api-error-message}.ts`, `src/auth/{auth-context,end-session}.tsx`, `src/components/protected-route.tsx`, `src/test/setup.ts`
- Create: `src/http/auth.ts`, `src/pages/{login,register}.tsx`, `src/components/{app-layout,app-sidebar}.tsx`, `src/router.tsx`, `src/lib/format.ts` + testes

**Interfaces:**
- Produces:
  - `formatBRL(cents: number): string` → `formatBRL(-123456) === '-R$ 1.234,56'` (com `Intl`, espaço normal);
  - `formatDate(iso: IsoDate): string` → `'22/10/2026'`;
  - Rotas: `/login`, `/register`, e dentro de `ProtectedRoute` + `AppLayout`: `/`, `/transacoes`, `/cartoes`, `/recorrentes`, `/holerites`, `/holerites/:id`, `/conexoes`;
  - Itens da sidebar com ícones lucide: Início, Transações, Cartões, Recorrentes, Holerites, Conexões.

- [ ] **Step 1: Testes:**
  - `formatBRL` com valores positivo, negativo e zero;
  - `formatDate`;
  - `ProtectedRoute` sem token redireciona para `/login` (portado);
  - o envio do login chama `POST sessions/password` e navega para `/`;
  - o cadastro valida senha de no mínimo 8 caracteres.
- [ ] **Step 2: Rodar.** Run: `pnpm --filter web test`. Expected: FAIL nos novos.
- [ ] **Step 3: Implementar.** As páginas ainda não feitas viram um placeholder de uma linha.
- [ ] **Step 4: Verificar.** Run: `pnpm --filter web test && pnpm --filter web build`. Expected: PASS. Com `pnpm dev`, dá para cadastrar, entrar e sair.
- [ ] **Step 5: Commit.** `feat(web): esqueleto, login e cadastro`

---

### Task 17: Tela Início

**Files:**
- Create: `src/http/dashboard.ts` (`getDashboard()`, `syncAll()`), `src/pages/home.tsx` + `home.test.tsx`

**Interfaces:**
- Consumes: `GET /dashboard` e `POST /sync`.
- Ao montar, chama `syncAll()` uma vez. Quando ele termina, invalida `['dashboard']`. Falha vira um toast sonner sem bloquear.
- Três cards:
  - **Saldo hoje** (`balanceCents`);
  - **A pagar até {data do próximo recebimento}**: total e lista de `payables` com data, descrição e valor;
  - **Quanto posso gastar**: `availableCents` em destaque, em vermelho se negativo, e a linha "{formatBRL(perDayCents)}/dia até {nextIncome.description} ({formatDate})".
- `noIncomeConfigured` → aviso "Confirme seu salário em Recorrentes para a projeção ir até o próximo recebimento", com link.
- `cardsMissingCycle` não vazio → aviso com link para Cartões.
- Botão "Sincronizar" → `POST /sync?force=true`.

- [ ] **Step 1: Testes** (`http/dashboard` mockado):
  - mostra 'R$ 700,00' e 'R$ 46,66/dia até Salário';
  - valor negativo tem a classe de destaque vermelho;
  - `noIncomeConfigured` mostra o aviso;
  - `syncAll` é chamado uma vez ao montar.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): tela Início`

---

### Task 18: Telas Transações e Conexões

**Files:**
- Create: `src/http/{transactions,connections}.ts`, `src/pages/{transactions,connections}.tsx` + testes, `src/components/manual-transaction-dialog.tsx`

**Interfaces:**
- **Transações:**
  - Filtros de período (padrão: mês atual), conta, categoria e tipo, guardados em search params.
  - Tabela com data, descrição, conta, categoria (um select que chama `PATCH .../category`), valor colorido por sinal e um badge "Transferência" com ação de desfazer ou marcar.
  - Paginação e botão "Lançar manualmente", que abre o diálogo de entrada ou saída: um switch define o sinal, o valor é digitado em reais e convertido para centavos.
  - Lançamento manual tem botão de excluir.
- **Conexões:**
  - Lista com banco, status, "Autorização vence em {consentExpiresAt}" (alerta se faltar menos de 30 dias), último sync, `lastError` e os botões "Sincronizar" e "Remover" (com confirmação via alert-dialog).
  - Formulário "Adicionar conexão" com campo `itemId` e o passo a passo fixo:
    1. Conecte seus bancos em meu.pluggy.ai.
    2. No Dashboard da Pluggy, abra Applications → sua aplicação → Demo → Connect Account → MeuPluggy.
    3. Copie o itemId de cada banco e cole aqui.
  - Aviso fixo: "O Meu Pluggy permite até 5 conexões e só uso pessoal."

- [ ] **Step 1: Testes:**
  - trocar a categoria chama a API com a categoria escolhida;
  - o diálogo manual envia `amountCents: -2000` para "saída de 20,00";
  - um `itemId` que não é uuid mostra erro sem chamar a API;
  - 409 mostra "Esta conexão já está cadastrada";
  - a remoção pede confirmação.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): transações e conexões`

---

### Task 19: Telas Cartões e Recorrentes

**Files:**
- Create: `src/http/{cards,recurrences}.ts`, `src/pages/{cards,recurrences}.tsx` + testes, `src/components/recurrence-form.tsx`

**Interfaces:**
- **Cartões:**
  - Um card por cartão com tabs das faturas (fechada, aberta e futuras).
  - Cada fatura mostra vencimento, total, pago, restante, status e a lista de compras, com "n/total" nas parcelas.
  - Botão "Ajustar fechamento/vencimento" (dialog → `PATCH /cards/:id`).
  - Cartões em `cardsMissingCycle` aparecem primeiro, pedindo os dois dias.
- **Recorrentes:**
  - Seções "Sugeridos", "Confirmados" e "Descartados" (esta recolhida).
  - Sugerido tem os botões "Confirmar" (abre o formulário já preenchido, salva com `status: 'CONFIRMED'`) e "Descartar".
  - O formulário tem descrição, conta, direção, valor em reais, regra ("Todo dia X" ou "Nº dia útil"), dia e, só na regra "Todo dia X", a política para fim de semana ou feriado: "Antecipar" (padrão), "Adiar" ou "Manter".
  - Botão "Novo recorrente".

- [ ] **Step 1: Testes:**
  - a parcela mostra "2/10";
  - salvar o ciclo envia `{ closingDay, dueDay }`;
  - confirmar uma sugestão envia `status: 'CONFIRMED'`;
  - a política fica oculta na regra de dia útil;
  - `dayValue` 32 é recusado pelo formulário.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): cartões e recorrentes`

---

### Task 20: Telas de holerites

**Files:**
- Create: `src/http/payslips.ts`, `src/pages/{payslips,payslip-detail}.tsx` + testes

**Interfaces:**
- **Lista:**
  - Histórico por competência com tipo, status (badge "Não reconhecido", "Reconhecido" ou "Manual") e líquido.
  - Mini gráfico recharts do líquido mensal (só `MONTHLY`).
  - Botão "Enviar holerite": dialog com arquivo (`accept="application/pdf"`, recusa acima de 5 MB antes de enviar), competência (mês) e tipo.
  - 409 leva para o existente com o toast "Este arquivo já foi enviado".
- **Detalhe:**
  - Cabeçalho com competência, tipo, bruto e líquido.
  - Badge de conferência: "Líquido conferido com o depósito de {data}" ou "Depósito não encontrado".
  - Tabelas de proventos e descontos.
  - Botão "Baixar PDF": chama `GET /file` e abre a `url`.
  - Status `UNRECOGNIZED` mostra "Ainda não sabemos ler este layout — lance os valores abaixo", e o editor de linhas (linhas dinâmicas com react-hook-form `useFieldArray`) salva via `PUT /lines`.
  - Excluir com confirmação.

- [ ] **Step 1: Testes:**
  - arquivo de 6 MB não chama a API e mostra erro;
  - 409 navega para `/holerites/<payslipId>`;
  - o editor envia as linhas em centavos e o `netCents`;
  - o badge de conferência aparece com a data.
- [ ] **Step 2: Rodar.** Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(web): holerites`

---

### Task 21: CLAUDE.md, verificação ponta a ponta e fechamento

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Escrever o `CLAUDE.md`.** Só o que o código não mostra, uma linha por item:
  - comandos `pnpm` e as portas;
  - **Meu Pluggy: até 5 conexões, uso pessoal**, item ligado por `itemId` colado, sem força de atualização;
  - **a projeção vai até o próximo recebimento** (decisão do João);
  - recorrente em cartão não entra em "a pagar";
  - saque vira transferência para a Carteira;
  - o webhook só liga com `PLUGGY_WEBHOOK_SECRET`;
  - o leitor de holerite espera um PDF de exemplo e, quando chegar, cria `POST /payslips/:id/reprocess`;
  - melhoria futura: lançamento por WhatsApp ou Telegram.
- [ ] **Step 2: Verificar tudo.** Run: `pnpm lint && pnpm test && pnpm build && pnpm --filter @myfinances/api test:integration`. Expected: tudo PASS.
- [ ] **Step 3: Rodar o app de verdade.**
  - Com `pnpm dev` e as credenciais de uma aplicação Pluggy, cole o `itemId` do conector Sandbox (credenciais de teste da doc da Pluggy) em Conexões.
  - Confirme que contas e transações aparecem, que a tela Início mostra os três números e que dá para enviar e baixar um PDF qualquer em Holerites, com o R2 configurado.
- [ ] **Step 4: Commit.** `docs: CLAUDE.md do projeto`
