# Limites por categoria e alarmes — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entrega 1 do consultor. O João define limites mensais por categoria a partir de propostas tiradas do histórico. O app gera avisos quando "Quanto posso gastar" fica negativo ou quando uma categoria chega a 80% ou 100% do limite. Os avisos ficam guardados e aparecem num sininho no cabeçalho.

**Architecture:** As regras são funções puras em `apps/api/src/lib/finance/`: gasto por categoria e mês, proposta, revisão e decisão dos alarmes. O serviço `checkAlerts(userId, today)` carrega os dados, aplica essas regras e grava os avisos. Ele roda no fim do sync (o webhook da Pluggy passa pelo sync), depois do lançamento manual e depois do lançamento do WhatsApp, sempre dentro da fila do usuário (`runExclusive`). No web entram a página "Limites" e o sininho, que consulta os avisos a cada 60 s.

**Tech Stack:** Fastify + Zod + Prisma (Postgres), Vitest com Prisma mockado; Vite + React + TanStack Query + shadcn/ui, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-27-consultor-ia-design.md` (objetivos 1, 2 e o sininho do objetivo 3).

## Global Constraints

- Sem Gemini nem Web Push nesta entrega. A proposta de limite e os alarmes são regra pura, sem chamada à IA.
- O gasto do mês numa categoria segue exatamente a regra da Análise: `classify` em `lib/finance/annual-analysis.ts`. Estorno abate, transferência fica fora, e a marca na transação muda o grupo mas não a categoria.
- Categorias com limite: as de `isNecessityCategory` (essencial ou evitável, 14 no total). Ficam fora Dívidas e juros, Investimentos, receitas e Outros. Tirar Outros é *chamada minha*: é o balaio, e um limite nele seria ruído.
- Sem limite aceito, a categoria não gera aviso. O João pode recusar qualquer categoria.
- Alarme de categoria: uma vez por limiar (80, 100) por categoria por mês. Se o gasto já passar de 100% direto, sai só o de 100%, e o de 80% não sai depois.
- Alarme de "Quanto posso gastar": avisa ao ficar negativo. Só avisa de novo depois de voltar ao positivo e cair outra vez. Sem recebimento configurado (`noIncomeConfigured`), não avalia e mantém o estado.
- Os avisos ficam no servidor e não dependem do navegador, porque o app React Native vai consumir os mesmos.
- Dinheiro sempre em centavos inteiros. O texto em pt-BR usa `formatBrl` (Task 1).
- Toda tabela tem ordenação por coluna (`SortableHead`) (CLAUDE.md).
- Migration sempre com `--name`.

## Review Focus

1. **Usuário novo, sem meses fechados de histórico:** a proposta vem `null`, a categoria aparece como "sem proposta" e o João ainda pode definir um valor. Teste na Task 2.
2. **Estorno no mês depois do aviso de 80%:** o gasto cai abaixo de 80% e volta a subir, e o aviso não repete. Teste na Task 3.
3. **Lançamento do WhatsApp repetido pela Meta (`duplicate`):** não roda alarmes. Teste na Task 3.
4. **Categoria inválida na URL** (`Salário`, `Outros`, `Inexistente`): PUT e DELETE respondem 400 sem gravar. Teste na Task 4.
5. **Outro usuário:** nem limites nem avisos vazam, e marcar como lidos não toca nos avisos dos outros. Teste de isolamento na Task 4.

---

### Task 1: Modelo de dados e `formatBrl`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration via `pnpm --filter @myfinances/api db:migrate --name category_limits_and_notifications`
- Modify: `apps/api/src/lib/finance/money.ts`, `apps/api/src/lib/finance/money.test.ts`
- Modify: `apps/api/src/services/whatsapp/replies.ts`, que passa a usar `formatBrl` no lugar do `money` local

**Interfaces:**
- Produces:
  - `enum LimitStatus { ACTIVE DECLINED }`
  - `model CategoryLimit { id, userId, category String, status LimitStatus, limitCents Int? @map("limit_cents"), reviewedMonth String? @map("reviewed_month") /* YYYY-MM */, @@unique([userId, category]) @@map("category_limits") }`. `limitCents` é `null` só quando `DECLINED`.
  - `enum NotificationKind { SPENDABLE_NEGATIVE CATEGORY_WARNING CATEGORY_EXCEEDED }`
  - `model Notification { id, userId, kind NotificationKind, dedupeKey String? @map("dedupe_key"), title String, body String, createdAt DateTime @default(now()), readAt DateTime? @map("read_at"), @@unique([userId, dedupeKey]) @@index([userId, createdAt]) @@map("notifications") }`. `dedupeKey` é `null` nos avisos de saldo, porque o Postgres aceita vários `null` no unique.
  - `User.spendableNegative Boolean @default(false) @map("spendable_negative")`
  - Relações `categoryLimits CategoryLimit[]` e `notifications Notification[]` em `User`, com `onDelete: Cascade`.
  - `formatBrl(cents: number): string`, que formata o valor absoluto com espaço normal depois do "R$".

- [ ] **Step 1: Teste de `formatBrl`** em `money.test.ts`: `formatBrl(64000)` → `'R$ 640,00'`; `formatBrl(-123456)` → `'R$ 1.234,56'`.
- [ ] **Step 2:** Rodar `pnpm --filter @myfinances/api test -- money`. Esperado: FAIL, `formatBrl` não existe.
- [ ] **Step 3:** Implementar `formatBrl` movendo o `brl`/`money` de `replies.ts` para `money.ts` e trocar os usos em `replies.ts`.
- [ ] **Step 4:** Editar o schema e rodar a migration com o nome acima.
- [ ] **Step 5:** Rodar `pnpm --filter @myfinances/api test`. Esperado: PASS, incluindo `replies.test.ts` sem alteração.
- [ ] **Step 6:** Commit `feat(api): modelo de limites e avisos`.

### Task 2: Regras de limite (puras)

**Files:**
- Create: `apps/api/src/lib/finance/category-limits.ts`, `apps/api/src/lib/finance/category-limits.test.ts`

**Interfaces:**
- Consumes: `classify`, `AnalysisTx` (`annual-analysis.ts`); `CATEGORIES`, `isNecessityCategory`, `Necessity` (`categories.ts`).
- Produces:
  - `LIMIT_CATEGORIES: Category[]`, ou seja, `CATEGORIES.filter(isNecessityCategory)` na ordem de `CATEGORIES`.
  - `monthlyCategorySpend(transactions: AnalysisTx[], overrides: Map<string, Necessity>): Map<string /*YYYY-MM*/, Map<string /*categoria*/, number /*centavos gastos, positivo*/>>`. Soma `-amountCents` das transações com `classify(...).kind === 'spend'` e categoria em `LIMIT_CATEGORIES`. Crédito com categoria de gasto entra negativo, porque o estorno abate.
  - `closedMonths(today: IsoDate, count: number, firstDate: IsoDate | undefined): string[]`: os `count` meses antes do mês de `today`, do mais antigo para o mais novo, cortando os anteriores ao mês de `firstDate`. Sem `firstDate`, devolve `[]`.
  - `proposeLimit(history: number[]): number | null`: a mediana de `history`, arredondada para cima ao múltiplo de 1000 centavos (R$ 10). Devolve `null` se `history` estiver vazio ou a mediana for ≤ 0. Com quantidade par, a mediana é a média dos dois do meio.
  - `needsRevision(limitCents: number, lastThree: number[]): boolean`: só com exatamente 3 meses. É `true` se o gasto passou do limite (`>`) em pelo menos 2 deles ou ficou abaixo de 60% do limite nos 3.
  - Constantes `PROPOSAL_MONTHS = 6`, `REVISION_MONTHS = 3`.

*Chamada minha:* mediana dos últimos 6 meses fechados, arredondada para cima em R$ 10. A revisão olha os últimos 3 meses fechados e aparece no máximo uma vez por mês: o `reviewedMonth` a esconde até o mês seguinte.

- [ ] **Step 1: Testes que falham:**
  - `monthlyCategorySpend`: débito de -5000 em Mercado mais crédito de +1000 em Mercado no mesmo mês dá `4000`. Transferência, Investimentos, Dívidas e juros, Outros e categoria `null` não entram. Um débito de Delivery marcado `EMERGENCY` entra em Delivery.
  - `closedMonths('2026-10-28', 6, '2026-07-15')` → `['2026-07','2026-08','2026-09']`. Com `firstDate` `'2025-01-01'` dá 6 meses, de `'2026-04'` a `'2026-09'`. Com `undefined` dá `[]`.
  - `proposeLimit([30000, 41000, 50000])` → `41000`; `proposeLimit([30000, 41500])` → `36000` (mediana 35750, arredondada para cima); `proposeLimit([])` → `null`; `proposeLimit([0, 0, 500])` → `null`.
  - `needsRevision(50000, [60000, 55000, 40000])` → `true`; `needsRevision(50000, [20000, 25000, 29000])` → `true`; `needsRevision(50000, [20000, 31000, 29000])` → `false`; `needsRevision(50000, [60000, 60000])` → `false`.
- [ ] **Step 2:** Rodar `pnpm --filter @myfinances/api test -- category-limits`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar de novo. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(api): regras de proposta e revisão de limite`.

