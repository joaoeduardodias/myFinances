import { env } from '@myfinances/env'

/**
 * Flash Lite gratuito; trocar aqui se a Google aposentar o modelo (o 2.5 saiu
 * para contas novas em 2026-10). Lite e não Flash pela cota: o Flash grátis dá
 * 20 chamadas por dia. O 3.8 passou de 90 s numa resposta: não serve.
 */
export const GEMINI_MODEL = 'gemini-3.5-flash-lite'

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

/** Sem isso um Gemini travado seguraria o webhook do WhatsApp. */
const GEMINI_TIMEOUT_MS = 15_000

/** Sobrecarga do Google (503/429) costuma passar em segundos: uma segunda tentativa. */
const RETRY_DELAY_MS = 1_000

/** Gemini fora do ar, sem chave, limitado ou com resposta ilegível. */
export class GeminiUnavailableError extends Error {
  constructor(message = 'Gemini indisponível') {
    super(message)
    this.name = 'GeminiUnavailableError'
  }
}

export type GeminiDeps = { fetch?: typeof fetch; apiKey?: string; retryDelayMs?: number }

export type GenerateJsonRequest = { system: string; parts: object[]; schema: object }

/** Devolve o texto JSON cru do primeiro candidato; quem chama valida o formato. */
export async function generateJson(
  request: GenerateJsonRequest,
  deps: GeminiDeps = {},
): Promise<string> {
  const apiKey = deps.apiKey ?? env.GEMINI_API_KEY
  if (!apiKey) throw new GeminiUnavailableError('GEMINI_API_KEY ausente')

  const post = () =>
    (deps.fetch ?? fetch)(ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: request.parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: request.schema,
        },
      }),
    })

  let response: Response
  try {
    response = await post()
    if (response.status === 503 || response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, deps.retryDelayMs ?? RETRY_DELAY_MS))
      response = await post()
    }
  } catch {
    throw new GeminiUnavailableError('Falha de rede ao chamar o Gemini')
  }
  if (!response.ok) {
    // O corpo explica o erro (ex.: modelo aposentado); sem ele o log só diria o status.
    const reason = await (response.json() as Promise<{ error?: { message?: string } }>)
      .then((body) => body.error?.message)
      .catch(() => undefined)
    throw new GeminiUnavailableError(
      `Gemini respondeu ${response.status}${reason ? `: ${reason}` : ''}`,
    )
  }

  try {
    const json = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof text !== 'string') throw new Error('sem texto')
    return text
  } catch {
    throw new GeminiUnavailableError('Resposta do Gemini ilegível')
  }
}
