# Editar transação e marca emergência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marca manual "Emergência" como grupo próprio na Análise, janela para editar descrição/categoria/marca de uma transação a partir da Análise, e detalhe da categoria mais largo.

**Architecture:** O enum Prisma `Necessity` ganha `EMERGENCY`, aceito só na marca da transação; a troca de padrão por categoria continua só essencial/evitável. A agregação ganha o grupo `emergency`. A descrição editada reaproveita `descriptionLocked` + `originalDescription` numa rota nova. No web, um `TransactionDialog` único abre de "Maiores gastos", "Dava pra evitar" e do detalhe da categoria.

**Tech Stack:** Fastify + Zod + Prisma (Postgres), Vitest com `makePrismaMock`; Vite + React 19, TanStack Query, ky, recharts 2.15, shadcn/ui, Biome.

**Spec:** `docs/superpowers/specs/2026-10-28-editar-transacao-e-emergencia-design.md`

## Global Constraints

- Opções da marca, nesta ordem e com estes textos: "Padrão da categoria" (`null`), "Essencial" (`ESSENTIAL`), "Evitável" (`AVOIDABLE`), "Emergência" (`EMERGENCY`).
- Emergência é só marca manual de transação. `PUT /category-necessities/:category` continua aceitando só `ESSENTIAL`/`AVOIDABLE`, e o diálogo "Essencial ou evitável" não muda.
- Emergência entra no "Saiu", tem indicador com % do Saiu e cor própria no gráfico (tema claro e escuro), e não entra em "Dava pra evitar".
- Editar a descrição nunca muda `descriptionKey`.
- Crédito (`amountCents > 0`) e transferência não têm marca.
- Textos da UI em português; toda tabela com `SortableHead` (ordem no cliente); cores por tokens de `index.css`.
- Testes nunca chamam o Gemini de verdade. A API está fora do formatador do Biome: não rodar `pnpm format` nela.
- Migration: `migrate dev` pede reset por causa da migration antiga `20261023150000_whatsapp_entries` editada. **Nunca resetar.** Gerar o SQL com `prisma migrate diff` (do banco para o schema), salvar em `apps/api/prisma/migrations/<timestamp>_emergency/migration.sql`, aplicar com `pnpm --filter @myfinances/api db:migrate:deploy` e rodar `db:generate`.

## Review Focus

1. **Emergência num débito de "Dívidas e juros" ou sem categoria**: vai para `emergencyCents`, não para dívida nem sem classificação. Testado na Task 1.
2. **Editar duas vezes uma transação da Pluggy**: `originalDescription` continua sendo o texto do banco (a segunda edição não o troca pelo da primeira), e o "Desfazer" do WhatsApp segue voltando o texto do banco. Testado na Task 2.
3. **Apagar a descrição**: numa transação da Pluggy, volta o texto do banco e destrava. Num lançamento manual, que não tem texto do banco, dá 400. Testado na Task 2.
4. **Abrir a janela num crédito (estorno no detalhe da categoria)**: sem select de marca; descrição e categoria editáveis. Testado na Task 4.
5. **Salvar sem mudar nada, ou mudando só um campo**: só a rota do campo que mudou é chamada. Testado na Task 4.

---

### Task 1: Marca EMERGENCY na API e na agregação

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`enum Necessity { ESSENTIAL AVOIDABLE EMERGENCY }`)
- Create: migration `<timestamp>_emergency` (ver Global Constraints)
- Modify: `apps/api/src/lib/finance/categories.ts`, `apps/api/src/lib/finance/annual-analysis.ts` + `.test.ts`
- Modify: `apps/api/src/http/routes/transactions/update-transaction-necessity.ts`, `transactions.test.ts`
- Modify: `apps/api/src/http/routes/categories/categories.test.ts`
- Modify: `apps/api/src/http/routes/analysis/get-analysis.ts`, `get-analysis-transactions.ts` (enums e campo novo nos schemas Zod), `analysis.test.ts` se precisar

**Interfaces:**
- Produces:
  - Em `categories.ts`: `Necessity` continua `'ESSENTIAL' | 'AVOIDABLE'` (padrão de categoria); novo `type TransactionNecessity = Necessity | 'EMERGENCY'`.
  - `AnalysisTx.necessity: TransactionNecessity | null`.
  - `SpendGroup = 'essential' | 'avoidable' | 'emergency' | 'debt' | 'unclassified'`.
  - `AnalysisMonth` (e `totals`) ganha `emergencyCents: number`.
  - `PATCH /transactions/:id/necessity` aceita `'ESSENTIAL' | 'AVOIDABLE' | 'EMERGENCY' | null`.
  - `GET /analysis` e `GET /analysis/transactions` devolvem `necessity` com `EMERGENCY` e `emergencyCents` nos meses e totais.

