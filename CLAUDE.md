# myFinances

Monorepo pnpm + Turborepo: `apps/api` (Fastify + Prisma) e `apps/web` (Vite + React). Uso pessoal.

## Comandos

- `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm build` na raiz; por app: `pnpm --filter @myfinances/api ...` e `pnpm --filter web ...`.
- Lint e formatação: Biome (`biome.json` na raiz); `pnpm format` aplica. A API fica fora do formatador de propósito (nunca foi formatada; ligar reescreve ~70 arquivos), mas tem lint e a regra contra SQL cru (`config/biome/no-raw-sql.grit`).
- Migration: `pnpm --filter @myfinances/api db:migrate --name <nome>` (sempre com `--name`).
- Integração (Postgres real, usa `.env.e2e`): `pnpm --filter @myfinances/api test:integration`.
- Webhook da Pluggy: `pnpm --filter @myfinances/api pluggy:webhook <https-url>`.
- Cadastrar o número do WhatsApp: `pnpm --filter @myfinances/api whatsapp:link <email> <telefone>`. Estado e pendências da Meta em `docs/whatsapp-setup.md`.
- Portas: API 3333, web 5173, Postgres 127.0.0.1:5435 (bancos `myfinances` e `myfinances_test`).
- psql no banco de dev: `docker exec myfinances-pg-1 sh -c "psql -U \$POSTGRES_USER -d myfinances"`.
- Testes da API: `resetPrismaMocks` zera também o `$transaction`; teste de código com transação interativa precisa religar `mockImplementation((cb) => cb(prismaMock))`.

## Decisões de produto

