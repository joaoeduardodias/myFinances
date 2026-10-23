# Lançamentos pelo WhatsApp — Design

Data: 2026-10-23

## Intenção

Quando o João gasta algo, a Pluggy só traz a transação em até 24h, e dinheiro vivo nunca chega. Ele quer registrar na hora, do celular, do jeito que falaria: manda "almoço 45 pix nubank" para um contato do WhatsApp e o lançamento já aparece no myFinances.

Ele quer mandar mesmo quando a Pluggy vai trazer depois, porque assim o "almoço" fica com o nome que ele deu. Quando a transação real chega, ela substitui a do WhatsApp e mantém a descrição que ele escreveu. Nunca pode ficar contado duas vezes.

## Objetivos

1. Receber mensagens de texto e fotos de comprovante enviadas ao número do bot pela **WhatsApp Cloud API oficial da Meta** (decisão do João: é gratuita para mensagens iniciadas pelo usuário). O bot usa um número próprio, separado do WhatsApp pessoal.
2. Entender **texto livre** com o **Google Gemini na camada gratuita** (decisão do João; ele aceita que a camada grátis pode usar o conteúdo para treino). Para o Gemini vão só a mensagem ou a foto, a data de hoje, os nomes e tipos das contas e cartões e a lista de categorias. Saldos e histórico não vão.
3. Salvar o lançamento **na hora**, sem pedir confirmação, e responder com um resumo e a opção de **desfazer** (decisão do João).
4. Lançar em **conta corrente, cartão de crédito ou Carteira** (decisão do João: cartão entra).
5. Quando a Pluggy trouxer a mesma transação, **ficar um só**: a transação da Pluggy fica com a descrição do João (e com a categoria, se veio pelo WhatsApp), e o lançamento manual some (decisão do João).

## Fora do escopo

- Áudio (o João não usa).
- Editar um lançamento pelo WhatsApp. Só é possível desfazer e mandar de novo.
- Notificações do sistema para o WhatsApp (avisos de fatura, resumo do dia). O bot só responde.
- Telegram.

## Anti-objetivos (falhou mesmo funcionando se…)

- O mesmo gasto aparece duas vezes no fluxo do mês ou em "Quanto posso gastar" depois que a Pluggy sincroniza.
- O sync da Pluggy apaga a descrição que o João escreveu.
- Alguém que não é o João consegue criar lançamentos mandando mensagem para o número.
- Uma mensagem que não deu pra entender vira um lançamento com valor ou conta errados sem aviso.

## Como funciona

### Entrada