### Task 3: Alarmes e onde disparam

**Files:**
- Create: `apps/api/src/lib/finance/alerts.ts`, `apps/api/src/lib/finance/alerts.test.ts`
- Create: `apps/api/src/services/check-alerts.ts`, `apps/api/src/services/check-alerts.test.ts`
- Modify: `apps/api/src/services/load-analysis.ts`: `loadAnalysisInput(userId, today = todayIso())`
- Modify: `apps/api/src/services/sync-connection.ts`: `await checkAlerts(userId, today)` em `runSync`, logo depois de `detectAndStoreRecurrences`
- Modify: `apps/api/src/http/routes/transactions/create-manual-transaction.ts`: depois do `recomputeWalletBalance`, `await runExclusive(userId, () => checkAlerts(userId, todayIso()))`
- Modify: `apps/api/src/services/whatsapp/save-entry.ts`: `await checkAlerts(userId, todayIso())` dentro do callback do `runExclusive`, nos casos `created` e `renamed`. Não pode haver `runExclusive` aninhado, porque isso trava a fila.
- Modify: os testes `sync-connection.test.ts`, `save-entry.test.ts` e `transactions.test.ts` ganham `vi.mock('@/services/check-alerts', () => ({ checkAlerts: vi.fn() }))`

**Interfaces:**
- Consumes: `monthlyCategorySpend` (Task 2), `formatBrl` (Task 1), `loadFinanceSnapshot` + `computeProjection`, `loadAnalysisInput`.
- Produces:
  - `type NewNotification = { kind: 'SPENDABLE_NEGATIVE' | 'CATEGORY_WARNING' | 'CATEGORY_EXCEEDED'; dedupeKey: string | null; title: string; body: string }`
  - `decideAlerts(input: { today: IsoDate; projection: Pick<Projection, 'availableCents' | 'noIncomeConfigured' | 'nextIncome'>; wasNegative: boolean; limits: { category: string; limitCents: number }[]; spent: Map<string, number> /* do mês de today */; existingKeys: Set<string> }): { notifications: NewNotification[]; negative: boolean }`
  - `checkAlerts(userId: string, today: IsoDate): Promise<void>`. Ele não usa a fila sozinho, então quem chama já está nela ou precisa entrar.

