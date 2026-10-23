# Lançamentos pelo WhatsApp — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O João manda "almoço 45 pix nubank" (ou a foto de um comprovante) para o número do bot no WhatsApp. O lançamento é salvo na hora e, quando a Pluggy traz a mesma transação, fica um só, com a descrição dele.

**Architecture:** Um webhook da WhatsApp Cloud API (assinatura HMAC conferida) entrega a mensagem a um orquestrador. Ele identifica o usuário pelo telefone, interpreta a mensagem com o Gemini (saída JSON validada com zod) e grava pela fila por usuário que o sync já usa. A gravação casa com uma transação da Pluggy já existente ou cria um `MANUAL` marcado com o `wamid`. O sync faz o casamento inverso ao criar transações, e `removeTransactions` devolve a transação ao estado de manual quando uma pendente com descrição travada some. O estado da conversa (pergunta de conta pendente, último lançamento) fica em memória, como a fila do sync: uma instância só.

**Tech Stack:** Fastify 5, Prisma 7, zod 4, vitest 2, `fetch` nativo para a Graph API da Meta e para a API REST do Gemini (sem SDK novo).

**Spec:** `docs/superpowers/specs/2026-10-23-whatsapp-lancamentos-design.md`

## Global Constraints

- Todo comando da API: `pnpm --filter @myfinances/api <script>`; migration sempre com `db:migrate --name <nome>`.
- Sem SQL cru (regra do Biome `no-raw-sql.grit`). A API fica fora do formatador; rode `pnpm --filter @myfinances/api lint`.
- Janela de casamento: mesma conta, mesmo `amountCents`, data a até **3** dias. Empate: data mais próxima, depois a mais antiga (`createdAt`).
- A data interpretada não pode ser futura nem ter mais de **60** dias antes de hoje (fuso `env.TIMEZONE`, `todayIso`).
- A pergunta de conta pendente expira em **30** minutos; uma por usuário.
- Débito é negativo em qualquer tipo de conta (mesma convenção de `toCents`).
- Só a Carteira tem o saldo recalculado (`recomputeWalletBalance`); conta de banco e cartão, nunca.
- Remetente sem usuário cadastrado: ignorado, **sem resposta**.
- Sem todas as variáveis `WHATSAPP_*` e `GEMINI_API_KEY`, as rotas do webhook não existem (404).
- Para o Gemini vão só: a mensagem ou a imagem, a data de hoje, `{id, name, type}` das contas e a lista `CATEGORIES`. Saldos e histórico não vão.
- Mensagens do bot em português, texto livre (dentro da janela de 24h, sem template).

## Review Focus

1. **Mesma mensagem entregue duas vezes pela Meta** → um lançamento só. Teste na Task 6 (`P2002` em `whatsappMessageId` vira `duplicate` e não responde de novo).
2. **Dois gastos iguais no mesmo dia** (dois cafés de R$ 8 no Nubank) → cada manual casa com uma transação da Pluggy diferente, nunca os dois com a mesma. Teste na Task 3.
3. **Sync rodando enquanto a mensagem chega** → a gravação espera na fila do usuário. Teste na Task 6 (gravação e `syncConnection` usam `runExclusive` do mesmo módulo).
4. **Resposta "2" sem pergunta pendente, ou depois de 30 min** → tratada como mensagem nova, não grava em conta aleatória. Teste na Task 7.
5. **Gemini devolve `accountId` de outra pessoa, valor zero/negativo ou data absurda** → nada é salvo e o bot diz o que faltou. Teste na Task 5.

---

### Task 1: Schema, fila compartilhada e correção do saldo ao apagar manual

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`User`, `Transaction`)
- Create: migration `whatsapp_entries` (gerada)
- Create: `apps/api/src/services/user-queue.ts`
- Modify: `apps/api/src/services/sync-connection.ts:52-66` (remover `userQueues`/`runExclusive`, importar de `./user-queue`)
- Modify: `apps/api/src/http/routes/transactions/delete-manual-transaction.ts`
- Test: `apps/api/src/services/user-queue.test.ts`, `apps/api/src/http/routes/transactions/transactions.test.ts`

