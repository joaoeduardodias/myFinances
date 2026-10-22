# myFinances — Design

Data: 2026-10-22

## Intenção

Hoje o João acompanha o dinheiro abrindo o app de cada banco, um por um. Não existe um lugar que diga, de uma vez, quanto ele tem, quanto ainda vai pagar no mês e quanto sobra para gastar.

O myFinances junta todas as contas e cartões via Open Finance e responde a essas três perguntas na tela inicial. Ele recebe o salário no 5º dia útil e um vale (adiantamento) por volta do dia 20, então a projeção precisa levar esses dois recebimentos em conta.

No começo o único usuário é o João, mas o sistema já nasce multiusuário: amigos e clientes vão poder criar conta e conectar os próprios bancos sem enxergar os dados uns dos outros.

## Objetivos (v1)

1. **Início**: três números.
   - **Saldo hoje**: soma dos saldos das contas bancárias. Cartão de crédito não entra.
   - **Janela (decisão do João)**: os números de "a pagar" e "quanto posso gastar" olham de hoje **até o próximo recebimento previsto** (o próximo recorrente de entrada confirmado: salário ou vale), mesmo quando a janela passa da virada do mês.
   - **A pagar até o próximo recebimento**: faturas de cartão ainda não pagas com vencimento na janela, mais recorrentes confirmados de saída que vencem na janela e ainda não aconteceram.
     - Fatura que ainda não fechou mas vence no período entra pelo valor parcial, somando as compras do ciclo desde o último fechamento. Se a Pluggy não trouxer o fechamento, ele é inferido do histórico de faturas.
     - A fatura é considerada paga pelo status da Pluggy, quando houver, ou pelo casamento com o pagamento na conta corrente. Pagamento parcial abate o valor e o restante continua a pagar.
     *(decisão do designer)*
   - **Quanto posso gastar**: saldo hoje − a pagar até o próximo recebimento. O recebimento que fecha a janela não entra na soma. Também aparece dividido pelos dias até ele, por exemplo "R$ 85/dia até o vale".
   - Sem nenhum recorrente de entrada confirmado, a janela vai até o fim do mês e a tela avisa para confirmar o salário.
2. **Transações**: todas as contas e cartões juntos, com filtros por período, conta, categoria e tipo (entrada, saída ou transferência). O usuário pode trocar a categoria.
3. **Cartões**: fatura atual e próximas de cada cartão, com as parcelas futuras.
4. **Recorrentes**: o app detecta sozinho, no histórico, o que se repete (mesma descrição normalizada, valor parecido, intervalo mensal) e mostra como **sugerido**. O usuário **confirma** (pode ajustar valor e regra de dia) ou **descarta**. Também dá para cadastrar um recorrente à mão. A regra de dia pode ser "dia X do mês" ou "Nº dia útil" (o salário cai no 5º dia útil). Dia útil considera fins de semana e feriados nacionais. Na regra "dia X", cada recorrente diz o que acontece quando o dia cai em fim de semana ou feriado: antecipa, adia ou mantém. O padrão é antecipar *(decisão do designer)*.
5. **Holerites**:
   - Upload de PDF. O arquivo fica guardado no Cloudflare R2 e pode ser baixado depois.
   - O app extrai competência, bruto, proventos, descontos e líquido, e mostra numa tela de detalhe e num histórico mês a mês. A tela também diz se o líquido bate com a entrada que caiu na conta.
   - Pode haver mais de um holerite na mesma competência, com tipos diferentes: mensal, adiantamento/vale, 13º e férias. A conferência compara o líquido de cada holerite com a entrada correspondente (o holerite mensal com o salário, o de adiantamento com o vale). Se o vale aparecer só como desconto no holerite mensal, a conferência é só com o salário *(decisão do designer)*.
   - Ainda **não existe holerite de exemplo**, então na v1 não há leitor de layout. Todo upload fica com status "não reconhecido" e o usuário lança os itens à mão na mesma tela. O leitor do layout da empresa do João entra assim que houver um PDF de exemplo, e aí deve dar para reprocessar os holerites já enviados.
