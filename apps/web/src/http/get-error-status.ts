import { HTTPError } from 'ky'

/** Status HTTP do erro, ou `undefined` quando a requisição nem chegou à API. */
export function getErrorStatus(error: unknown) {
  return error instanceof HTTPError ? error.response.status : undefined
}
