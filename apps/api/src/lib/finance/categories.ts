export const CATEGORIES = [
  'Alimentação',
  'Mercado',
  'Transporte',
  'Moradia',
  'Saúde',
  'Educação',
  'Lazer',
  'Assinaturas',
  'Compras',
  'Serviços',
  'Impostos e taxas',
  'Salário',
  'Outras receitas',
  'Outros',
] as const

export type Category = (typeof CATEGORIES)[number]

/** Categorias em inglês da Pluggy (minúsculas) para as nossas. */
const PLUGGY_CATEGORIES: Record<string, Category> = {
  groceries: 'Mercado',
  supermarkets: 'Mercado',
  'eating out': 'Alimentação',
  restaurants: 'Alimentação',
  'food delivery': 'Alimentação',
  'food and drinks': 'Alimentação',
  transportation: 'Transporte',
  'ride-hailing': 'Transporte',
  taxi: 'Transporte',
  'gas stations': 'Transporte',
  housing: 'Moradia',
  rent: 'Moradia',
  health: 'Saúde',
  pharmacy: 'Saúde',
  education: 'Educação',
  leisure: 'Lazer',
  entertainment: 'Lazer',
  travel: 'Lazer',
  'digital services': 'Assinaturas',
  streaming: 'Assinaturas',
  subscriptions: 'Assinaturas',
  shopping: 'Compras',
  services: 'Serviços',
  taxes: 'Impostos e taxas',
  'tax on financial operations': 'Impostos e taxas',
  salary: 'Salário',
  'proceeds interests and dividends': 'Outras receitas',
  income: 'Outras receitas',
}

export function mapPluggyCategory(raw: string | null | undefined): Category | null {
  if (!raw) return null
  return PLUGGY_CATEGORIES[raw.trim().toLowerCase()] ?? null
}
