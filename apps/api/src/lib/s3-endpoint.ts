/**
 * O endpoint que o SDK quer é o da conta: ele já põe o bucket como subdomínio.
 * O painel do R2 mostra o endpoint com o bucket no fim, e copiá-lo assim faria
 * o nome aparecer duas vezes na URL (`bucket.conta.../bucket`), mandando o
 * arquivo para uma pasta que não existe. Aqui o bucket sai do path — qualquer
 * outro caminho (um proxy, por exemplo) é preservado.
 */
export function toAccountEndpoint(endpoint: string, bucket: string) {
  const url = new URL(endpoint)

  if (url.pathname.replace(/\/+$/, '') === `/${bucket}`) {
    url.pathname = '/'
  }

  return url.toString().replace(/\/+$/, '')
}