- Rota `GET` de verificação do webhook (handshake `hub.mode`/`hub.verify_token`/`hub.challenge`) e rota `POST` que recebe os eventos.
- O `POST` confere `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com o App Secret, comparado em tempo constante), responde 200 logo e processa fora do ciclo da resposta, no mesmo modelo de `processPluggyEvent` (nunca rejeita, loga o erro).
- Sem as variáveis de ambiente do WhatsApp, as rotas nem existem, como `registerPluggyWebhook` faz com `PLUGGY_WEBHOOK_SECRET`. Variáveis novas em `packages/env`: token de acesso, App Secret, verify token, id do número do bot e chave do Gemini.
- A Meta reenvia eventos, então o processamento é idempotente pelo id da mensagem (`wamid`). Uma mensagem já processada é ignorada.
- Eventos que não são mensagens (status de entrega, leitura) são ignorados.

### Quem pode mandar

- **Minha decisão:** o `User` ganha um campo de telefone do WhatsApp, único e opcional. A mensagem só é aceita se o remetente bater com um usuário. Qualquer outro número é ignorado em silêncio, sem resposta, para não confirmar que o bot existe. Por enquanto o campo é preenchido direto no banco ou por script; uma tela de configurações fica para quando houver outros usuários. Escolhi o campo no usuário em vez de uma variável de ambiente porque o design geral nasce multiusuário.

### Interpretação (Gemini)

- Uma chamada por mensagem, com saída estruturada (JSON schema): `description`, `amountCents` (positivo), `direction` (débito/crédito), `accountId` (um dos ids enviados, ou nulo), `date` (AAAA-MM-DD), `category` (uma de `CATEGORIES`, ou nula) e `understood` + `missing` para quando não deu.
- A saída do Gemini é **validada com zod** antes de qualquer gravação. `accountId` precisa ser de uma conta do usuário, a data não pode ser futura nem mais antiga que, digamos, 60 dias (minha decisão), e o valor tem que ser maior que zero.
- Regras passadas no prompt (minhas decisões): "crédito"/"cartão" → cartão de crédito; "pix"/"débito"/"transferência" → conta corrente; "dinheiro"/"espécie" → Carteira; sem sinal de entrada ("recebi", "+", "entrou") → débito; "ontem" e datas relativas resolvidos a partir de hoje no fuso do usuário (mesma noção de "hoje" de `lib/today.ts`).
- Foto: a imagem é baixada pela Graph API (URL temporária com o token) e mandada ao Gemini junto com a legenda, se houver. A imagem não é guardada.
- Se o Gemini falhar ou estourar o limite gratuito, nada é salvo e o bot responde que não conseguiu agora e que é pra tentar de novo.

### Gravação

- O lançamento é um `Transaction` com `source: 'MANUAL'` na conta escolhida, `status: 'POSTED'`, `descriptionKey` calculada como hoje. Com categoria, `categoryLocked: true`, como faz `createManualTransaction`.
- É preciso marcar que veio do WhatsApp, para o "desfazer" e para a substituição só agirem sobre esses. O formato é do builder (por exemplo, guardar o `wamid` na transação, o que também serve de chave de idempotência).
- **Saldo:** só a Carteira tem o saldo recalculado (`recomputeWalletBalance`). Em conta corrente e cartão o saldo continua vindo da Pluggy. Isso quer dizer que um Pix lançado pelo WhatsApp não baixa o saldo do banco até a Pluggy atualizar. É aceito.
- **Bug a corrigir no caminho:** `delete-manual-transaction.ts` chama `recomputeWalletBalance(tx.accountId)` sem olhar o tipo da conta. Com manuais fora da Carteira, apagar um deles sobrescreveria o saldo do banco com a soma das transações. Só recalcular quando a conta for a Carteira (vale também para o "desfazer").
- Na tela, os lançamentos aparecem como os manuais de hoje, na conta ou no cartão certos, e entram no fluxo do mês, nas listas e em "Quanto posso gastar" como qualquer transação daquela conta. Compra no cartão lançada pelo WhatsApp entra na fatura em aberto até ser substituída.

### Conta ambígua: o bot pergunta (decisão do João)

- Quando o Gemini não consegue apontar uma única conta, o bot não salva nem chuta. Isso vale para nenhuma conta citada ("almoço 45 pix"), banco com mais de uma conta do tipo ("nubank" com corrente e poupança) ou dois cartões do mesmo banco. O Gemini devolve a lista de candidatos em vez de um `accountId`.
- O bot pergunta qual foi, com opções numeradas: as contas candidatas (ou todas as do tipo indicado) e sempre **"Dinheiro (Carteira)"** por último. Exemplo: `Almoço · R$ 45,00 — de qual conta? 1) Nubank corrente 2) Itaú corrente 3) Dinheiro (Carteira)`. Usar mensagem interativa de lista ou botões da Cloud API, ou texto com números, fica a critério do builder. A resposta pode ser o número ou o nome.
- Isso exige guardar um rascunho pendente por usuário (dados já interpretados + candidatos). Minhas decisões: um pendente por vez; expira em 30 minutos; se a próxima mensagem não for uma resposta válida, o pendente é descartado e a mensagem é tratada como um lançamento novo. Com a resposta, segue o fluxo normal de gravação (incluindo o casamento com uma transação da Pluggy já existente).

### Resposta

- Sucesso: `✅ Almoço · R$ 45,00 · débito · Nubank · hoje · Alimentação` + `Responda *desfazer* para apagar.` (texto exato a critério do builder).
- Não entendido (sem valor, foto sem comprovante legível; conta citada que não existe cai na pergunta de conta ambígua): não salva e diz o que faltou, por exemplo `Não achei o valor. Tenta assim: almoço 45 pix nubank`.
- **Desfazer** (minha decisão): a palavra "desfazer" (ou "apaga") apaga o último lançamento do usuário criado pelo WhatsApp, se ele ainda existir como manual. Se já foi substituído pela Pluggy, responde que já foi conciliado e não apaga nada. Responder (reply) a uma mensagem específica do bot com "desfazer" apaga aquele lançamento, se for simples de pegar pelo `context.id` da mensagem. Senão, fica só o último.
- Respostas usam mensagem de texto livre. Isso vale dentro da janela de 24h que a mensagem do usuário abre, então não precisa de template.

### Substituição pela Pluggy

- Quando o sync **cria** uma transação da Pluggy (não quando atualiza uma que já existe), ele procura um lançamento do WhatsApp do mesmo usuário com a **mesma conta**, o **mesmo `amountCents`** e **data a até 3 dias** da transação da Pluggy, ainda não usado (minha decisão nos números).
- Se acha mais de um, fica com o de data mais próxima e, no empate, o mais antigo. Cada manual casa com no máximo uma transação da Pluggy.
- Ao casar: a transação da Pluggy recebe a descrição do manual, que passa a ficar **travada contra o sync** (hoje `sync-connection.ts` sobrescreve `description` em todo upsert; precisa de uma trava no mesmo espírito de `categoryLocked`, e `descriptionKey` segue a descrição travada para regras e recorrências continuarem coerentes). A categoria do manual também vai se estava travada. Depois disso o manual é apagado. Tudo numa transação de banco.
- Compras parceladas no cartão: só a parcela cujo valor bater casa. O João lança o valor da parcela, ou aceita que um valor total não case (minha decisão; não vale a complexidade agora).
- **Nos dois sentidos (minha decisão):** se a mensagem chega depois de a Pluggy já ter trazido a transação, a gravação do WhatsApp procura antes uma transação da Pluggy com o mesmo critério (mesma conta, mesmo valor, até 3 dias, descrição ainda não travada) e casa na hora. Nesse caso não cria manual, só trava a descrição (e a categoria) na transação da Pluggy. O bot responde que ela já estava lá e foi renomeada, e o "desfazer" devolve a descrição anterior. Para não correr junto com o sync, a gravação do WhatsApp entra na mesma fila por usuário do sync (`runExclusive`, que precisa sair de dentro de `sync-connection.ts` para um lugar compartilhado).
- **Pendente que vira lançada (minha decisão):** casa também com pendente. Se uma transação da Pluggy com descrição travada some (em `removeTransactions`), ela volta a ser um lançamento manual do WhatsApp com a mesma conta, valor, data, descrição e categoria, em vez de sumir. Como a remoção roda antes dos upserts no mesmo sync, a lançada que a substituiu casa com esse manual logo em seguida e herda a descrição. Isso nunca conta duas vezes e não perde a descrição.
- **Pareamento e recorrentes (minha decisão):** lançamentos do WhatsApp ainda não substituídos ficam fora de `detect-transfers` e da detecção de recorrentes, coerente com a regra de pareamento automático só entre transações de banco e cartão vindas da Pluggy.
- Se a Pluggy nunca trouxer (dinheiro vivo na Carteira, ou a transação não veio), o manual continua.
- Lançamentos manuais feitos pela tela (Carteira) não entram na substituição; só os do WhatsApp.

## Restrições

- Fastify + Prisma + zod, no padrão das rotas atuais. Migration com `db:migrate --name`.
- Sem SQL cru (regra do Biome).
- O processamento de mensagens não pode competir com o sync de forma que crie duplicata: a substituição acontece dentro do sync, que já é serializado por usuário.
- Testes: unidade para o parse e validação da saída do Gemini (com o Gemini mockado), para a pergunta de conta ambígua e a resposta a ela, para a escolha do par na substituição e para a verificação de assinatura; integração cobrindo "manual do WhatsApp + sync da Pluggy = uma transação só, com a descrição do João".
- CLAUDE.md: registrar as decisões de produto novas em uma linha cada (substituição mantém a descrição do João; só o número cadastrado é aceito; Gemini grátis aceito pelo João).

## A cargo do builder

- SDK do Gemini (`@google/genai`) ou `fetch` direto; o modelo Flash da camada gratuita mais recente.
- Formato exato do prompt e das respostas.
- Onde guardar a marca de origem WhatsApp e o `wamid`.
- Um script `pnpm --filter @myfinances/api whatsapp:...` para ajudar a configurar o webhook na Meta é opcional; o painel da Meta resolve.