- [ ] **Step 1: Schema + migration** (procedimento das Global Constraints). Postgres: `ALTER TYPE "Necessity" ADD VALUE 'EMERGENCY';`.

- [ ] **Step 2: Write the failing tests**
  - `annual-analysis.test.ts`, `it('emergência é grupo próprio e vence dívida e sem categoria')`: débitos -5000 "Carro" com `necessity: 'EMERGENCY'`, -2000 "Dívidas e juros" com `EMERGENCY`, -1000 sem categoria com `EMERGENCY` → `totals.emergencyCents === 8000`, `debtCents === 0`, `unclassifiedCents === 0`, `essentialCents === 0`; `topAvoidable` vazio; `topExpenses[0].group === 'emergency'`.
  - `transactions.test.ts`, `it('PATCH necessity aceita EMERGENCY')` → 204 e `update` com `{ necessity: 'EMERGENCY' }`.
  - `categories.test.ts`, `it('PUT category-necessities recusa EMERGENCY')` → 400 e nem `upsert` nem `deleteMany` chamados.

- [ ] **Step 3: Run** `pnpm --filter @myfinances/api exec vitest run src/lib/finance/annual-analysis.test.ts src/http/routes/transactions/transactions.test.ts src/http/routes/categories/categories.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement.** Em `classify`, débito com `necessity` vira o grupo da marca (`EMERGENCY` → `emergency`). `GROUP_FIELD.emergency = 'emergencyCents'`. O PUT de categoria já valida o body com `z.enum(['ESSENTIAL','AVOIDABLE'])`; só confira que continua assim.

- [ ] **Step 5: Run** os mesmos testes e depois `pnpm --filter @myfinances/api test`. Expected: PASS.

- [ ] **Step 6: Commit** `feat(api): marca emergência na transação e na análise`

---

### Task 2: Rota de descrição da transação

**Files:**
- Create: `apps/api/src/http/routes/transactions/update-transaction-description.ts`
- Modify: `apps/api/src/http/server.ts` (registrar; imports na ordem do Biome), `transactions.test.ts`

**Interfaces:**
- Produces: `PATCH /transactions/:id/description`, body `{ description: string }` (trim; máximo 200 caracteres) → 204.
  - Transação de outro usuário → 404.
  - Texto não vazio, transação da Pluggy (`source !== 'MANUAL'`): grava `description`, `descriptionLocked: true` e `originalDescription: originalDescription ?? descriptionAtual`.
  - Texto não vazio, lançamento manual: grava só `description`.
  - Texto vazio, com `originalDescription`: grava `description: originalDescription`, `descriptionLocked: false`, `originalDescription: null`.
  - Texto vazio, sem `originalDescription` → 400 "A descrição não pode ficar vazia."
  - Nunca escreve `descriptionKey` nem `category`.

- [ ] **Step 1: Write the failing tests** em `transactions.test.ts` (padrão `prismaMock`), um `it` por linha do Produces:
  - `PATCH description de transação da Pluggy trava e guarda o texto do banco`: findFirst devolve `{ source: 'PLUGGY', description: 'PIX JOAO', originalDescription: null }`; body `'Almoço com Ana'` → `update` com `{ description: 'Almoço com Ana', descriptionLocked: true, originalDescription: 'PIX JOAO' }` e sem a chave `descriptionKey`.
  - `segunda edição mantém o texto do banco`: findFirst `{ source: 'PLUGGY', description: 'Almoço com Ana', originalDescription: 'PIX JOAO' }`, body `'Almoço'` → `originalDescription: 'PIX JOAO'`.
  - `lançamento manual só troca a descrição`: `{ source: 'MANUAL', … }` → `update` com `{ description: 'Gasolina' }`.
  - `descrição vazia volta o texto do banco`: body `'   '`, `originalDescription: 'PIX JOAO'` → `{ description: 'PIX JOAO', descriptionLocked: false, originalDescription: null }`.
  - `descrição vazia em lançamento manual` → 400, sem `update`.
  - `descrição de transação de outro usuário` → 404, sem `update`.

- [ ] **Step 2: Run** `pnpm --filter @myfinances/api exec vitest run src/http/routes/transactions/transactions.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** seguindo `update-transaction-necessity.ts` (auth, Zod, `NotFoundError`, `BadRequestError`). Confira o nome real do valor de `source` da Pluggy no schema Prisma e use-o no teste.

- [ ] **Step 4: Run** o teste e `pnpm --filter @myfinances/api test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): editar a descrição da transação`

---

### Task 3: Emergência na tela Análise

**Files:**
- Modify: `apps/web/src/http/analysis.ts`, `apps/web/src/pages/analysis.tsx`, `apps/web/src/components/analysis-chart.tsx`, `apps/web/src/index.css`, `apps/web/src/pages/analysis.test.tsx`

