import { z } from 'zod'

import { isPushServiceUrl } from '@/lib/push'

export const pushEndpointSchema = z
  .url()
  .max(2048)
  .refine(isPushServiceUrl, 'O endpoint não é de um serviço de push conhecido.')
