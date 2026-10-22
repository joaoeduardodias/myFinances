# myFinances

Monorepo pnpm + Turborepo: `apps/api` (Fastify + Prisma) e `apps/web` (Vite + React). Uso pessoal.

## Comandos

- `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm build` na raiz; por app: `pnpm --filter @myfinances/api ...` e `pnpm --filter web ...`.
- Migration: `pnpm --filter @myfinances/api db:migrate --name <nome>` (sempre com `--name`).
- Integração (Postgres real, usa `.env.e2e`): `pnpm --filter @myfinances/api test:integration`.
- Webhook da Pluggy: `pnpm --filter @myfinances/api pluggy:webhook <https-url>`.
- Portas: API 3333, web 5173, Postgres 127.0.0.1:5435 (bancos `myfinances` e `myfinances_test`).

## Decisões de produto

- Meu Pluggy: até 5 conexões, uso pessoal; o item é ligado colando o `itemId`.
- A Pluggy atualiza a cada 24h; "Sincronizar" só relê, não força atualização.
- A projeção vai até o próximo recebimento (decisão do João).
- Recorrente no cartão não entra em "a pagar".
- Saque vira transferência para a Carteira.
- Pagamento de fatura nos dois lados é transferência; no cartão, "PAGAMENTO"/"PAGTO" sem "fatura" também vale.
- Pareamento automático só banco↔banco e banco→cartão; compra no cartão e Carteira nunca (Carteira só pelo saque).
- Item renovado: a conta antiga passa histórico, recorrentes e dias do cartão para a nova e é apagada.
- Transação que some da Pluggy é apagada, menos com lista vazia (pode ser falha) e no dia do corte (fuso).
- Descartado nunca volta; PATCH de recorrente não muda conta, direção nem chave.
- N-ésimo dia útil acima do que o mês tem cai no último dia útil.
- O webhook só liga com `PLUGGY_WEBHOOK_SECRET`.
- Leitor de holerite espera um PDF de exemplo; quando chegar, criar `POST /payslips/:id/reprocess`.
- Tema escuro por padrão, com seletor (decisão do João).
- Sync serializado por usuário em memória: vale para uma instância só.
- Melhoria futura: lançamento por WhatsApp ou Telegram.
