# Recorrentes: CRUD completo, tipos e vínculo com transações

## Intenção

A tela de recorrentes vira a visão de **tudo que se repete todo mês**: contas fixas,
empréstimos que o João ainda paga e valores que nunca passam pela Pluggy (o
vale-alimentação de R$ 900, recebido num cartão separado). Para isso o recorrente
deixa de ser só uma regra (conta + texto + dia) e passa a ter **transações vinculadas**
escolhidas pelo João. É isso que identifica a qual recorrente cada pagamento pertence,
mesmo quando a descrição do Pix muda ou o pagamento sai de outra conta.

## Objetivos

- CRUD completo: listar, ver o detalhe, criar, editar, confirmar sugestão, descartar,
  reativar, marcar como quitado e **apagar**.
- Três tipos: **Conta do mês**, **Empréstimo** e **Fora da Pluggy**.
- Vincular e desvincular transações à mão. O app sugere a transação parecida, mas
  nunca vincula sozinho.
- A conta deixa de ser fixa: é opcional e editável para todos os recorrentes, e um
  vínculo vale para transações de qualquer conta.
- Empréstimo com "quantas parcelas faltam" (opcional), progresso, total restante e
  mês de término.
- Status do mês em cada linha: pago, a vencer ou atrasado.

## Fora do escopo

- Juros, saldo devedor e amortização de empréstimo (só parcela × quantidade).
- Controlar os gastos do cartão do VA.
- Vincular em massa por regra ou texto (as regras por texto foram apagadas; nada se
  aplica sozinho).

## Anti-objetivos

- Vincular automaticamente qualquer transação.
- Mudar o "Quanto posso gastar" ou o "A pagar" para quem não usar os tipos novos: um
  recorrente sem vínculos e com conta precisa se comportar exatamente como hoje.
- O vale-alimentação (ou qualquer "Fora da Pluggy") encurtar a janela da projeção ou
  aparecer como dinheiro disponível.

## Decisões do João

- Layout A versão 2 (mockup em `.superpowers/brainstorm/…/layout-a-v2.html`): lista
  numa coluna em grupos; a linha abre embaixo com o histórico.
- No empréstimo ele sabe o valor da parcela e às vezes **quantas parcelas faltam**.
- As parcelas saem por Pix ou transferência de contas da Pluggy, e não sempre da mesma.
- A conta não deve prender o recorrente: vale para todos os tipos.
- O VA é um cartão separado; ele recebe R$ 900 todo mês.

## Modelo de dados (migration `recurrence_kinds_and_links`)

`Recurrence`:
- `kind RecurrenceKind @default(MONTHLY)`, com o enum `MONTHLY | LOAN | EXTERNAL`.
- `accountId` passa a ser opcional (`String?`), com a relação `onDelete: SetNull`. Se a
  conta some, o recorrente fica, sem conta.
- `remainingInstallments Int?` e `remainingAsOf DateTime? @db.Date`: o "faltam N" que o
  João informou e o dia em que informou. Só valem para `LOAN`.
- O enum `RecurrenceStatus` ganha `PAID_OFF`, a quitação manual (para empréstimo sem
  número de parcelas).
- O único passa a ser `[userId, descriptionKey, direction, dayRule, dayValue]`, sem a
  conta. Hoje não existem duplicados nesse recorte (conferido no banco de dev); a
  migration falha alto se aparecer algum.

`Transaction`:
- `recurrenceId String?` → `Recurrence`, com `onDelete: SetNull` e `@@index([recurrenceId])`.
  Cada transação tem no máximo um recorrente.

Nova tabela `RecurrenceLinkDismissal (recurrenceId, transactionId)`, única pelo par e
com Cascade nos dois lados: guarda o "Não é" para a sugestão não voltar.

Dados atuais: nada é reclassificado na migration. Todos ficam `MONTHLY`. O João muda o
tipo pela tela (Financiamento Casa/Carro e Emprestimo Dr Paulo → Empréstimo; Vale
Alimentação, hoje na Carteira, → Fora da Pluggy).

## Regras

