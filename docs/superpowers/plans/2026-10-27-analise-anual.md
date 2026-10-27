# Análise do ano — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Categorias mais finas, marca essencial/evitável (padrão por categoria + ajuste na transação) e uma tela "Análise" com os últimos 12 meses.

**Architecture:** A lista de categorias e o grupo padrão de cada uma vivem em `apps/api/src/lib/finance/categories.ts`. A agregação é uma função pura (`annualAnalysis`) chamada por uma rota nova `GET /analysis`. A marca na mão é uma coluna da transação, e o padrão trocado pelo usuário fica numa tabela por categoria. Os dados que já existem são reclassificados uma vez por um script.

**Tech Stack:** Fastify + Zod + Prisma (Postgres), Vitest com `makePrismaMock`; Vite + React 19, TanStack Query, ky, recharts 2.15, shadcn/ui, Biome.

**Spec:** `docs/superpowers/specs/2026-10-27-analise-anual-design.md`

## Global Constraints

- Lista de categorias, nesta ordem: `Mercado`, `Delivery`, `Restaurante`, `Carro`, `Combustível`, `Uber e táxi`, `Transporte público`, `Moradia`, `Farmácia`, `Saúde`, `Educação`, `Lazer`, `Assinaturas`, `Compras`, `Serviços`, `Impostos e taxas`, `Dívidas e juros`, `Investimentos`, `Salário`, `Outras receitas`, `Outros`.
- Padrão essencial: Mercado, Carro, Combustível, Transporte público, Moradia, Farmácia, Saúde, Educação, Impostos e taxas, Serviços. Padrão evitável: Delivery, Restaurante, Uber e táxi, Lazer, Compras, Assinaturas. Dívidas e juros = grupo "dívida". Investimentos = fora dos gastos. Outros e sem categoria = "sem classificação". Salário e Outras receitas = entradas.
- Só categorias com padrão essencial/evitável aceitam troca de padrão pelo usuário.
- Período: os 12 meses até o mês de hoje (`todayIso()`), datas futuras de fora.
- Transferências (`isTransfer`) nunca contam.
- Toda tabela usa `SortableHead`. As tabelas desta tela não são paginadas no servidor, então ordenam no cliente.
- Textos da UI em português. Tema claro e escuro pelos tokens de `index.css` (`--income`, `--expense` etc.).
- Testes nunca chamam o Gemini de verdade.
- A API está fora do formatador do Biome. Não rodar `pnpm format` nela.

## Review Focus

1. **Histórico menor que 12 meses** (hoje começa em 2025-10-23): os meses sem dado aparecem zerados e a média por categoria divide só pelos meses desde a primeira transação, para não puxar a média para baixo. Testado na Task 4.
2. **Crédito com categoria de gasto maior que os débitos da categoria no mês**: o total líquido fica negativo e a tela mostra o valor negativo sem quebrar o gráfico nem a ordenação. Testado nas Tasks 4 e 6.
3. **Parcelas futuras no cartão** (data > hoje): ficam de fora dos totais e dos maiores gastos. Testado na Task 4.
4. **Marca na mão numa transação de outro usuário ou num crédito**: 404 para outro usuário, 400 para crédito ou transferência. Testado na Task 3.
5. **Reclassificação rodada duas vezes**: o script é idempotente e não mexe em categoria nova travada. Testado na Task 2.

---

### Task 1: Lista nova de categorias, grupos e mapeamento da Pluggy

**Files:**
- Modify: `apps/api/src/lib/finance/categories.ts`
- Modify: `apps/api/src/lib/finance/categories.test.ts`
- Modify (só os nomes antigos nos fixtures): `apps/api/src/lib/gemini/interpret-entry.test.ts`, `apps/api/src/services/sync-connection.test.ts`, `apps/api/src/services/whatsapp/replies.test.ts`, `apps/api/src/http/routes/transactions/transactions.test.ts`, `apps/api/src/services/remove-transactions.test.ts`, `apps/api/src/services/whatsapp/save-entry.test.ts`, `apps/web/src/pages/transactions.test.tsx`

