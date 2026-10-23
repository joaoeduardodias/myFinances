# myFinances

Monorepo pnpm + Turborepo: `apps/api` (Fastify + Prisma) e `apps/web` (Vite + React). Uso pessoal.

## Comandos

- `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm build` na raiz; por app: `pnpm --filter @myfinances/api ...` e `pnpm --filter web ...`.
- Lint e formatação: Biome (`biome.json` na raiz); `pnpm format` aplica. A API fica fora do formatador de propósito (nunca foi formatada; ligar reescreve ~70 arquivos), mas tem lint e a regra contra SQL cru (`config/biome/no-raw-sql.grit`).
- Migration: `pnpm --filter @myfinances/api db:migrate --name <nome>` (sempre com `--name`).
- Integração (Postgres real, usa `.env.e2e`): `pnpm --filter @myfinances/api test:integration`.
- Webhook da Pluggy: `pnpm --filter @myfinances/api pluggy:webhook <https-url>`.
- Cadastrar o número do WhatsApp: `pnpm --filter @myfinances/api whatsapp:link <email> <telefone>`.
- Portas: API 3333, web 5173, Postgres 127.0.0.1:5435 (bancos `myfinances` e `myfinances_test`).

## Decisões de produto

- Meu Pluggy: até 5 conexões, uso pessoal; o item é ligado pelo widget Pluggy Connect travado no conector MeuPluggy (id 200); colar o `itemId` continua como alternativa.
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
- Crédito com "salario" na descrição vira recorrente já confirmado com um mês só, um por dia (salário e vale; decisão do João); no dia com dois créditos (vale + 13º) vale o menor.
- O webhook só liga com `PLUGGY_WEBHOOK_SECRET`.
- Leitor de holerite espera um PDF de exemplo; quando chegar, criar `POST /payslips/:id/reprocess`.
- Tema escuro por padrão, com seletor (decisão do João).
- Toda tabela tem ordenação por coluna (`SortableHead`; decisão do João). Tabela paginada no servidor ordena na API, não no cliente.
- Início no estilo meu.pluggy: contas por banco (Carteira junto), cartões e "A pagar" (vencidas e a vencer) em cima, "Quanto posso gastar" embaixo; sem "Saldo hoje" (decisão do João).
- Fatura vencida e não paga entra em "a pagar" sem limite de dias; recorrente vencido, só até 5 dias (não há registro de pago). Logos oficiais pelo CDN da Pluggy.
- Fluxo do Início (cards do mês + gráfico de 12 meses): créditos/débitos só das contas e Carteira, compras no cartão à parte, sem transferências (decisão do João).
- Início ocupa a tela toda: em tela larga, indicadores e gráfico à esquerda e a coluna acima (contas, cartões, "Quanto posso gastar") à direita (decisão do João).
- Sync serializado por usuário em memória: vale para uma instância só.
- Lançamento pelo WhatsApp (Cloud API oficial; Gemini grátis aceito pelo João): só o número cadastrado é atendido, com ou sem o 9 do DDD.
- Lançamento do WhatsApp fica fora de pareamento e recorrentes até a Pluggy trazer a transação; ela o substitui mantendo a descrição do João.
- Conta ambígua no WhatsApp: o bot pergunta (decisão do João). "Desfazer" devolve o texto do banco.