**Interfaces:**
- Produces:
  - `User.whatsappPhone String? @unique @map("whatsapp_phone")`: só dígitos, como a Meta manda em `from` (ex.: `5511999999999`).
  - `Transaction.descriptionLocked Boolean @default(false) @map("description_locked")`: o sync não sobrescreve `description`/`descriptionKey`.
  - `Transaction.whatsappMessageId String? @unique @map("whatsapp_message_id")`: o `wamid` que criou ou renomeou a transação. Em `MANUAL` marca "lançamento do WhatsApp esperando a Pluggy".
  - `Transaction.originalDescription String? @map("original_description")`: descrição da Pluggy antes de um renomear feito na hora da mensagem (para o "desfazer").
  - `runExclusive(userId: string, task: () => Promise<T>): Promise<T>` em `services/user-queue.ts` (genérico; o corpo é o atual, movido).

- [ ] **Step 1: Escrever os testes que falham**
  - `user-queue.test.ts`: `it('serializa tarefas do mesmo usuário')`: duas tarefas do mesmo usuário, a primeira resolve depois de um `await` controlado; a ordem de início registrada é `['a-start','a-end','b-start']`. `it('não trava a fila quando uma tarefa rejeita')`: a primeira rejeita e a segunda ainda roda e devolve o valor.
  - `transactions.test.ts`: `it('apagar manual em conta de banco não recalcula saldo')`: `transaction.findFirst` devolve `{ source: 'MANUAL', accountId, account: { type: 'BANK' } }` → `expect(prisma.transaction.aggregate).not.toHaveBeenCalled()`; o caso Carteira continua recalculando.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @myfinances/api test user-queue transactions` → FAIL (módulo inexistente / aggregate chamado).
- [ ] **Step 3: Implementar.** Campos no schema, `pnpm --filter @myfinances/api db:migrate --name whatsapp_entries`. Mover a fila para `user-queue.ts` (manter o comentário sobre instância única) e importar no sync. Em `delete-manual-transaction.ts`, selecionar `account: { select: { type: true } }` e só chamar `recomputeWalletBalance` quando `type === 'WALLET'`.
- [ ] **Step 4: Rodar** — `pnpm --filter @myfinances/api test` → PASS (inclui `sync-connection.test.ts` intacto).
- [ ] **Step 5: Commit** — `git commit -m "feat(api): campos do WhatsApp e fila por usuário compartilhada"`

### Task 2: Escolha do par (função pura)

**Files:**
- Create: `apps/api/src/lib/finance/match-entry.ts`
- Test: `apps/api/src/lib/finance/match-entry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MATCH_WINDOW_DAYS = 3
  export type MatchCandidate = { id: string; accountId: string; amountCents: number; date: IsoDate; createdAt: Date }
  /** O candidato que é a mesma transação que `target`, ou null. */
  export function pickEntryMatch(
    target: { accountId: string; amountCents: number; date: IsoDate },
    candidates: MatchCandidate[],
  ): string | null
  ```

- [ ] **Step 1: Testes que falham** (`describe('pickEntryMatch')`):
  - mesma conta, valor e data → id;
  - conta diferente → null; valor diferente (−4500 vs −4501) → null;
  - 3 dias de diferença → casa; 4 → null (antes e depois);
  - dois candidatos, a 2 e a 1 dia → o de 1 dia;
  - mesma distância → o de `createdAt` mais antigo.
- [ ] **Step 2: Rodar** — `pnpm --filter @myfinances/api test match-entry` → FAIL.
- [ ] **Step 3: Implementar** usando `addDays`/comparação de `IsoDate` (`lib/finance/business-days`) para a distância em dias.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(api): escolha do par entre lançamento e transação`