6. **Conexões**: ligar e desligar bancos via Pluggy (Meu Pluggy), ver o status de cada conexão e o horário da última sincronização, e disparar uma sincronização manual.
7. **Lançamento manual**: criar uma transação à mão (dinheiro em espécie ou algo que o Open Finance não pegou), numa conta manual "Carteira". *(decisão do designer: é a base da melhoria via WhatsApp)*
   - Saque detectado numa conta bancária vira transferência para a Carteira, que recebe a entrada automaticamente. Assim, o gasto em espécie lançado depois é o que conta como saída, e não o saque.
   - O saldo da Carteira entra em "Saldo hoje".
   *(decisão do designer)*
8. **Auth**: cadastro e login com e-mail e senha, JWT em cookie com sessão de refresh, no mesmo padrão do `controlPec`.

## Fora da v1 (não objetivos)

- Investimentos, metas, orçamento por categoria.
- Alertas por e-mail ou push, recuperação de senha por e-mail, login com Google.
- App mobile nativo.
- Cobrança, planos, organizações, convites, papéis.
- **Melhoria futura pedida pelo João**: lançar pelo WhatsApp com mensagens como "gastei 20 de gasolina" ou "recebi 20 de tal coisa", e a transação manual aparecer no app. Não entra na v1. Na hora de fazer, avaliar o custo da WhatsApp Cloud API (o João quer tudo gratuito) e a alternativa de um bot do Telegram. O texto pode ser interpretado por regras simples (verbo + valor + descrição), sem IA.

## Anti-objetivos (o que tornaria a entrega um fracasso mesmo funcionando)

- **Contar dinheiro duas vezes.** Duas regras evitam isso:
  - O pagamento de fatura na conta corrente é uma transferência e não entra como gasto. Os gastos são as compras do cartão.
  - Uma transferência entre contas do próprio usuário não é entrada nem saída. O par é detectado pelo mesmo valor com sinais opostos, em contas diferentes do mesmo usuário, em até 3 dias *(decisão do designer)*, e o usuário pode desfazer a marcação.
- **Na projeção, recorrente cobrado no cartão não conta separado**: ele já está na fatura. Só recorrentes de contas bancárias entram em "a pagar".
- **Vazar dados entre usuários.** Toda consulta filtra pelo usuário autenticado. Recurso de outro usuário responde 404.
- **Mostrar números errados de holerite com cara de certos.** Layout desconhecido vira "não reconhecido", nunca um chute.
- **Custo.** Nada pago na v1: Pluggy pelo caminho gratuito (Meu Pluggy), R2 dentro da camada grátis.

## Restrições e decisões do João

- **Tudo em TypeScript.** PostgreSQL. API em Node + Fastify. Web com Vite, React, Tailwind e shadcn/ui.
- **Seguir o padrão do `~/projects/controlPec`, sem a parte SaaS.** Copiar dele:
  - monorepo pnpm + Turborepo (`apps/api`, `apps/web`, `packages/*`, `config/*` com eslint, prettier e tsconfig compartilhados);
  - na API: Fastify 5, `fastify-type-provider-zod`, Zod 4, Prisma 7 com `@prisma/adapter-pg`, rotas por domínio em `src/http/routes/<domínio>/`, `error-handler.ts` central, Swagger, rate-limit, CORS, Vitest, tsup;
  - no web: React 19, Vite, Tailwind v4, shadcn/ui, React Router, TanStack Query, ky, react-hook-form + Zod, sonner, recharts;
  - `packages/env` com `@t3-oss/env-core`, `.env` na raiz carregado por `dotenv-cli` (`env:load`), Postgres no `docker-compose` preso em `127.0.0.1` com volume nomeado.
- **Deixar de fora do `controlPec`**: organizações, membros, convites, slug na URL, CASL, founder, billing/Asaas, desktop. Sem papéis, cada usuário é dono dos próprios dados.
- **Open Finance: Pluggy, pelo caminho gratuito (Meu Pluggy).** O João ainda não tem conta. Relatos de terceiros (não confirmados pela Pluggy) dizem que o Meu Pluggy segue grátis depois do teste e que cada usuário final precisa criar a própria conta no Meu Pluggy e conectar os bancos lá. **O primeiro passo do plano é confirmar na documentação oficial** como uma aplicação lê os dados do Meu Pluggy (provavelmente o conector MeuPluggy dentro do widget Pluggy Connect) e se existe limite de usuários. Se o caminho grátis não servir para amigos e clientes, abrir o app para eles vai exigir o plano pago (cerca de R$ 2.500/mês), e o resto do sistema não deve mudar por causa disso.
- **Todo acesso à Pluggy fica em um módulo da API** (cliente HTTP, autenticação com cache do token, mapeamento para o nosso modelo). O `clientSecret` nunca sai do servidor.
- **Sincronização**:
  - Em dev roda só na máquina do João: botão "Sincronizar" e sincronização automática quando ele abre o app, se a última tiver mais de algumas horas.
  - Em produção a API vai para o **Render** e passa a receber o **webhook** da Pluggy, ligado por variável de ambiente.
  - O webhook precisa ser autenticado: se a Pluggy não assinar, usar um segredo num header configurado ao criar o webhook (confirmar na documentação).
  - Sincronizar deve ser idempotente: upsert pelo id da Pluggy.
