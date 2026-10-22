export class ConflictError extends Error {
  /** Campos extras do corpo do 409, para o web decidir o que oferecer. */
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}