### Task 3: Sync — substituição, descrição travada e exclusões

**Files:**
- Modify: `apps/api/src/services/sync-connection.ts` (`syncTransactions`, `pairTransfers`)
- Modify: `apps/api/src/services/detect-and-store-recurrences.ts`
- Test: `apps/api/src/services/sync-connection.test.ts`, `apps/api/src/services/detect-and-store-recurrences.test.ts`

**Interfaces:**
- Consumes: `pickEntryMatch`, `MatchCandidate` (Task 2); campos da Task 1.

Regras:
- Em `syncTransactions`, por conta, carregar uma vez os manuais do WhatsApp (`source: 'MANUAL', whatsappMessageId: { not: null }, accountId`). Para cada `tx` remota **sem** `current` (vai ser criada), `pickEntryMatch` entre os manuais ainda não usados neste sync. Com par: numa `prisma.$transaction`, apagar o manual e criar a transação da Pluggy com `description`, `descriptionKey` e `whatsappMessageId` do manual, `descriptionLocked: true` e, se `categoryLocked` no manual, `category` + `categoryLocked: true`. Remover o manual da lista de disponíveis.
- No `update` do upsert: se `current.descriptionLocked`, não enviar `description` nem `descriptionKey` (selecionar `descriptionLocked` no `existing`).
- `pairTransfers` e `detectAndStoreRecurrences`: excluir `{ source: 'MANUAL', whatsappMessageId: { not: null } }` do `where` (`NOT: { ... }`).

- [ ] **Step 1: Testes que falham** em `sync-connection.test.ts`:
  - `it('transação nova casa com lançamento do WhatsApp e herda a descrição')`: manual `{ amountCents: -4500, date: TODAY, description: 'Almoço', whatsappMessageId: 'wamid.1' }`, remota "PIX ENVIADO RESTAURANTE X" −45,00 → `transaction.delete` do manual e criação com `description: 'Almoço', descriptionLocked: true, whatsappMessageId: 'wamid.1'`.
  - `it('dois lançamentos iguais casam com duas transações diferentes')`: 2 manuais −800 e 2 remotas −8,00 → dois deletes de ids distintos.
  - `it('não sobrescreve descrição travada')`: `existing` com `descriptionLocked: true` → `update` sem `description`.
  - `it('manual do WhatsApp fica fora do pareamento')`: o `findMany` de `pairTransfers` recebe o `NOT` acima.
  - Em `detect-and-store-recurrences.test.ts`: o `where` contém o mesmo `NOT`.
