import { z } from 'zod'

/** A API faz POST nesse endereço ao enviar: só HTTPS, como os serviços de push. */
export const pushEndpointSchema = z
  .url()
  .max(2048)
  .refine((url) => url.startsWith('https://'), 'O endpoint precisa ser HTTPS.')