**Interfaces:**
- Consumes: shapes da Task 1.
- Produces (em `http/analysis.ts`):
  - `Necessity` continua `'ESSENTIAL' | 'AVOIDABLE'` (usado pelo diálogo de padrões).
  - `type TransactionNecessity = Necessity | 'EMERGENCY'`; `AnalysisExpense.necessity: TransactionNecessity | null`.
  - `SpendGroup` com `'emergency'`; `AnalysisTotals.emergencyCents`.
  - `setTransactionNecessity(id: string, necessity: TransactionNecessity | null)`.
  - `setTransactionDescription(id: string, description: string): Promise<void>` → `PATCH transactions/:id/description`.
  - Token CSS `--emergency` (claro e escuro), com classe utilitária no mesmo padrão de `--avoidable`.

- [ ] **Step 1: Write the failing tests** em `analysis.test.tsx`:
  - `mostra emergência com o percentual do que saiu`: totals com `essentialCents: 6000`, `avoidableCents: 2000`, `emergencyCents: 2000`, demais 0 → "Saiu" "R$ 100,00", indicador "Emergência" com "R$ 20,00" e "20%".
  - Em "Maiores gastos", uma transação com `group: 'emergency'` mostra o grupo como "Emergência". Em "Para onde foi" o grupo continua sendo o da categoria, que nunca é emergência.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/pages/analysis.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - "Saiu" = essencial + evitável + emergência + dívida + sem classificação. A soma fica num lugar só, usado pelo indicador e pela tabela.
  - Indicador "Emergência" depois de "Evitável".
  - Série `emergency` no gráfico, empilhada entre evitável e dívida.
  - Rótulo "Emergência" onde os grupos são nomeados.

- [ ] **Step 4: Run** o teste e `pnpm --filter web test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): emergência na análise`

---

### Task 4: Janela da transação e detalhe da categoria mais largo

**Files:**
- Create: `apps/web/src/components/transaction-dialog.tsx`
- Modify: `apps/web/src/pages/analysis.tsx` (`ExpensesTable` abre a janela), `apps/web/src/components/category-transactions-sheet.tsx`, `apps/web/src/pages/analysis.test.tsx`

**Interfaces:**
- Consumes: `setTransactionDescription`, `setTransactionNecessity`, `TransactionNecessity`, `AnalysisExpense` (Task 3); `setTransactionCategory`, `listCategories` (`http/transactions.ts`).
- Produces: `TransactionDialog({ transaction, onClose }: { transaction: AnalysisExpense | null; onClose: () => void })`, aberto quando `transaction !== null`.
  - Mostra data, conta e valor só para leitura.
  - Campos: descrição (input), categoria (select) e marca (select com as quatro opções das Global Constraints; escondido quando `amountCents > 0`).
  - "Salvar" chama só as rotas dos campos que mudaram, depois invalida `['analysis']`, `['analysis-transactions']`, `['transactions']` e `['dashboard']` e fecha.
  - Erro: `toast.error`, e a janela continua aberta.

- [ ] **Step 1: Write the failing tests** em `analysis.test.tsx`:
  - `clicar em maiores gastos abre a transação e salva descrição e categoria`: clicar na linha, trocar a descrição e a categoria, "Salvar" → `setTransactionDescription(id, 'Conserto do carro')` e `setTransactionCategory(id, 'Carro')`; `setTransactionNecessity` não é chamado.
  - `marcar emergência pela janela`: escolher "Emergência" → `setTransactionNecessity(id, 'EMERGENCY')`, só ele.
  - `dava pra evitar abre a mesma janela`.
  - `linha do detalhe da categoria abre a janela; crédito não tem marca`: abrir o detalhe, clicar numa linha com `amountCents > 0` → sem o select de marca.
  - Ajuste os testes da Task 7 anterior que trocavam categoria e marca direto na linha do detalhe para passar pela janela.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/pages/analysis.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Detalhe da categoria: tirar das linhas os dois selects e as mutations. As linhas ficam com data, descrição, conta e valor, e o clique abre o `TransactionDialog`.
  - Largura do detalhe: em tela larga, por volta de metade da tela, sem rolagem horizontal (ex.: `sm:max-w-none sm:w-1/2`, com piso para telas médias). No celular, tela cheia.
  - Ordenação do Valor pelo valor com sinal, e não por `Math.abs` (minor anotado na revisão anterior).

- [ ] **Step 4: Run** o teste e `pnpm --filter web test`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(web): janela da transação na análise`

---

### Task 5: Fechamento

- [ ] **Step 1:** Em `CLAUDE.md`, "Decisões de produto", acrescentar: "Emergência é só marca manual da transação (decisão do João), grupo próprio na Análise e fora de 'Dava pra evitar'; descrição editada trava contra o sync e a regra de categoria segue o texto do banco."
- [ ] **Step 2: Run** `pnpm lint && pnpm test && pnpm build` na raiz. Expected: tudo verde.
- [ ] **Step 3: Commit** `docs: decisões de emergência e descrição editada`