**Interfaces:**
- Produces:
  - `CATEGORIES` (lista de Global Constraints, `as const`) e `type Category`
  - `type Necessity = 'ESSENTIAL' | 'AVOIDABLE'`
  - `type CategoryGroup = 'income' | 'essential' | 'avoidable' | 'debt' | 'investment' | 'unclassified'`
  - `DEFAULT_GROUP: Record<Category, CategoryGroup>`
  - `isNecessityCategory(c: string): boolean`: true quando o padrão é essential ou avoidable
  - `mapPluggyCategory(raw)`: mesma assinatura de hoje, com a tabela nova

- [ ] **Step 1: Write the failing tests** em `categories.test.ts`:

```ts
it('mapeia as categorias novas da Pluggy', () => {
  expect(mapPluggyCategory('Food delivery')).toBe('Delivery')
  expect(mapPluggyCategory('Eating out')).toBe('Restaurante')
  expect(mapPluggyCategory('Gas stations')).toBe('Combustível')
  expect(mapPluggyCategory('Vehicle maintenance')).toBe('Carro')
  expect(mapPluggyCategory('Automotive')).toBe('Carro')
  expect(mapPluggyCategory('Ride-hailing')).toBe('Uber e táxi')
  expect(mapPluggyCategory('Tolls and in vehicle payment')).toBe('Transporte público')
  expect(mapPluggyCategory('Electricity')).toBe('Moradia')
  expect(mapPluggyCategory('Real estate financing')).toBe('Moradia')
  expect(mapPluggyCategory('Pharmacy')).toBe('Farmácia')
  expect(mapPluggyCategory('Hospital clinics and labs')).toBe('Saúde')
  expect(mapPluggyCategory('Loans and financing')).toBe('Dívidas e juros')
  expect(mapPluggyCategory('Late payment and overdraft costs')).toBe('Dívidas e juros')
  expect(mapPluggyCategory('Investments')).toBe('Investimentos')
  expect(mapPluggyCategory('Transfer - PIX')).toBeNull()
})

it('todo nome da lista tem grupo padrão', () => {
  for (const c of CATEGORIES) expect(DEFAULT_GROUP[c]).toBeDefined()
  expect(DEFAULT_GROUP.Delivery).toBe('avoidable')
  expect(DEFAULT_GROUP.Mercado).toBe('essential')
  expect(DEFAULT_GROUP['Dívidas e juros']).toBe('debt')
  expect(DEFAULT_GROUP.Outros).toBe('unclassified')
  expect(isNecessityCategory('Lazer')).toBe(true)
  expect(isNecessityCategory('Salário')).toBe(false)
})
```

Atualize o teste antigo (`'eating out'` → `'Restaurante'`).

