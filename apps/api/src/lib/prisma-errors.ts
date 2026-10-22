/** P2025: o `where` do `update` não achou linha (nenhuma bate com o filtro). */
export function isRecordNotFound(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2025'
  )
}

/** P2002: o índice único recusou a linha (outra já tem o mesmo valor). */
export function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  )
}
