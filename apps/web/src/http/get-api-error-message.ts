import { HTTPError } from 'ky'

/**
 * Reads the pt-BR message the API put in the error body.
 *
 * Most screens surface a fixed sentence on failure, which is fine when every
 * failure means the same thing. It is not fine when the message carries
 * information the user needs to act on — applying a protocol answers a 409
 * with the exact tags that blocked it, and a fixed sentence would throw that
 * away.
 *
 * Falls back to `fallback` whenever the error is not an HTTP error, or the
 * body is not JSON, or it carries no message.
 */
export async function getApiErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (!(error instanceof HTTPError)) return fallback

  try {
    const body = await error.response.json<{ message?: string }>()
    return body.message?.trim() ? body.message : fallback
  } catch {
    return fallback
  }
}