**Parcelas restantes (calculadas, não gravadas):**
`restantes = remainingInstallments − nº de transações vinculadas com data > remainingAsOf`,
com piso em 0. Desvincular devolve a parcela, e uma parcela antiga vinculada depois não
desconta de novo. O total restante é `restantes × expectedAmountCents`, e o término é o
mês da última data esperada. Um empréstimo está **quitado** quando `status = PAID_OFF`
ou `restantes = 0`. Editar o "faltam N" regrava `remainingAsOf = hoje`.

**Ocorrência do mês (o que conta como "pago"):** para cada data esperada, vale primeiro
uma transação **vinculada** a este recorrente a até ±5 dias (qualquer conta). Sem
vínculo, segue a heurística atual, só sobre transações que não estão vinculadas a outro
recorrente:
- recorrente com conta: igual a hoje (mesma conta, texto igual ou valor a até 10%);
- recorrente sem conta: qualquer conta de dinheiro, mas exige o **texto igual** (só o
  valor parecido em qualquer conta casaria demais).

Cada transação cumpre uma ocorrência só, como já é hoje.

**Projeção ("Quanto posso gastar", "A pagar", próximo recebimento):**
- `EXTERNAL` fica fora de tudo.
- `LOAN` quitado fica fora.
- Recorrente na conta de cartão continua fora do "A pagar".
- Recorrente sem conta conta como dinheiro.

**Status do mês na tela**, calculado na API para o mês corrente, pela primeira data
esperada do mês:
- `PAID`: com a data da transação.
- `DUE`: com os dias que faltam.
- `LATE`: com os dias de atraso.

`EXTERNAL` não tem status e mostra só a regra do dia.

**Detecção (sugestões):**
- A identidade do que já é conhecido passa a ser texto + sentido, sem a conta (no
  salário, mais o dia, como hoje). Um recorrente da Netflix na conta A impede a sugestão
  da Netflix na conta B.
- Transações já vinculadas ficam fora da entrada da detecção.

**Item renovado:** as transações já mudam de conta mantendo o id, então o vínculo
sobrevive. A troca da conta do recorrente vira um `updateMany` simples. O tratamento de
colisão por conta deixa de existir, porque o único não tem mais a conta.

**Lançamento do WhatsApp substituído pela Pluggy:** a transação nova herda o
`recurrenceId` do lançamento.

**"Salvar como recorrente" (transação):** cria ou confirma como hoje e **vincula aquela
transação**. `findTransactionRecurrence` olha primeiro `tx.recurrenceId`.

**Consultor (salário):** só o `MONTHLY IN` entra. Para cada mês, conta primeiro o
crédito vinculado e, sem ele, a regra atual (sem conta, qualquer conta pelo texto). O
`EXTERNAL` fica fora.

## API (todas com auth e escopo por `userId`; o recurso de outro usuário dá 404)

- `GET /recurrences`: lista com `kind`, `account | null`, `status`, `monthStatus`,
  `linkedCount`, `lastLinkedDate`, `loan { remaining, remainingCents, endMonth } | null`
  e `paidOff`. Os totais do topo saem desta lista, no cliente.
- `GET /recurrences/:id`: detalhe com o valor por mês dos últimos 6 meses (vinculadas +
  heurística), as últimas 10 vinculadas mais o total, e as sugestões de vínculo (até 3:
  sem vínculo, sem "Não é", mesmo sinal, não transferência, que casam uma data esperada
  dos últimos 2 meses).
- `POST /recurrences`: cria confirmado, com `kind`, `accountId?` e `remainingInstallments?`
  (este só para `LOAN`).
- `PATCH /recurrences/:id`: aceita mudar `accountId` (inclusive para `null`), `kind`,
  `remainingInstallments`, os campos de hoje e `status ∈ {CONFIRMED, PAID_OFF}`
  (`PAID_OFF` só para `LOAN`). `direction` e `descriptionKey` continuam fixos, porque são
  a identidade contra ressuscitar o que foi descartado.
- `POST /recurrences/:id/dismiss`: continua igual.
- `DELETE /recurrences/:id`: apaga o recorrente; as transações ficam e perdem o vínculo.
  Responde 204.