- [ ] **Step 2: Rodar** — `pnpm --filter @myfinances/api test sync-connection detect-and-store` → FAIL.
- [ ] **Step 3: Implementar** as regras acima.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(api): sync substitui lançamento do WhatsApp mantendo a descrição`

### Task 4: Pendente que some volta a ser lançamento

**Files:**
- Modify: `apps/api/src/services/remove-transactions.ts`
- Test: `apps/api/src/services/remove-transactions.test.ts` (criar)

Regra: entre as linhas removidas, as que têm `source: 'PLUGGY'`, `descriptionLocked: true` e `whatsappMessageId` voltam como `MANUAL` com `userId`, `accountId`, `date`, `description`, `descriptionKey`, `amountCents`, `category`, `categoryLocked`, `whatsappMessageId` e `status: 'POSTED'`. Isso acontece na mesma `$transaction`, depois do `deleteMany`, por causa do `@unique`. Como a remoção roda antes dos upserts no sync, a lançada que substitui a pendente casa com esse manual pela Task 3. Em `delete-connection` as contas são apagadas logo depois, em cascata, e levam os manuais junto: aceito.

- [ ] **Step 1: Teste que falha** — `it('pendente renomeada pelo WhatsApp volta como manual ao sumir')`: `findMany` devolve uma linha com esses campos → `transaction.create` com `source: 'MANUAL', whatsappMessageId: 'wamid.1', description: 'Almoço'`; linha sem `descriptionLocked` → nenhum `create`.
- [ ] **Step 2: Rodar** — `pnpm --filter @myfinances/api test remove-transactions` → FAIL.
- [ ] **Step 3: Implementar** (ampliar o `select` com os campos acima).
- [ ] **Step 4: Rodar** → PASS, e `pnpm --filter @myfinances/api test` inteiro → PASS.
- [ ] **Step 5: Commit** — `feat(api): transação renomeada que some volta a ser lançamento`

### Task 5: Interpretação com o Gemini

**Files:**
- Create: `apps/api/src/lib/gemini/interpret-entry.ts`
- Modify: `packages/env/index.ts` (`GEMINI_API_KEY: z.string().optional()`), `apps/api/src/test/setup.ts`
- Test: `apps/api/src/lib/gemini/interpret-entry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EntryAccount = { id: string; name: string; type: 'BANK' | 'CREDIT' | 'WALLET' }
  export type EntryDraft = { description: string; amountCents: number; date: IsoDate; category: Category | null }
  export type Interpretation =
    | { kind: 'entry'; draft: EntryDraft; accountId: string }
    | { kind: 'ask_account'; draft: EntryDraft; candidateAccountIds: string[] }
    | { kind: 'not_understood'; reply: string }
  export class GeminiUnavailableError extends Error {}
  export async function interpretEntry(
    input: { text?: string; image?: { data: Buffer; mimeType: string }; accounts: EntryAccount[]; today: IsoDate },
    deps?: { fetch?: typeof fetch; apiKey?: string },
  ): Promise<Interpretation>
  ```

Chamada: `POST https://generativelanguage.googleapis.com/v1beta/models/<modelo>:generateContent`, header `x-goog-api-key`, `generationConfig.responseMimeType: 'application/json'` e `responseJsonSchema`. O modelo é uma constante `GEMINI_MODEL` com o Flash gratuito mais recente (confira na doc no momento da implementação). Imagem vai como `inline_data` base64. A resposta bruta (`understood`, `missing`, `description`, `amount` em reais, `direction: 'debit'|'credit'`, `accountId`, `candidateAccountIds`, `date`, `category`) passa por um schema zod. As regras de prompt da spec vão nas instruções de sistema ("crédito"/"cartão" → CREDIT; "pix"/"débito"/"transferência" → BANK; "dinheiro"/"espécie" → WALLET; sem sinal de entrada → débito; datas relativas a `today`; nunca chutar a conta: na dúvida, `accountId: null` e os candidatos).

Validação depois do zod (cada falha vira `not_understood` com um `reply` que diz o que faltou):
- `amount > 0`, senão `"Não achei o valor. Tenta assim: almoço 45 pix nubank"`;
- `date` entre `today − 60` e `today`;
- `accountId` precisa estar em `accounts`; candidatos fora de `accounts` são descartados;
- `accountId` válido → `entry`; senão `ask_account` com os candidatos restantes ou, se vazio, todas as contas `BANK` e `CREDIT`;
- `amountCents` = ±centavos (débito negativo).
- HTTP 429/5xx, rede ou JSON inválido do Gemini → lança `GeminiUnavailableError`.

- [ ] **Step 1: Testes que falham** (com `fetch` mockado devolvendo o JSON do Gemini):
  - `'almoço 45 pix nubank'` → `{ kind: 'entry', accountId: 'nubank-cc', draft: { amountCents: -4500, description: 'Almoço', date: TODAY } }`;
  - crédito (`direction: 'credit'`, 200) → `amountCents: 20000`;
  - `accountId` que não está na lista → `ask_account` (Review Focus 5);
  - `amount: 0` → `not_understood` com "valor"; data futura → `not_understood`; data de 61 dias atrás → `not_understood`;
  - `accountId: null`, candidatos `[]` → `ask_account` com os ids BANK+CREDIT, sem a Carteira;
  - o corpo enviado não contém `balanceCents` e inclui `CATEGORIES`;
  - `fetch` 429 → rejeita com `GeminiUnavailableError`.
