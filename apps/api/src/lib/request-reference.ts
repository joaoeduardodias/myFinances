import { randomBytes } from 'node:crypto'

/**
 * Código de referência de uma requisição.
 *
 * Ele é a ponte entre a tela do produtor e o log: a resposta de erro não
 * carrega mais o motivo do banco — nome de tabela, de coluna e trecho de SQL
 * não interessam a quem está pesando boi, e descrevem nossa infraestrutura —
 * mas carrega este código, e com ele se acha a linha do log que tem tudo.
 *
 * O alfabeto exclui 0/O e 1/I/L de propósito: este código vai ser lido em voz
 * alta, por telefone, de um curral. Oito caracteres dão 4 bilhões de
 * combinações, o que basta para não repetir dentro de uma janela de log.
 *
 * O id que o Fastify gera sozinho não serve: é `req-1`, `req-2`, e reinicia a
 * contagem a cada restart do processo — dois erros diferentes acabariam com o
 * mesmo código.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const LENGTH = 8

export function newRequestReference(): string {
  const bytes = randomBytes(LENGTH)
  let reference = ''
  for (const byte of bytes) {
    reference += ALPHABET[byte % ALPHABET.length]
  }

  return reference
}