- `GET /recurrences/:id/link-candidates?search=&page=`: transações para a janela de
  escolha. Traz as do mesmo sinal, sem transferência, dos últimos 12 meses, primeiro as
  que casam a regra e depois por data decrescente, paginadas no servidor (30 por
  página). Cada uma vem com `linkedTo { id, description } | null`.
- `POST /recurrences/:id/links { transactionIds: uuid[] (1..100) }`: vincula. Uma
  transação ligada a outro recorrente **muda** para este, porque a janela mostra a quem
  ela pertencia. Recusa transferência, sinal trocado e transação de outro usuário (404).
  Tudo numa transação de banco.
- `DELETE /recurrences/:id/links/:transactionId`: desvincula.
- `POST /recurrences/:id/link-dismissals { transactionId }`: o "Não é".

Mensagens ao usuário em português; códigos e logs em inglês, como no resto da API.

## Tela (`/recorrentes`)

É o mockup v2, sobre os componentes atuais (shadcn, tema escuro, `formatBRL`):

- **Topo:** "Recorrentes" + mês corrente + "Novo recorrente".
- **Quatro indicadores:**
  - Sai por mês: saídas ativas, sem `EXTERNAL`.
  - Entra por mês: entradas ativas, com o VA, com rótulo que separa o que é fora da Pluggy.
  - Pago este mês: X de Y, com barra.
  - Empréstimos: total restante dos que têm parcelas informadas.
- **Aviso de sugestões:** "N sugestões", com "Revisar", que abre a lista de sugeridos
  inline com Confirmar e Descartar como hoje.
- **Abas:** Ativos, Quitados e Descartados, mais a busca por descrição, toda no cliente
  porque a lista é pequena.
- **Grupos em Ativos:**
  - Contas do mês: `MONTHLY OUT`.
  - Recebimentos: `MONTHLY IN`.
  - Empréstimos: `LOAN`.
  - Fora da Pluggy: `EXTERNAL`.

  Em cada grupo a ordem é pelo próximo vencimento, com o subtotal no título. Grupo vazio
  não aparece; sem nenhum recorrente aparece um estado vazio com "Novo recorrente".
- **Linha:** ícone do tipo (lucide), nome, regra do dia (e a conta, se houver), chip de
  status (verde pago, âmbar a vencer, vermelho atrasado), valor e chevron. A linha é um
  `button` com `aria-expanded`. No empréstimo entram ainda a barra de progresso,
  "faltam N parcelas · R$ X · até mmm/aa", ou "sem total informado".
- **Linha aberta:** carrega `GET /recurrences/:id` e mostra:
  - as barras dos 6 meses (CSS simples, sem biblioteca);
  - as vinculadas, com ✕ para desvincular e o link "ver todas", que abre a janela de
    escolha já filtrada nas vinculadas;
  - o cartão "Parece desta conta", com Vincular / Não é;
  - as ações Escolher transações, Editar, Marcar como quitado / Reabrir (empréstimo) e
    Apagar (em vermelho, à direita).
- **Janela "Escolher transações":** busca com debounce, lista paginada com caixa de
  seleção, "(já vinculada)" e "(de: Outro recorrente)", e "Salvar vínculos" com os
  vínculos adicionados e removidos. Tem estados de carregando e de erro, e o botão fica
  desabilitado enquanto envia.
- **Formulário (criar/editar):** React Hook Form + Zod, reaproveitando o
  `recurrence-form`. Campos:
  - Tipo;
  - Entrada/Saída (fixo ao editar);
  - Descrição;
  - Valor;
  - Regra e dia;
  - Política de dia não útil;
  - Conta, opcional, com "Qualquer conta";
  - "Parcelas que faltam", só no Empréstimo e opcional.
