const logo = (connectorId: number) =>
  `https://cdn.pluggy.ai/assets/connector-icons/${connectorId}.svg`

/**
 * Bancos por código COMPE. O conector MeuPluggy não diz o banco; o logo é o
 * do conector do próprio banco no CDN da Pluggy (GET /connectors).
 */
export const INSTITUTIONS: Record<string, { name: string; logoUrl: string }> = {
  '104': { name: 'Caixa Econômica Federal', logoUrl: logo(219) },
  '237': { name: 'Bradesco', logoUrl: logo(203) },
  '260': { name: 'Nubank', logoUrl: logo(212) },
  '323': { name: 'Mercado Pago', logoUrl: logo(206) },
}
