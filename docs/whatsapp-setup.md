# WhatsApp — estado e pendências

Atualizado em 2026-10-27.

## Pendente: número brasileiro próprio para o bot

O bot recebe, interpreta e grava, mas **não consegue responder** com os números que a Meta cede:

| Número | ID | Bloqueio |
|---|---|---|
| +1 555-182-6409 (teste público) | 1403422789518430 | `130497`: conta não pode mandar para o Brasil |
| +1 555-453-6362 | 1310753888798184 | `131037`: nome de exibição precisa de aprovação |
| +1 711-812-4171 (em uso no `.env`) | 1370784956126475 | `131037`: idem, depois de umas poucas mensagens |

Números cedidos pela Meta liberam poucas mensagens com o nome `AVAILABLE_WITHOUT_REVIEW` e depois exigem nome aprovado. A saída é um **chip brasileiro pré-pago só para o bot** (não pode estar em uso no app do WhatsApp). O usuário final segue no WhatsApp normal; ninguém precisa do WhatsApp Business.

### Passo a passo com o chip

1. Adicionar o número no negócio **Teste** (`1451375758050352`) — pelo WhatsApp Manager ou pelo MCP da Meta (`add_phone_number` → `verify_phone_number` por SMS → `register_phone_number`, sem PIN).
2. Assinar o app `my-finances` (`4409382579374119`) **na conta do WhatsApp e na conta de mensagens** do número (`POST /{id}/subscribed_apps` nas duas). Só com a primeira, nenhum webhook de mensagem chega.
3. Trocar `WHATSAPP_PHONE_NUMBER_ID` no `.env` e reiniciar a API (o `.env` só é lido na subida).
4. Mandar uma mensagem para o número novo pelo link `https://wa.me/<número>` e acompanhar o log.

## O que já está pronto

- Token de usuário do sistema (`myfinances-bot`), sem vencimento, com `whatsapp_business_messaging` e `whatsapp_business_management`.
- Webhook do app em `/webhooks/whatsapp`, campo `messages`, verificado.
- Telefone do João cadastrado (`whatsapp:link`).
- Gemini `gemini-3.5-flash-lite` (o Flash grátis dá 20 chamadas/dia; o 2.5 saiu para contas novas).

## Pegadinhas

- A Meta manda o celular BR sem o 9 no `from`; o bot responde ao número cadastrado.
- Mensagem aceita pela API (200) ainda pode não ser entregue: o motivo vem num status `failed` no webhook, registrado no log como "Meta não entregou a mensagem".
- Texto livre só vai para quem escreveu ao número nas últimas 24h (`131047`).
- Webhook que chega sem mensagem para o número configurado vai para o log com o `phone_number_id` — foi assim que se viu mensagem indo para o número antigo.
- Em desenvolvimento a URL do webhook é um túnel `trycloudflare`, que muda a cada reinício; o bot só fica no ar de vez com o deploy.
