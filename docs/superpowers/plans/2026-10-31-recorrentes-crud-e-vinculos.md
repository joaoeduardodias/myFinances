# Recorrentes: CRUD, tipos e vínculos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Recorrente com tipo (MONTHLY/LOAN/EXTERNAL), conta opcional, parcelas restantes e transações vinculadas à mão; tela nova no layout A v2.

**Architecture:** Regras puras em `apps/api/src/lib/finance` (ocorrência, parcelas, status do mês); rotas Fastify finas em `http/routes/recurrences`; página React em `apps/web/src/pages/recurring.tsx` + componentes.

**Tech Stack:** Prisma 7 / Postgres, Fastify + zod, vitest, React + TanStack Query + RHF/Zod, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-31-recorrentes-crud-e-vinculos-design.md`

## Global Constraints

- Mensagens ao usuário em pt-BR; identificadores em inglês; comentários no estilo do repo (pt-BR).
- Toda consulta com `userId`; recurso de outro usuário = 404.
- Recorrente com conta e sem vínculos se comporta exatamente como hoje na projeção (testes atuais intactos).
- Migration com `--name recurrence_kinds_and_links`.

## Review Focus

1. Transação vinculada a outro recorrente não pode cumprir este pela heurística.
2. VA como EXTERNAL IN não vira `nextIncome` nem soma saldo.
3. Desvincular depois de quitar por contagem reabre o empréstimo.
4. Vincular transação de outro usuário (id válido) → 404, sem efeito parcial.
5. Lançamento do WhatsApp substituído pela Pluggy mantém `recurrenceId`.

---

### Task 1: Schema e migration
- [ ] `Recurrence`: `kind`, `accountId?` SetNull, `remainingInstallments?`, `remainingAsOf?`, único sem conta, `PAID_OFF`; `Transaction.recurrenceId?` SetNull + índice; `RecurrenceLinkDismissal`.
- [ ] `db:migrate --name recurrence_kinds_and_links`; corrigir tipos quebrados (`accountId` nulo).

### Task 2: Regras puras (`lib/finance`)
- [ ] `projection.ts`: `ProjectionTx` ganha `recurrenceId: string | null`; `ProjectionRecurrence` ganha `kind`, `accountId: string | null`, `accountType: AccountType | null`, `paidOff: boolean`. Ocorrência: vinculada (±5 dias) primeiro; heurística só sobre não vinculadas a outro; sem conta exige texto igual e conta de dinheiro. Fora da projeção: EXTERNAL, paidOff, conta CREDIT.
- [ ] `recurrence-progress.ts`: `remainingInstallments({ remainingInstallments, remainingAsOf, linkedDates }) -> number | null`, `loanEndMonth(rule, today, remaining) -> 'YYYY-MM' | null`, `monthStatus(rec, today, txs, accountTypes) -> { state: 'PAID'|'DUE'|'LATE', date, days } | null`.
- [ ] Testes de cada caso da spec antes da implementação.

### Task 3: Detecção, sync e consumidores
- [ ] Detecção: conhecido por texto+sentido (salário + dia), sem conta; transações vinculadas fora da entrada.
- [ ] Renovação: `updateMany` das recorrentes para a conta nova (sem colisão).
- [ ] WhatsApp substituído herda `recurrenceId`.
- [ ] "Salvar como recorrente" vincula a transação; `findTransactionRecurrence` usa `recurrenceId` primeiro e casa sem conta.
- [ ] Consultor: só MONTHLY IN; sem conta casa por texto em qualquer conta.

### Task 4: Rotas
- [ ] `GET /recurrences` enriquecido; `GET /recurrences/:id`; `POST`/`PATCH` com `kind`, `accountId` nulo, parcelas, `PAID_OFF`; `DELETE`; `GET :id/link-candidates`; `POST :id/links`; `DELETE :id/links/:transactionId`; `POST :id/link-dismissals`.
- [ ] Testes por rota: sucesso, 400, 401, 404.

### Task 5: Web
- [ ] `http/recurrences.ts` com os tipos novos.
- [ ] Formulário: tipo, conta opcional, parcelas.
- [ ] Página: indicadores, aviso de sugestões, abas+busca, grupos, linha expansível, picker, apagar com confirmação.
- [ ] Testes em `recurring.test.tsx`.

### Task 6: Integração e fechamento
- [ ] `isolation.integration.test.ts` com as rotas novas; vínculo SetNull ao apagar.
- [ ] lint, typecheck, build, testes unitários e de integração; atualizar CLAUDE.md (decisões de produto).