- **Apagar:** diálogo de confirmação que explica que as transações ficam e que, se a
  Pluggy continuar trazendo, ele pode voltar como sugestão ("para não voltar, use
  Descartar").
- **Atualização dos dados:** todas as mutações invalidam `recurrences`, `recurrence` e
  `dashboard`, com toast de sucesso ou erro.

## Testes (TDD)

- **Unitários de `lib/finance`:**
  - ocorrência por vínculo em outra conta;
  - recorrente sem conta exige o texto;
  - transação vinculada a outro recorrente não cumpre este;
  - `EXTERNAL` e empréstimo quitado fora da projeção;
  - cálculo das parcelas restantes (antes e depois de `remainingAsOf`, piso 0, desvincular);
  - `monthStatus`;
  - detecção ignora as vinculadas e casa o conhecido sem a conta.
- **Rotas (vitest + prismaMock):** cada endpoint novo nos casos de sucesso, 400 (sinal
  trocado, transferência, `PAID_OFF` fora de empréstimo, `remainingInstallments` fora de
  empréstimo), 401 e 404 (de outro usuário).
- **Integração (Postgres real):**
  - migration;
  - vincular, mudar de recorrente, desvincular e apagar com `SetNull`;
  - isolamento entre usuários em `isolation.integration.test.ts`;
  - renovação de item mantendo vínculos;
  - WhatsApp substituído herdando o vínculo.
- **Web (`recurring.test.tsx`):**
  - grupos e abas;
  - expandir uma linha;
  - vincular pela sugestão e pela janela;
  - desvincular;
  - apagar com confirmação;
  - formulário de empréstimo.

  Os testes atuais continuam passando sem afrouxar nenhum.

## Deixado para quem implementa

- Nomes internos dos componentes e a divisão dos arquivos da página.
- O ícone de cada tipo.
- O debounce da busca (uns 300 ms).

## Desconto em folha (pedido depois do design)

- O empréstimo ganha `payrollDeduction`, que só vale para empréstimo de saída. O vínculo é com o **crédito do salário** e fica em `RecurrencePayrollLink`, sem mexer no `Transaction.recurrenceId`. Assim o salário continua cumprindo o recorrente dele, e o mesmo crédito pode valer para vários empréstimos.
- Cada salário vinculado conta como parcela paga, tanto nas parcelas que faltam quanto no status do mês e no histórico. Esse empréstimo não tem sugestão automática.
- Ele fica fora da projeção e do "Sai por mês", porque já vem abatido do salário líquido.
- Vínculo automático (pedido do João depois): o empréstimo guarda `payrollSourceId`, que é o recebimento mensal de que a parcela é descontada. Sem esse campo, vale o salário de maior valor. A cada sincronização e ao salvar o empréstimo, o crédito que cumpre cada ocorrência desse recebimento é vinculado, a partir do mês em que o empréstimo foi cadastrado. Um crédito desvinculado à mão vira dispensa e não volta. O vencimento e o status do mês seguem a regra do recebimento, e o formulário não pede dia.

## Ajustes feitos na implementação

- A janela de escolha tem 10 por página e altura fixa, sem rolagem interna.

- A janela de escolha ordena só por data decrescente. As transações que casam a regra aparecem no cartão "Parece deste recorrente" da linha aberta, e não no topo da janela: ordenar por "casa a regra" com paginação no servidor exigiria carregar o ano inteiro.
- Recorrente sem conta casa pelo texto igual em qualquer conta, inclusive no cartão: se foi pago, não deve aparecer em "a pagar".
- A barra do empréstimo é `vinculadas / (vinculadas + restantes)`, porque o total de parcelas não é guardado.
- O aviso de sugestões já lista cada uma com Confirmar e Descartar, sem o passo extra "Revisar".

## Escolhas minhas (para o João conferir)

1. **Grupo "Recebimentos":** o salário (`MONTHLY IN`) fica num grupo próprio; a conversa
   só falou em contas, empréstimos e fora da Pluggy.
2. **"Fora da Pluggy" não tem status de pago:** como nunca chega transação, mostra só o
   "todo dia X".
3. **Apagar ≠ Descartar:** apagar esquece o recorrente, que pode voltar como sugestão;
   descartar continua sendo o "nunca volta".
4. **Vincular transação já ligada a outro recorrente:** ela muda de recorrente.
5. **Recorrente sem conta:** só casa sozinho pelo texto igual.
6. **Sem reclassificação automática dos dados atuais:** o João muda o tipo pela tela.
7. **Conta apagada:** o recorrente fica sem conta em vez de ser apagado junto.