- Meu Pluggy: até 5 conexões, uso pessoal; o item é ligado pelo widget Pluggy Connect travado no conector MeuPluggy (id 200); colar o `itemId` continua como alternativa.
- A Pluggy atualiza a cada 24h; "Sincronizar" só relê, não força atualização.
- A projeção vai até o próximo recebimento (decisão do João).
- Recorrente no cartão não entra em "a pagar".
- Saque vira transferência para a Carteira.
- Pagamento de fatura nos dois lados é transferência; no cartão, "PAGAMENTO"/"PAGTO" sem "fatura" também vale.
- Pareamento automático só banco↔banco e banco→cartão; compra no cartão e Carteira nunca (Carteira só pelo saque).
- Marcar transferência à mão funciona como livro caixa: liga a outra perna (valor oposto, outra conta, até 3 dias, sem par, a data mais próxima), mesmo se ela tiver sido desmarcada antes; sem outra perna, marca só a transação.
- Item renovado: a conta antiga passa histórico, recorrentes e dias do cartão para a nova e é apagada.
- Transação que some da Pluggy é apagada, menos com lista vazia (pode ser falha) e no dia do corte (fuso).
- Descartado nunca volta; PATCH de recorrente não muda direção nem chave. Apagar esquece (pode voltar como sugestão).
- Recorrente tem tipo (mensal, empréstimo, fora da Pluggy) e conta opcional e editável: o mesmo recorrente vale para qualquer conta e a conta saiu do único (decisão do João). O João vincula a primeira transação e o app vincula as irmãs: mesmo valor exato, ou mesmo texto do banco com valor a até 25% (Pix genérico não basta), uma por mês, no último ano, ao vincular e a cada sincronização (decisão do João); desvinculada à mão e "Não é" não voltam. A vinculada cumpre o mês inteiro, em qualquer conta, mesmo longe do dia cadastrado, e vem antes da regra. Sem conta, a regra casa só pelo texto igual.
- Empréstimo guarda "faltam N parcelas" e o dia em que foi informado; cada vínculo com data depois desconta uma; zero ou quitado à mão sai da projeção. Fora da Pluggy (ex.: VA de R$ 900 no cartão à parte, 5º dia útil) fica fora da projeção e do consultor e conta como recebido/pago na data (decisão do João). Entrada que não chegou aparece como "não recebido", não "atrasado". Descontado em folha (empréstimo ou saída mensal, ex.: plano de saúde; decisão do João) vincula o crédito do salário numa tabela à parte (o crédito continua do salário e pode valer para vários empréstimos) e fica fora do "A pagar" e do "Sai por mês", porque já vem abatido. Ele sai de um recebimento (o escolhido ou o salário de maior valor), vence na data dele e o crédito é vinculado sozinho a cada sincronização e ao salvar, desde o mês em que foi cadastrado; desvinculado à mão não volta (pedido do João, exceção ao "nada se vincula sozinho").
- N-ésimo dia útil acima do que o mês tem cai no último dia útil.
- Crédito com "salario" na descrição vira recorrente já confirmado com um mês só, um por dia (salário e vale; decisão do João); no dia com dois créditos (vale + 13º) vale o menor.
- O webhook só liga com `PLUGGY_WEBHOOK_SECRET`.
- Leitor de holerite: só o layout da Base Frigosul (feito a partir de um print, sem o PDF original); aceita PDF ou print em PNG (OCR local com tesseract.js, sem IA; a imagem é ampliada 2× porque abaixo de 2000 px o OCR come vírgulas); reconhece só quando as verbas batem com os totais e o líquido fecha, senão fica para lançar à mão. FGTS (tipo 04) fica fora. "Ler de novo" (`POST /payslips/:id/reprocess`) troca linhas lançadas à mão só depois de confirmar.
- Tema escuro por padrão, com seletor (decisão do João).
- Transações: "Todos" esconde transferência entre contas; ela só aparece no filtro próprio (decisão do João).
- Toda tabela tem ordenação por coluna (`SortableHead`; decisão do João). Tabela paginada no servidor ordena na API, não no cliente.
- Início no estilo meu.pluggy: contas por banco (Carteira junto), cartões e "A pagar" (vencidas e a vencer) em cima, "Quanto posso gastar" embaixo; sem "Saldo hoje" (decisão do João).
- Fatura vencida e não paga entra em "a pagar" sem limite de dias; recorrente vencido, só até 5 dias (não há registro de pago). Logos oficiais pelo CDN da Pluggy.
- Fluxo do Início (cards do mês + gráfico de 12 meses): créditos/débitos só das contas e Carteira, compras no cartão à parte, sem transferências (decisão do João).
- Início ocupa a tela toda: em tela larga, indicadores e gráfico à esquerda e a coluna acima (contas, cartões, "Quanto posso gastar") à direita (decisão do João).
- Sync serializado por usuário em memória: vale para uma instância só.
- Lançamento pelo WhatsApp (Cloud API oficial; Gemini grátis aceito pelo João): só o número cadastrado é atendido, com ou sem o 9 depois do DDD.
- Lançamento do WhatsApp fica fora de pareamento e recorrentes até a Pluggy trazer a transação; ela o substitui mantendo a descrição do João.
- Conta ambígua no WhatsApp: o bot pergunta (decisão do João); responder só o banco ("caixa") vale a conta corrente. Poupança só quando a mensagem falar nela; "débito" lista só as contas do banco, sem cartão nem Carteira. "Desfazer" apaga o lançamento; se a Pluggy já o trouxe, volta o texto do banco.
- Análise: crédito com categoria de gasto abate a categoria (estorno, devolução); marca na mão vale para o débito e sobrevive à troca de categoria; Dívidas e Investimentos fora de essencial/evitável (decisão do João).
- Renomear ou mudar a categoria só chega às outras quando são iguais (texto do banco, valor e conta) e o João confirma; nada se aplica sozinho às parecidas nem às próximas; as regras por texto foram apagadas (decisão do João). "Salvar como recorrente" confirma até recorrente descartado (decisão do João).
- Emergência é só marca manual da transação (decisão do João), grupo próprio na Análise e fora de 'Dava pra evitar'; descrição editada trava contra o sync.
- Limites e alarmes são regra, sem IA: proposta pela mediana de 6 meses, alarme de categoria uma vez por limiar no mês, de "Quanto posso gastar" só de novo depois de voltar ao positivo; Outros fica sem limite.
- Consultor: resumo pelo Gemini no máximo 1x/dia depois de transação nova (abrir o app não chama a IA); WhatsApp com "?" no fim vai direto ao consultor; cota do consultor em ADVISOR_DAILY_CALLS, o resto fica para os lançamentos. No app ele é um chat no card do Início que guarda a conversa por 7 dias (decisão do João); o WhatsApp não usa essa conversa. Metas do consultor só nascem do clique do João e são separadas dos limites (a revisão de limites não mexe nelas); o acompanhamento é por regra. Salário da Caixa de set/2025 a set/2026 foi lançado à mão pelo holerite: antes de a conta da renda ter dados da Pluggy, o consultor recebe os meses sem sobra nem essencial em % (faltam os gastos dela).