- [ ] **Step 2: Rodar** — `pnpm --filter @myfinances/api test interpret-entry` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(api): interpretação de lançamento com o Gemini`

### Task 6: Gravar e desfazer

**Files:**
- Create: `apps/api/src/services/whatsapp/save-entry.ts`
- Test: `apps/api/src/services/whatsapp/save-entry.test.ts`

**Interfaces:**
- Consumes: `runExclusive` (Task 1), `pickEntryMatch` (Task 2), `EntryDraft` (Task 5).
- Produces:
  ```ts
  export type SaveResult =
    | { kind: 'created' | 'renamed'; accountName: string; accountType: AccountType }
    | { kind: 'duplicate' }
  export function saveWhatsappEntry(
    userId: string,
    input: { draft: EntryDraft; accountId: string; messageId: string },
  ): Promise<SaveResult>
  export type UndoResult = { kind: 'deleted' | 'restored' | 'already_reconciled' | 'nothing' }
  export function undoWhatsappEntry(userId: string, messageId: string | undefined): Promise<UndoResult>
  ```

Regras de `saveWhatsappEntry` (tudo dentro de `runExclusive(userId, …)`):
- A conta precisa ser do usuário (`findFirst({ where: { id, userId } })`).
- Procura entre as `PLUGGY` da conta com `descriptionLocked: false`, mesmo `amountCents` e data na janela; `pickEntryMatch`. Com par → `update` com `originalDescription` = descrição atual, a nova `description`/`descriptionKey`, `descriptionLocked: true`, `whatsappMessageId` e, se houver, `category` + `categoryLocked: true` → `renamed`.
- Sem par → `create` `MANUAL`/`POSTED` com `whatsappMessageId` (categoria como em `createManualTransaction`); se a conta for `WALLET`, `recomputeWalletBalance` → `created`.
- `P2002` em `whatsappMessageId` → `duplicate`.

Regras de `undoWhatsappEntry` (busca por `whatsappMessageId` e `userId`):
- `MANUAL` → apaga (recalcula só se Carteira) → `deleted`;
- `PLUGGY` com `originalDescription` → volta `description`/`descriptionKey`, `descriptionLocked: false`, `whatsappMessageId: null`, `originalDescription: null` → `restored`;
- `PLUGGY` sem `originalDescription` (substituída pelo sync) → `already_reconciled`;
- `messageId` indefinido ou nada achado → `nothing`.

- [ ] **Step 1: Testes que falham:** um para cada ramo acima, mais `it('espera o sync do mesmo usuário')`, que mocka `./user-queue` e verifica que `runExclusive` foi chamado com `userId` (Review Focus 3), e `it('mesma mensagem duas vezes')`, em que `create` rejeita com `{ code: 'P2002' }` → `duplicate` (Review Focus 1). Também: conta de outro usuário → rejeita.
- [ ] **Step 2: Rodar** — `pnpm --filter @myfinances/api test save-entry` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(api): gravar e desfazer lançamento do WhatsApp`

### Task 7: Conversa — estado, respostas e orquestração

**Files:**
- Create: `apps/api/src/services/whatsapp/conversation.ts` (estado em memória)
- Create: `apps/api/src/services/whatsapp/replies.ts` (textos)
- Create: `apps/api/src/services/whatsapp/handle-message.ts`
- Test: `conversation.test.ts`, `replies.test.ts`, `handle-message.test.ts` na mesma pasta