Textos fixos, com `{mês}` sendo o nome do mês em minúsculas ("outubro"):
- `SPENDABLE_NEGATIVE`: título `Quanto posso gastar ficou negativo`, corpo `Faltam {formatBrl(-availableCents)} até {nextIncome.description} em {dd/mm}.`, `dedupeKey: null`.
- `CATEGORY_WARNING`: título `{categoria} chegou a 80% do limite`, corpo `{formatBrl(gasto)} de {formatBrl(limite)} em {mês}.`, chave `category:{categoria}:{YYYY-MM}:80`.
- `CATEGORY_EXCEEDED`: título `{categoria} atingiu o limite`, mesmo corpo, chave `category:{categoria}:{YYYY-MM}:100`.

Regra de categoria: com `gasto ≥ limite`, gera 100 se a chave 100 não existe. Com `gasto ≥ 0,8 × limite` (em inteiros: `5 * gasto >= 4 * limite`), gera 80 se nem a chave 80 nem a 100 existem. O `checkAlerts` grava com `prisma.notification.createMany({ skipDuplicates: true })` e só atualiza `user.spendableNegative` se ele mudou.

- [ ] **Step 1: Testes de `decideAlerts`:**
  - Saldo negativo, sem aviso anterior: gera 1 `SPENDABLE_NEGATIVE` cujo corpo contém `'R$ 120,00'` e `'05/11'`, e `negative: true`.
  - Negativo com `wasNegative: true`: não gera nada e mantém `negative: true`.
  - Positivo depois de negativo: não gera nada e devolve `negative: false`.
  - `noIncomeConfigured: true` com saldo negativo: não gera nada e mantém `negative` igual a `wasNegative`.
  - Limite 80000 e gasto 64000: gera `CATEGORY_WARNING` com a chave `category:Mercado:2026-10:80`.
  - Gasto 90000 com a chave 80 já existente: nada novo. Gasto 80000: gera só `CATEGORY_EXCEEDED`.
  - Gasto de 0 para 100000 de uma vez: gera só `CATEGORY_EXCEEDED`, e depois, com a chave 100 existente e gasto 70000 (estorno), nada.
  - Categoria com gasto mas sem limite na lista: nada.
