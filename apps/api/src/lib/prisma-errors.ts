/** P2025: o `where` do `update` não achou linha (nenhuma bate com o filtro). */
export function isRecordNotFound(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2025'
  )
}
