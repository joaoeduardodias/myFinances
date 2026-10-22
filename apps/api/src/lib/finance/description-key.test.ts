import { describe, expect, it } from 'vitest'

import { descriptionKey } from './description-key'

describe('descriptionKey', () => {
  it('normaliza acentos, caixa, datas e prefixos de pix', () => {
    expect(descriptionKey('PIX ENVIADO - João Açaí 12/03')).toBe(
      descriptionKey('Pix enviado joao acai'),
    )
  })

  it('remove parcelas e pontuação', () => {
    expect(descriptionKey('NETFLIX.COM PARC 02/12')).toBe('netflix com')
  })
})