**Interfaces:**
- Consumes: `interpretEntry`, `GeminiUnavailableError`, `EntryAccount`, `EntryDraft` (Task 5); `saveWhatsappEntry`, `undoWhatsappEntry` (Task 6); `ensureWalletAccount`.
- Produces:
  ```ts
  // conversation.ts
  export const PENDING_TTL_MS = 30 * 60 * 1000
  export type AccountOption = { accountId: string; label: string }
  export type PendingEntry = { draft: EntryDraft; options: AccountOption[]; messageId: string; at: Date }
  export function setPending(userId: string, pending: PendingEntry): void
  export function takePending(userId: string, now?: Date): PendingEntry | undefined // remove sempre; expirado → undefined
  export function resolveAccountAnswer(text: string, options: AccountOption[]): string | null // "2", "nubank", "dinheiro"
  export function rememberLastEntry(userId: string, messageId: string): void
  export function lastEntry(userId: string): string | undefined
  export function isUndo(text: string): boolean // "desfazer" | "apaga" | "apagar", sem acento/caixa
  // replies.ts
  export function savedReply(r: { description: string; amountCents: number; accountName: string; date: IsoDate; category: string | null }, today: IsoDate): string
  export function renamedReply(...mesmos campos): string
  export function askAccountReply(draft: EntryDraft, options: AccountOption[]): string
  export function undoReply(r: UndoResult): string
  // handle-message.ts
  export type IncomingMessage = { id: string; from: string; text?: string; imageId?: string; unsupported?: true }
  export type WhatsappSender = { sendText(to: string, body: string): Promise<void>; downloadMedia(id: string): Promise<{ data: Buffer; mimeType: string }> }
  export function handleWhatsappMessage(msg: IncomingMessage, deps: { client: WhatsappSender; interpret?: typeof interpretEntry; today?: IsoDate; now?: Date }): Promise<void>
  ```

Textos fixos (`replies.ts`):
- salvo: `✅ Almoço · R$ 45,00 · débito · Conta Corrente Nubank · hoje · Alimentação\nResponda *desfazer* para apagar.` (data: `hoje`, `ontem` ou `dd/mm`; categoria omitida se nula; "crédito" para entrada);
- renomeado: `✅ Essa já tinha chegado do banco: agora se chama Almoço · R$ 45,00 · Conta Corrente Nubank · 22/10\nResponda *desfazer* para voltar o nome.`;
- pergunta: `Almoço · R$ 45,00 — de qual conta?\n1) Conta Corrente Nubank\n2) Conta Corrente Itaú\n3) Dinheiro (Carteira)`. A Carteira é sempre a última opção, com o rótulo `Dinheiro (Carteira)`;
- desfazer: `deleted` → `🗑️ Apagado.`; `restored` → `↩️ Voltei o nome que veio do banco.`; `already_reconciled` → `Esse já foi conciliado com o banco; apague pelo app se precisar.`; `nothing` → `Não achei nada recente para desfazer.`;
- tipo não suportado: `Por enquanto só entendo texto e foto de comprovante.`;
- Gemini fora: `Não consegui entender agora, tenta de novo em instantes.`

Fluxo de `handleWhatsappMessage`:
1. `user.findUnique({ where: { whatsappPhone: msg.from } })`; sem usuário → retorna sem enviar nada.
2. `unsupported` → resposta de tipo não suportado.
3. texto com `isUndo` → `undoWhatsappEntry(userId, lastEntry(userId))` → `undoReply`.
4. `takePending`; se existir e o texto tiver resposta (`resolveAccountAnswer`), `saveWhatsappEntry` com `pending.draft` e `pending.messageId`; senão o pendente é descartado e o fluxo segue com a mensagem como nova.
5. Contas do usuário (`BANK`, `CREDIT` e a Carteira via `ensureWalletAccount`) → `interpretEntry` (imagem via `client.downloadMedia`).
6. `entry` → salvar; `ask_account` → `setPending` + pergunta; `not_understood` → `reply`.
7. Depois de salvar: `created`/`renamed` → `rememberLastEntry` + resposta; `duplicate` → não envia nada.
8. `GeminiUnavailableError` → resposta de Gemini fora; outros erros sobem (o webhook loga).

