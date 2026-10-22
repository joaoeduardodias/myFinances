/**
 * O motivo real que o banco de dados deu, legível numa linha.
 *
 * A mensagem do Prisma vem com um preâmbulo (``Invalid `prisma.x()`
 * invocation:``) e várias linhas em branco antes do que interessa. O que
 * interessa é a última parte — foi ela que ficou escondida atrás de
 * "código P2010" enquanto toda a sincronização do desktop quebrava por seis
 * dias com os testes verdes.
 *
 * A credencial de conexão é apagada: a URL do banco aparece inteira em erro
 * de conexão, e ela carrega usuário e senha.
 */

/** Tamanho máximo do motivo repassado adiante. */
export const MAX_REASON_LENGTH = 400

export function databaseReason(error: unknown): string {
  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')
  const withoutPreamble = raw.includes('invocation:')
    ? raw.slice(raw.indexOf('invocation:') + 'invocation:'.length)
    : raw
  const oneLine = withoutPreamble
    .replace(/postgres(ql)?:\/\/[^\s"']*/gi, '[conexão]')
    .replace(/\s+/g, ' ')
    .trim()
  if (oneLine.length <= MAX_REASON_LENGTH) return oneLine
  return `${oneLine.slice(0, MAX_REASON_LENGTH)}…`
}

/** Junta a explicação nossa com o motivo do banco, quando existe. */
export function withReason(explanation: string, reason: string): string {
  return reason ? `${explanation} Motivo: ${reason}` : explanation
}
