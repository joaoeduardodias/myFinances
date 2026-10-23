// Webhook e o botão Sincronizar podem disparar ao mesmo tempo para o mesmo
// usuário; em paralelo, os upserts colidem (P2002). A API roda numa instância
// só, então uma fila em memória por usuário basta.
const userQueues = new Map<string, Promise<unknown>>()

export function runExclusive<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = userQueues.get(userId) ?? Promise.resolve()
  const run = previous.then(task)
  const tail = run.catch(() => {})
  userQueues.set(userId, tail)
  tail.then(() => {
    if (userQueues.get(userId) === tail) userQueues.delete(userId)
  })
  return run
}
