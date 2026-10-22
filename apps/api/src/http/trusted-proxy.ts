/**
 * Quantos proxies ficam entre a internet e a API: o da hospedagem, um só.
 *
 * O proxy da hospedagem não limpa o `X-Forwarded-For` que vem do cliente, só acrescenta o
 * IP de quem conectou nele no fim. Com `trustProxy: true` o Fastify lê o
 * primeiro valor — o que o cliente escreveu —, e trocar esse valor a cada
 * tentativa zera os limitadores por IP (`middlewares/rate-limit.ts`). Contando
 * um salto da direita, o IP é o que o proxy anotou.
 *
 * Errar para mais é pior que parece: com um salto a mais o IP vira o do proxy,
 * igual para todo mundo, e um único balde de 100 req/min serve a todos.
 */
export const TRUSTED_PROXY_HOPS = 1

/**
 * O `trustProxy` do Fastify. É uma função, e não o número `1`: a partir do
 * Fastify 5.12 um número sozinho não confia em ninguém (não dá para validar o
 * par imediato só pela contagem), e o `request.ip` voltaria a ser o do proxy.
 * `hop` é a distância da ponta direita da cadeia; o salto 0 é o par que abriu
 * a conexão.
 */
export const trustProxy = (_address: string, hop: number) =>
  hop < TRUSTED_PROXY_HOPS