- [ ] **Step 2: Run** `pnpm --filter @myfinances/api exec vitest run src/lib/finance/categories.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** em `categories.ts`. A tabela `PLUGGY_CATEGORIES`, em minúsculas, cobre pelo menos:

| Pluggy | Nossa |
|---|---|
| groceries, supermarkets | Mercado |
| food delivery | Delivery |
| eating out, restaurants, food and drinks | Restaurante |
| vehicle maintenance, automotive, vehicle insurance, vehicle purchase | Carro |
| gas stations | Combustível |
| ride-hailing, taxi, taxi and ride-hailing | Uber e táxi |
| transportation, public transportation, tolls and in vehicle payment, parking | Transporte público |
| housing, rent, real estate financing, electricity, water, telecommunications, internet, mobile, utilities, houseware | Moradia |
| pharmacy | Farmácia |
| health, healthcare, hospital clinics and labs, dentist, gyms and fitness centers | Saúde |
| education | Educação |
| leisure, entertainment, travel, lodging, tickets | Lazer |
| digital services, streaming, subscriptions | Assinaturas |
| shopping, clothing, electronics, kids and toys, online shopping | Compras |
| services | Serviços |
| taxes, tax on financial operations, bank fees | Impostos e taxas |
| loans and financing, interests charged, late payment and overdraft costs, credit card fees | Dívidas e juros |
| investments | Investimentos |
| salary | Salário |
| proceeds interests and dividends, income | Outras receitas |

`insurance`, `donations` e as `transfer*` ficam sem mapa (null).

- [ ] **Step 4: Troque** "Alimentação" e "Transporte" nos fixtures dos testes listados em Files por "Restaurante" e "Uber e táxi". Run `pnpm --filter @myfinances/api test` e `pnpm --filter web test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): categorias mais finas e grupo padrão de cada uma`

---

### Task 2: Reclassificar os dados existentes

**Files:**
- Create: `apps/api/src/lib/finance/remap-legacy-category.ts` + `.test.ts`
- Create: `apps/api/src/scripts/remap-categories.ts`
- Modify: `apps/api/package.json` (script `"categories:remap": "pnpm env:load tsx src/scripts/remap-categories.ts"`)

**Interfaces:**
- Consumes: `mapPluggyCategory`, `CATEGORIES` (Task 1)
- Produces: `remapLegacyCategory(category: string | null, pluggyCategory: string | null): Category | null`

- [ ] **Step 1: Write the failing test**

```ts
it('nome antigo usa a Pluggy quando cai no mesmo grupo', () => {
  expect(remapLegacyCategory('Alimentação', 'Food delivery')).toBe('Delivery')
  expect(remapLegacyCategory('Alimentação', 'Groceries')).toBe('Mercado')
  expect(remapLegacyCategory('Transporte', 'Gas stations')).toBe('Combustível')
  expect(remapLegacyCategory('Transporte', 'Vehicle maintenance')).toBe('Carro')
})
it('nome antigo sem pista da Pluggy cai no padrão', () => {
  expect(remapLegacyCategory('Alimentação', null)).toBe('Restaurante')
  expect(remapLegacyCategory('Transporte', 'Shopping')).toBe('Uber e táxi')
})
it('nome da lista nova fica como está (idempotente)', () => {
  expect(remapLegacyCategory('Delivery', 'Eating out')).toBe('Delivery')
  expect(remapLegacyCategory('Saúde', null)).toBe('Saúde')
})
it('nome desconhecido vira null', () => {
  expect(remapLegacyCategory('Xyz', null)).toBeNull()
})
```

Grupos: Alimentação → {Mercado, Delivery, Restaurante}, padrão Restaurante. Transporte → {Carro, Combustível, Uber e táxi, Transporte público}, padrão Uber e táxi.

- [ ] **Step 2: Run** o teste. Expected: FAIL. **Step 3:** implemente. **Step 4:** PASS.

- [ ] **Step 5: Script `remap-categories.ts`** (segue o formato de `link-whatsapp.ts`). Ele faz, para cada usuário:
  1. Regras (`CategoryRule`): `remapLegacyCategory(rule.category, pluggyCategory da transação mais recente com a mesma descriptionKey)`. Se der null, apaga a regra.
  2. Transações travadas: `remapLegacyCategory(category, pluggyCategory)`.
  3. Transações não travadas: a regra (já remapeada) pela `descriptionKey` não vazia. Sem regra, `mapPluggyCategory(pluggyCategory)`. Lançamento manual sem Pluggy usa `remapLegacyCategory(category, null)`.
  4. Só grava o que mudou e imprime quantas linhas mudaram por passo. Rodar de novo imprime 0.

- [ ] **Step 6: Backup e execução no banco local.** **Peça confirmação ao João antes**, porque mexe nos dados reais:

```bash
pg_dump "postgresql://…@127.0.0.1:5435/myfinances" -Fc -f ~/myfinances-pre-remap.dump
pnpm --filter @myfinances/api categories:remap
pnpm --filter @myfinances/api categories:remap   # expected: 0 mudanças
```

- [ ] **Step 7: Commit** `feat(api): script que reclassifica as categorias antigas`

---

### Task 3: Marca essencial/evitável — schema e rotas

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create (gerada): migration `--name necessity`
- Create: `apps/api/src/http/routes/transactions/update-transaction-necessity.ts`
- Create: `apps/api/src/http/routes/categories/get-category-necessities.ts`, `update-category-necessity.ts`, `categories.test.ts`
- Modify: `apps/api/src/http/routes/transactions/transactions.test.ts`, `apps/api/src/http/server.ts`, `apps/api/src/test/helpers.ts` (`categoryNecessity: model()`)

**Interfaces:**
- Produces:
  - Prisma `enum Necessity { ESSENTIAL AVOIDABLE }`; `Transaction.necessity Necessity?` (`@map("necessity")`); `model CategoryNecessity { id, userId, category String, necessity Necessity, @@unique([userId, category]), @@map("category_necessities") }` com relação em `User`.
  - `PATCH /transactions/:id/necessity` body `{ necessity: 'ESSENTIAL' | 'AVOIDABLE' | null }` → 204. `null` tira a marca.
  - `GET /category-necessities` → `{ categories: { category: string; necessity: 'ESSENTIAL'|'AVOIDABLE'; isDefault: boolean }[] }`, só as categorias com `isNecessityCategory`, na ordem de `CATEGORIES`.
  - `PUT /category-necessities/:category` body `{ necessity }` → 204. Grava a troca, ou apaga a linha quando o valor é igual ao padrão.
  - `async function loadNecessityOverrides(userId): Promise<Map<string, Necessity>>` em `get-category-necessities.ts`, exportada para a Task 5.

- [ ] **Step 1: Schema + migration:** `pnpm --filter @myfinances/api db:migrate --name necessity`.

- [ ] **Step 2: Write the failing tests** (padrão de `transactions.test.ts` com `prismaMock`):
  - `PATCH necessity grava a marca num débito do usuário` → 204 e `transaction.update` com `{ necessity: 'AVOIDABLE' }`
  - `PATCH necessity com null tira a marca`
  - `PATCH necessity de transação de outro usuário` → 404
  - `PATCH necessity em crédito (amountCents > 0) ou transferência` → 400
  - `GET category-necessities junta padrão e troca` (Delivery trocado para ESSENTIAL → `isDefault: false`; Mercado → `ESSENTIAL, isDefault: true`; Salário fora da lista)
  - `PUT category-necessities recusa categoria sem padrão (Salário, Outros, nome inexistente)` → 400
  - `PUT igual ao padrão apaga a troca` → `categoryNecessity.deleteMany`

- [ ] **Step 3: Run** os testes. FAIL. **Step 4:** implemente e registre as rotas em `server.ts`. **Step 5:** PASS.

- [ ] **Step 6: Commit** `feat(api): marca essencial/evitável por categoria e por transação`

---

### Task 4: Agregação pura do ano

**Files:**
- Create: `apps/api/src/lib/finance/annual-analysis.ts` + `.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_GROUP`, `CategoryGroup`, `Necessity` (Task 1)
- Produces:

```ts
export type AnalysisTx = {
  id: string; date: IsoDate; description: string; amountCents: number
  category: string | null; necessity: Necessity | null; isTransfer: boolean
  accountType: AccountType; accountName: string
}
export type SpendGroup = 'essential' | 'avoidable' | 'debt' | 'unclassified'
export type AnalysisMonth = {
  month: string // YYYY-MM
  incomeCents: number; essentialCents: number; avoidableCents: number
  debtCents: number; unclassifiedCents: number; investedCents: number
}
export type CategoryTotal = {
  category: string | null; group: SpendGroup
  totalCents: number; averageCents: number; count: number
}
export type AnalysisExpense = Omit<AnalysisTx, 'isTransfer' | 'accountType'> & { group: SpendGroup }
export type Analysis = {
  from: IsoDate; to: IsoDate; month: string | null
  months: AnalysisMonth[]            // sempre os 12, mais antigo primeiro
  totals: Omit<AnalysisMonth, 'month'> // do período (ou do mês filtrado)
  categories: CategoryTotal[]        // gastos, maior total primeiro
  topExpenses: AnalysisExpense[]     // 10 maiores débitos
  topAvoidable: AnalysisExpense[]    // 10 maiores débitos evitáveis
  uncategorized: { count: number; totalCents: number } // débitos sem categoria
}
export function classify(tx: AnalysisTx, overrides: Map<string, Necessity>):
  { kind: 'income' | 'investment' | 'ignored' } | { kind: 'spend'; group: SpendGroup }