- [ ] **Step 1: Testes que falham:**
  - `conversation.test.ts`: `takePending` depois de 30 min → `undefined`; `resolveAccountAnswer('2', opts)` → 2ª; `('dinheiro', opts)` → Carteira; `('nubank', opts)` com um único Nubank → ele; `('7', opts)` → `null`; `isUndo('Desfazer')` → true.
  - `replies.test.ts`: os textos acima, exatamente.
  - `handle-message.test.ts` (Prisma, `interpret`, `save-entry` e `client` mockados): número desconhecido → `sendText` não chamado; "2" com pendente → salva na 2ª conta com o `messageId` original; "2" sem pendente (Review Focus 4) → vai para `interpret` como mensagem nova; pendente expirado → idem; `ask_account` → `setPending` + pergunta com a Carteira por último; `duplicate` → nada enviado; `GeminiUnavailableError` → texto de Gemini fora; imagem → `downloadMedia` + `interpret` com `image`.
- [ ] **Step 2: Rodar** — `pnpm --filter @myfinances/api test services/whatsapp` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(api): conversa do WhatsApp para lançamentos`

### Task 8: Webhook da Meta, cliente da Graph API e ligação

**Files:**
- Create: `apps/api/src/lib/whatsapp/client.ts`
- Create: `apps/api/src/http/routes/webhooks/whatsapp-webhook.ts`
- Create: `apps/api/src/scripts/link-whatsapp.ts` + script `"whatsapp:link"` no `package.json`
- Modify: `packages/env/index.ts`, `apps/api/src/test/setup.ts`, `apps/api/src/http/server.ts`
- Test: `apps/api/src/http/routes/webhooks/whatsapp-webhook.test.ts`, `apps/api/src/lib/whatsapp/client.test.ts`

**Interfaces:**
- Consumes: `handleWhatsappMessage`, `IncomingMessage`, `WhatsappSender` (Task 7).
- Produces:
  ```ts
  // env (todas opcionais): WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_PHONE_NUMBER_ID, GEMINI_API_KEY (Task 5)
  export function createWhatsappClient(cfg: { accessToken: string; phoneNumberId: string; fetch?: typeof fetch }): WhatsappSender
  export function verifyMetaSignature(rawBody: Buffer, header: unknown, appSecret: string): boolean
  export function extractMessages(payload: unknown, phoneNumberId: string): IncomingMessage[]
  export type WhatsappConfig = { accessToken: string; appSecret: string; verifyToken: string; phoneNumberId: string }
  export function registerWhatsappWebhook(app: FastifyInstance, cfg: WhatsappConfig | undefined): void
  ```

Detalhes:
- Cliente: `POST https://graph.facebook.com/<versão>/<phoneNumberId>/messages` com `{ messaging_product: 'whatsapp', to, type: 'text', text: { body } }`. Mídia: `GET /<versão>/<mediaId>` → `{ url, mime_type }`, depois `GET url`, ambos com `Authorization: Bearer`. A versão é uma constante (a mais recente estável no momento).
- `verifyMetaSignature`: header `sha256=<hex>`, HMAC-SHA256 do corpo cru, `timingSafeEqual` com checagem de tamanho, no padrão de `secretMatches` em `pluggy-webhook.ts`.
- Rotas em `/webhooks/whatsapp`. `GET`: `hub.mode === 'subscribe'` e `hub.verify_token` igual → 200 com `hub.challenge` em texto; senão 403. `POST`: no plugin encapsulado, `addContentTypeParser('application/json', { parseAs: 'buffer' })` guarda o corpo cru; assinatura inválida → 401 antes de olhar o corpo; válida → 200 imediato e `setImmediate` processa cada mensagem de `extractMessages` com `handleWhatsappMessage`, com `catch` que loga (como `processPluggyEvent`).
- `extractMessages`: percorre `entry[].changes[].value`, ignora `value.metadata.phone_number_id` diferente e `statuses`; `type: 'text'` → `text`; `'image'` → `imageId` (legenda em `text`); outros tipos → `unsupported: true`.
- `server.ts`: monta `WhatsappConfig` só se as quatro `WHATSAPP_*` e `GEMINI_API_KEY` existirem; senão passa `undefined` (rota não existe). Comentário curto como o da Pluggy.
- `link-whatsapp.ts`: `pnpm whatsapp:link <email> <telefone>`, normaliza para só dígitos e grava `whatsappPhone`; erros no estilo de `register-pluggy-webhook.ts`.

