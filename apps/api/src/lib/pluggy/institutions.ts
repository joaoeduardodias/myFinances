const logo = (connectorId: number) =>
  `https://cdn.pluggy.ai/assets/connector-icons/${connectorId}.svg`

/**
 * Bancos por código COMPE. O conector MeuPluggy não diz o banco; o logo é o
 * do conector do próprio banco no CDN da Pluggy (GET /connectors).
 */
export const INSTITUTIONS: Record<
  string,
  { name: string; shortName: string; logoUrl: string }
> = {
  '104': { name: 'Caixa Econômica Federal', shortName: 'Caixa', logoUrl: logo(219) },
  '237': { name: 'Bradesco', shortName: 'Bradesco', logoUrl: logo(203) },
  '260': { name: 'Nubank', shortName: 'Nubank', logoUrl: logo(212) },
  '323': { name: 'Mercado Pago', shortName: 'Mercado Pago', logoUrl: logo(206) },
}