export function annualAnalysis(input: {
  today: IsoDate; month?: string; transactions: AnalysisTx[]; overrides: Map<string, Necessity>
}): Analysis
```

`classify`, nesta ordem:
1. `isTransfer` → ignored.
2. Categoria `Investimentos` → investment (débito soma em `investedCents`; crédito é ignored).
3. Crédito (`amountCents > 0`): com categoria de gasto (grupo essential/avoidable/debt) → spend nesse grupo, abatendo. Em conta não cartão, sem categoria, "Outros", "Salário" ou "Outras receitas" → income. No cartão, sem categoria de gasto → ignored.
4. Débito: `necessity` da transação, se existir → essential/avoidable. Senão, sem categoria ou "Outros" → unclassified. "Dívidas e juros" → debt. Categoria de padrão essencial/evitável → `overrides.get(category)` ?? padrão.

Os grupos somam `-amountCents`, então crédito abate. `averageCents` = total da categoria nos 12 meses ÷ número de meses do período a partir do mês da primeira transação do usuário (mínimo 1). `month` filtra `totals`, `categories`, `topExpenses`, `topAvoidable` e `uncategorized`; `months` fica sempre com os 12.

- [ ] **Step 1: Write the failing tests**, um `it` por regra:
  - `transferência não conta em lugar nenhum`
  - `salário em conta é entrada; crédito sem categoria no cartão é ignorado`
  - `estorno no cartão com categoria Compras abate Compras` (débito -10000 e crédito +3000 → Compras `totalCents: 7000`)
  - `devolução maior que o gasto deixa a categoria negativa` (-2000 e +5000 em Restaurante → `-3000`, e o mês fica com `avoidableCents: -3000`)
  - `marca na mão vence a categoria e tira de Outros/sem categoria`
  - `troca de padrão do usuário vale para a categoria` (overrides Delivery → ESSENTIAL)
  - `Dívidas e juros vai para dívida e Investimentos fica fora dos gastos`
  - `data futura fica de fora` (today 2026-10-27, parcela em 2026-11-10)
  - `meses sem dado saem zerados e a média divide pelos meses desde a primeira transação` (primeira em 2025-10-23, today 2026-10-27: 12 meses de 2025-11 a 2026-10, a primeira transação é anterior à janela e o divisor é 12; outro caso com primeira transação em 2026-08 → divisor 3)
  - `filtro de mês recorta totais, categorias e maiores gastos mas mantém os 12 meses`
  - `topExpenses tem no máximo 10, maior débito primeiro, e topAvoidable só evitáveis`
  - `uncategorized conta só débitos sem categoria`

- [ ] **Step 2:** FAIL. **Step 3:** implemente. **Step 4:** PASS.

- [ ] **Step 5: Commit** `feat(api): agregação da análise do ano`

---

### Task 5: Rotas `GET /analysis` e `GET /analysis/transactions`

**Files:**
- Create: `apps/api/src/http/routes/analysis/get-analysis.ts`, `get-analysis-transactions.ts`, `analysis.test.ts`
- Modify: `apps/api/src/http/server.ts`

**Interfaces:**
- Consumes: `annualAnalysis`, `classify`, `AnalysisTx` (Task 4); `loadNecessityOverrides` (Task 3); `todayIso`
- Produces:
  - `GET /analysis?month=YYYY-MM` → `Analysis` (Zod espelhando o tipo). `month` fora da janela de 12 meses → 400.
  - `GET /analysis/transactions?category=<nome>|none&month=YYYY-MM` → `{ transactions: (AnalysisExpense & { amountCents, categoryLocked: boolean })[] }`. São as transações de gasto (`kind: 'spend'`) da categoria no período, cartão incluído, mais recente primeiro, sem paginação. `none` = sem categoria.
  - O carregamento busca as transações do usuário de `from` (dia 1 do mês de hoje − 11) até hoje, com `account: { select: { type, name } }`, mais a data da primeira transação (`findFirst orderBy date asc`).

- [ ] **Step 1: Write the failing tests** (padrão de `dashboard.test.ts`, mockando `todayIso` = `'2026-10-27'`):
  - `devolve 12 meses e os totais do usuário`
  - `month inválido ou fora da janela → 400`
  - `transactions de uma categoria inclui compra no cartão e exclui transferência`
  - `transactions com category=none lista os débitos sem categoria`
  - `só enxerga transações do próprio usuário` (o `where` tem `userId`)

- [ ] **Step 2:** FAIL. **Step 3:** implemente e registre. **Step 4:** PASS.

- [ ] **Step 5: Commit** `feat(api): rotas da análise do ano`

---

### Task 6: Tela "Análise"

**Files:**
- Create: `apps/web/src/http/analysis.ts`
- Create: `apps/web/src/pages/analysis.tsx` + `analysis.test.tsx`
- Create: `apps/web/src/components/analysis-chart.tsx`
- Modify: `apps/web/src/router.tsx` (`/analise`), `apps/web/src/components/app-sidebar.tsx` (item "Análise", ícone `ChartPieIcon`, depois de "Transações")

**Interfaces:**
- Consumes: as rotas da Task 5
- Produces: `getAnalysis(month?: string): Promise<Analysis>`, `listAnalysisTransactions(p: { category: string | 'none'; month?: string })`, `setTransactionNecessity(id, necessity | null)`, `listCategoryNecessities()`, `setCategoryNecessity(category, necessity)` em `http/analysis.ts`, com os tipos espelhando a API.

A tela, de cima para baixo:
1. Cabeçalho "Análise" com o período ("nov/2025 – out/2026" ou o mês filtrado, mais um botão "Ver 12 meses").
2. Indicadores: Entrou, Saiu, Sobrou/Faltou (Saiu = essencial + evitável + dívida + sem classificação), Essencial, Evitável, Dívida. Essencial, Evitável e Dívida mostram o % do Saiu.
3. Aviso de **sem categoria** quando `uncategorized.count > 0`: "N transações sem categoria somando R$ X". Clicar abre o detalhe da categoria `none` (Task 7).
4. Gráfico (`analysis-chart.tsx`, recharts `BarChart`): entradas numa barra e saídas empilhadas (essencial, evitável, dívida, sem classificação) por mês. Clicar numa barra põe `?mes=YYYY-MM` na URL.
5. Tabela "Para onde foi": categoria, grupo, total, % do Saiu, média mensal, quantidade. Ordena no cliente, padrão total desc. Clicar na linha abre o detalhe.
6. Tabela "Maiores gastos" (`topExpenses`) e "Dava pra evitar" (`topAvoidable`), lado a lado em tela larga e empilhadas no celular.

- [ ] **Step 1: Write the failing tests** (padrão de `home.test.tsx`):
  - `mostra entrou, saiu e o percentual evitável`
  - `mostra o aviso de sem categoria só quando há`
  - `clicar num mês filtra pela URL e mostra "Ver 12 meses"`
  - `ordena a tabela de categorias ao clicar no cabeçalho`
  - `valor negativo de categoria aparece com sinal`

- [ ] **Step 2:** FAIL. **Step 3:** implemente. **Step 4:** PASS.

- [ ] **Step 5: Commit** `feat(web): tela de análise do ano`

---

### Task 7: Detalhe da categoria e padrões essencial/evitável

**Files:**
- Create: `apps/web/src/components/category-transactions-sheet.tsx`
- Create: `apps/web/src/components/necessity-settings-dialog.tsx`
- Modify: `apps/web/src/pages/analysis.tsx` e `analysis.test.tsx`

**Interfaces:**
- Consumes: `http/analysis.ts` (Task 6), `setTransactionCategory` e `listCategories` (de `http/transactions.ts`)

- **Detalhe (`Sheet`):** lista as transações (data, descrição, conta, valor) com dois selects por linha: categoria (troca + aprende regra, rota que já existe) e marca ("Padrão da categoria", "Essencial", "Evitável"). Ordenável por coluna. Depois de cada mudança, invalida as queries `['analysis']` e `['analysis-transactions']`.
- **Padrões:** botão "Essencial ou evitável" no cabeçalho abre um `Dialog` com a lista de `GET /category-necessities`, com um select por categoria e a indicação "(padrão)" quando `isDefault`.

- [ ] **Step 1: Write the failing tests:**
  - `clicar numa categoria abre o detalhe com as transações dela, inclusive de cartão`
  - `trocar a marca de uma transação chama setTransactionNecessity e atualiza a análise`
  - `trocar a categoria no detalhe chama setTransactionCategory`
  - `diálogo de padrões salva a troca de uma categoria`

- [ ] **Step 2:** FAIL. **Step 3:** implemente. **Step 4:** PASS.

- [ ] **Step 5: Commit** `feat(web): detalhe da categoria e padrões essencial/evitável`

---

### Task 8: Fechamento

- [ ] **Step 1:** No `CLAUDE.md`, em "Decisões de produto", acrescentar uma linha curta: "Análise: crédito com categoria de gasto abate a categoria (estorno, devolução); marca na mão vale para o débito e sobrevive à troca de categoria; Dívidas e Investimentos fora de essencial/evitável (decisão do João)."
- [ ] **Step 2: Run** `pnpm lint && pnpm test && pnpm build` na raiz. Expected: tudo verde.
- [ ] **Step 3:** Subir `pnpm dev`, abrir `/analise` com os dados reais e conferir que "sem categoria" e os totais batem com uma consulta SQL de soma dos débitos não transferência dos 12 meses.
- [ ] **Step 4: Commit** `docs: decisões da análise do ano`