- [ ] **Step 1: Testes que falham** (`buildTestApp`):
  - GET com token certo → 200 e corpo = challenge; token errado → 403;
  - POST sem assinatura ou com assinatura errada → 401 e `handleWhatsappMessage` não chamado;
  - POST assinado com uma mensagem de texto → 200 e handler chamado com `{ id, from, text }`;
  - payload só com `statuses` → handler não chamado; `phone_number_id` diferente → não chamado;
  - `registerWhatsappWebhook(app, undefined)` → POST 404;
  - `client.test.ts`: `sendText` faz o POST com Bearer e o corpo acima; `downloadMedia` faz os dois GETs.
- [ ] **Step 2: Rodar** — `pnpm --filter @myfinances/api test whatsapp` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** — `pnpm --filter @myfinances/api test && pnpm --filter @myfinances/api lint` → PASS.
- [ ] **Step 5: Commit** — `feat(api): webhook da WhatsApp Cloud API`

### Task 9: Integração ponta a ponta e documentação

**Files:**
- Create: `apps/api/src/services/whatsapp/whatsapp.integration.test.ts`
- Modify: `CLAUDE.md` (raiz)

- [ ] **Step 1: Testes de integração** (Postgres real, no padrão de `sync-connection.integration.test.ts`, Pluggy de mentira e `interpret` e `client` falsos):
  - `it('WhatsApp antes da Pluggy: fica uma transação só, com a descrição do João')`: `handleWhatsappMessage('almoço 45 pix nubank')` → 1 `MANUAL`; `syncConnection` com a remota −45,00 → 1 transação na conta, `source: 'PLUGGY'`, `description: 'Almoço'`; um segundo sync com a descrição do banco diferente mantém `'Almoço'`.
  - `it('Pluggy antes do WhatsApp: renomeia')` → 1 transação, `originalDescription` preenchida; "desfazer" restaura.
  - `it('pendente vira lançada com outro id: a descrição passa adiante')`: sync 1 traz pendente `p1` e casa; sync 2 traz só a lançada `p2` → 1 transação, id da Pluggy `p2`, `'Almoço'`.
  - `it('Carteira: dinheiro recalcula o saldo')`.
- [ ] **Step 2: Rodar** — `pnpm --filter @myfinances/api test:integration` → PASS (corrija na task dona do código se falhar).
- [ ] **Step 3: CLAUDE.md** — trocar "Melhoria futura: lançamento por WhatsApp ou Telegram." por linhas curtas: lançamento pelo WhatsApp (Cloud API oficial, Gemini grátis aceito pelo João) é substituído pela transação da Pluggy mantendo a descrição dele; só o número cadastrado em `whatsappPhone` é aceito (`pnpm --filter @myfinances/api whatsapp:link`); conta ambígua → o bot pergunta (decisão do João); lançamentos do WhatsApp ficam fora de pareamento e recorrentes até a Pluggy trazer.
- [ ] **Step 4: Rodar tudo** — `pnpm test && pnpm lint` na raiz → PASS.
- [ ] **Step 5: Commit** — `test(api): lançamento do WhatsApp ponta a ponta` + `docs: decisões do WhatsApp no CLAUDE.md`