- [ ] **Step 2:** Rodar `pnpm --filter @myfinances/api test -- alerts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar `decideAlerts`.
- [ ] **Step 4: Testes de `checkAlerts`** em `check-alerts.test.ts`, com o Prisma mockado e `loadFinanceSnapshot`/`loadAnalysisInput` mockados:
  - Só lê limites `ACTIVE` do usuário (`where: { userId, status: 'ACTIVE' }`).
  - Busca as chaves existentes do mês (`dedupeKey: { startsWith: 'category:' }`, `userId`).
  - Chama `createMany` com `skipDuplicates: true` só quando há aviso novo.
  - Chama `user.update({ data: { spendableNegative: true } })` só na troca de estado.
- [ ] **Step 5: Testes dos disparos:**
  - `sync-connection.test.ts`: depois de um sync bem-sucedido, `checkAlerts` foi chamado com `(userId, today)`.
  - `save-entry.test.ts`: chamado em `created` e `renamed`, e não chamado em `duplicate`.
  - `transactions.test.ts`: `POST /transactions` chama `checkAlerts`.
- [ ] **Step 6:** Implementar `checkAlerts` e os disparos.
- [ ] **Step 7:** Rodar `pnpm --filter @myfinances/api test`. Esperado: PASS.
- [ ] **Step 8:** Commit `feat(api): alarmes de saldo e de limite por categoria`.

### Task 4: Rotas de limites e de avisos

**Files:**
- Create: `apps/api/src/http/routes/limits/get-category-limits.ts`, `update-category-limit.ts`, `decline-category-limit.ts`, `limits.test.ts`
- Create: `apps/api/src/http/routes/notifications/get-notifications.ts`, `read-notifications.ts`, `notifications.test.ts`
- Modify: `apps/api/src/http/server.ts` (registrar as 5 rotas)
- Modify: `apps/api/src/http/routes/isolation.integration.test.ts`

**Interfaces:**
- Consumes: `LIMIT_CATEGORIES`, `monthlyCategorySpend`, `closedMonths`, `proposeLimit`, `needsRevision`, `PROPOSAL_MONTHS`, `REVISION_MONTHS` (Task 2); `loadAnalysisInput`.
- Produces (o web da Task 5 depende disto):
  - `GET /category-limits` → `200 { month: 'YYYY-MM', limits: { category: string; status: 'NEW' | 'ACTIVE' | 'DECLINED'; limitCents: number | null; proposedCents: number | null; spentCents: number }[] }`. Traz uma linha por `LIMIT_CATEGORIES`, nessa ordem. `NEW` é quando não há linha no banco, e então `proposedCents = proposeLimit(últimos 6 fechados)`. Em `ACTIVE`, `proposedCents` é a revisão (`proposeLimit` de 6 meses) só se `reviewedMonth !== month`, `needsRevision(limit, últimos 3)` e a proposta for diferente do limite; senão é `null`. Em `DECLINED`, `proposedCents` é `null`. `spentCents` é o gasto do mês atual, que pode ser 0.
  - `PUT /category-limits/:category` body `{ limitCents: int, 1..100_000_000 }` → `204`. Faz upsert `ACTIVE` com `reviewedMonth` = mês atual, e é isso que faz "Manter" esconder a revisão.
  - `DELETE /category-limits/:category` → `204`. Faz upsert `DECLINED` com `limitCents: null`.
  - Categoria fora de `LIMIT_CATEGORIES` no PUT ou DELETE → `400` `'Essa categoria não aceita limite.'`.
  - `GET /notifications` → `200 { unreadCount: number; notifications: { id; kind; title; body; createdAt: string /*ISO*/; read: boolean }[] }`, com os 30 mais recentes primeiro.
  - `POST /notifications/read` → `204`. Faz `updateMany({ where: { userId, readAt: null }, data: { readAt: now } })`.
  - Tags do Swagger: `Limits`, `Notifications`.

- [ ] **Step 1: Testes de rota que falham** (padrão de `categories.test.ts`):
  - O GET lista as 14 categorias. Uma sem linha e com histórico vem `NEW` com proposta. `ACTIVE` com `reviewedMonth` do mês atual vem com `proposedCents: null`. `DECLINED` vem com `proposedCents: null` e `limitCents: null`.
  - O PUT grava com `upsert` e `reviewedMonth` igual ao mês atual. Com `limitCents: 0`, responde 400.
  - PUT e DELETE com `Salário`, `Outros` e `Inexistente` respondem 400 sem chamar o `upsert`.
  - O GET de avisos traz `read: false` quando `readAt` é `null` e `unreadCount` vem do `count` com `readAt: null`. O POST de lidos filtra por `userId`.
- [ ] **Step 2:** Rodar `pnpm --filter @myfinances/api test -- limits notifications`. Esperado: FAIL.
- [ ] **Step 3:** Implementar as rotas e registrar no `server.ts`.
- [ ] **Step 4:** Rodar de novo. Esperado: PASS.
- [ ] **Step 5: Isolamento** em `isolation.integration.test.ts`: o usuário B não vê o limite nem o aviso do A, e o `POST /notifications/read` de B deixa os avisos de A não lidos. Rodar `pnpm --filter @myfinances/api test:integration`. Esperado: PASS.
- [ ] **Step 6:** Commit `feat(api): rotas de limites e avisos`.

### Task 5: Página "Limites" no web

**Files:**
- Create: `apps/web/src/http/limits.ts`, `apps/web/src/pages/limits.tsx`, `apps/web/src/pages/limits.test.tsx`
- Modify: `apps/web/src/router.tsx` (`/limites`), `apps/web/src/components/app-sidebar.tsx` (item "Limites", ícone `GaugeIcon` do lucide, depois de "Análise")

**Interfaces:**
- Consumes: as rotas da Task 4.
- Produces: `getCategoryLimits(): Promise<CategoryLimits>`, `setCategoryLimit(category: string, limitCents: number): Promise<void>`, `declineCategoryLimit(category: string): Promise<void>`, com os tipos espelhando o JSON da Task 4.

Tabela com `SortableHead` em todas as colunas: Categoria, Gasto no mês, Limite, Uso (gasto/limite em %, com barra; vazio sem limite) e Proposta. Ações por linha:
- `NEW` com proposta: **Aceitar** (PUT com `proposedCents`), **Ajustar** e **Recusar** (DELETE).
- `NEW` sem proposta: o texto "Sem histórico" e **Definir**.
- `ACTIVE`: **Ajustar** e **Remover** (DELETE). Com `proposedCents` aparece a revisão "Sugestão: R$ X", com **Usar** (PUT com a proposta) e **Manter** (PUT com o limite atual).
- `DECLINED`: o texto "Recusado" e **Definir**.

"Ajustar" e "Definir" abrem um `Dialog` com um campo em reais lido por `parseReaisToCents`. O botão Salvar fica desabilitado quando o valor é `null`. Toda mutação invalida a query `['category-limits']`.

- [ ] **Step 1: Testes que falham** em `limits.test.tsx` (padrão de `analysis.test.tsx`, com `@/http/limits` mockado):
  - "Aceitar" numa linha `NEW` chama `setCategoryLimit('Mercado', 80000)`.
  - "Recusar" chama `declineCategoryLimit('Delivery')`.
  - "Manter" numa revisão chama `setCategoryLimit` com o limite atual.
  - O diálogo com "12,50" salva `1250`, e com "abc" o Salvar fica desabilitado.
  - Clicar no cabeçalho "Gasto no mês" reordena as linhas.
- [ ] **Step 2:** Rodar `pnpm --filter web test -- limits`. Esperado: FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar de novo. Esperado: PASS.
- [ ] **Step 5:** Commit `feat(web): página de limites por categoria`.

### Task 6: Sininho de avisos

**Files:**
- Create: `apps/web/src/http/notifications.ts`, `apps/web/src/components/notifications-bell.tsx`, `apps/web/src/components/notifications-bell.test.tsx`
- Modify: `apps/web/src/components/app-layout.tsx` (sininho à esquerda do `ThemeToggle`)
- Modify: `apps/web/src/components/manual-transaction-dialog.tsx` e o "Sincronizar" em `apps/web/src/pages/connections.tsx`, que no sucesso invalidam `['notifications']`

**Interfaces:**
- Consumes: `GET /notifications`, `POST /notifications/read`.
- Produces: `getNotifications(): Promise<NotificationList>`, `markNotificationsRead(): Promise<void>`.

Botão com `BellIcon` e `aria-label="Avisos"`. O badge mostra `unreadCount`, ou "9+" acima de 9, e some com 0. A query `['notifications']` usa `refetchInterval: 60_000`. O `DropdownMenu` lista título, corpo e data (`formatDateTimeToDate`). Os não lidos ficam em destaque. Sem avisos, aparece "Nenhum aviso.". Abrir o menu com `unreadCount > 0` chama `markNotificationsRead` e, no sucesso, invalida a query.

- [ ] **Step 1: Testes que falham:**
  - Com `unreadCount: 3`, o badge mostra "3"; com `12`, "9+"; com 0, não há badge.
  - Abrir o menu mostra os títulos e chama `markNotificationsRead` uma vez. Com 0 não lidos, não chama.
  - Lista vazia mostra "Nenhum aviso.".
- [ ] **Step 2:** Rodar `pnpm --filter web test -- notifications-bell`. Esperado: FAIL.
- [ ] **Step 3:** Implementar e encaixar no layout.
- [ ] **Step 4:** Rodar `pnpm test` e `pnpm lint` na raiz. Esperado: PASS.
- [ ] **Step 5:** Acrescentar ao CLAUDE.md, em "Decisões de produto", uma linha: `Limites e alarmes são regra, sem IA: proposta pela mediana de 6 meses, alarme de categoria uma vez por limiar no mês, de "Quanto posso gastar" só de novo depois de voltar ao positivo; Outros fica sem limite.`
- [ ] **Step 6:** Commit `feat(web): sininho de avisos`.