- **A v1 roda só na máquina do João.** O deploy (API no Render, banco de produção) fica para depois. O endpoint de webhook já é implementado, desligado por variável de ambiente. Na hora do deploy, ver três coisas:
  - um Postgres gratuito que não expire (o do Render free expira; o Neon é uma opção);
  - o cold start do Render free quando o webhook chegar;
  - a sincronização ao abrir o app como rede de segurança.
- **Web em produção**: na Vercel, como no `controlPec` *(palpite do designer, não confirmado)*.
- **Holerites**:
  - O upload passa pela API (multipart), não por URL assinada como no `controlPec`, porque a API precisa ler o PDF.
  - Aceitar só PDF, conferindo os bytes iniciais e não só a extensão, com limite de tamanho (sugestão: 5 MB).
  - Salvar em bucket R2 **privado**, reaproveitando o padrão `lib/storage.ts` e as variáveis `S3_*` do `controlPec`.
  - Download por URL assinada de curta duração, gerada depois de checar o dono.
  - Leitor próprio e gratuito, sem IA. O código fica isolado por layout para receber outros depois.
  - Guardar o hash do arquivo para avisar quando o mesmo PDF for enviado de novo.

## Modelo de domínio (esboço; os detalhes ficam com o builder)

- **User** e **Session** (refresh), como no `controlPec`.
- **Connection**: um item da Pluggy, pertence a um User. Guarda status, último sync e erro.
- **Account**: conta bancária, cartão de crédito ou conta manual ("Carteira"). Pertence a uma Connection, ou é manual.
- **Transaction**: valor, data, descrição, categoria, origem (Pluggy ou manual), parcela (n/total) quando houver, e marcação de transferência (com o par, se houver).
- **CardBill**: fatura do cartão, com vencimento, valor e status.
- **CategoryRule**: quando o usuário troca a categoria de um estabelecimento, as próximas transações dele seguem a mesma categoria *(decisão do designer)*. Ponto de partida: as categorias que a Pluggy devolve.
- **Recurrence**: entrada ou saída, conta, descrição, valor esperado, regra de dia, status (sugerido, confirmado ou descartado) e vínculo com as transações que a cumpriram em cada mês. A detecção nunca deve ressuscitar um recorrente que o usuário descartou.
- **Payslip** + **PayslipLine**:
  - Payslip: competência, bruto, líquido, status (reconhecido, não reconhecido ou manual), chave no R2, nome original e hash.
  - PayslipLine: provento ou desconto, descrição, referência e valor.

Valores em centavos inteiros *(decisão do designer)*. A conversão do valor decimal da Pluggy acontece num único lugar.

## Portas e nomes

- Escopo dos pacotes: `@myfinances/*`.
- API na 3333 e web na 5173, como no `controlPec`.
- Postgres na **5435**, para não colidir com o `controlPec` (5434) *(decisão do designer)*.

## Testes exigidos

Testes unitários com Vitest para:

- cálculo da projeção ("a pagar" e "quanto posso gastar"), incluindo a regra do recorrente no cartão;
- detecção de recorrentes e respeito aos descartados;
- detecção de transferências e pagamento de fatura;
- cálculo do Nº dia útil com feriados;
- isolamento entre usuários nas rotas: o usuário B recebe 404 nos recursos do usuário A;
- validação do upload: tipo e tamanho.

## Fica com o builder

- Desenho visual das telas, sempre com componentes shadcn.
- Biblioteca de extração de texto do PDF, quando o leitor for escrito.
- Fonte dos feriados nacionais (biblioteca ou tabela própria).
- Limiares da detecção de recorrentes (tolerância de valor, mínimo de ocorrências, janela de dias).
- Estrutura exata das tabelas, índices e nomes de rota.
- `render.yaml` e configuração de deploy, quando chegar a hora.
