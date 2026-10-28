export const CATEGORIES = [
  'Mercado',
  'Delivery',
  'Restaurante',
  'Carro',
  'Combustível',
  'Uber e táxi',
  'Transporte público',
  'Moradia',
  'Farmácia',
  'Saúde',
  'Educação',
  'Lazer',
  'Assinaturas',
  'Compras',
  'Serviços',
  'Impostos e taxas',
  'Dívidas e juros',
  'Investimentos',
  'Salário',
  'Outras receitas',
  'Outros',
] as const

export type Category = (typeof CATEGORIES)[number]

export type Necessity = 'ESSENTIAL' | 'AVOIDABLE'

export type CategoryGroup =
  | 'income'
  | 'essential'
  | 'avoidable'
  | 'debt'
  | 'investment'
  | 'unclassified'

/** Grupo padrão de cada categoria; o João pode reclassificar. */
export const DEFAULT_GROUP: Record<Category, CategoryGroup> = {
  Mercado: 'essential',
  Delivery: 'avoidable',
  Restaurante: 'avoidable',
  Carro: 'essential',
  'Combustível': 'essential',
  'Uber e táxi': 'avoidable',
  'Transporte público': 'essential',
  Moradia: 'essential',
  'Farmácia': 'essential',
  'Saúde': 'essential',
  'Educação': 'essential',
  Lazer: 'avoidable',
  Assinaturas: 'avoidable',
  Compras: 'avoidable',
  'Serviços': 'essential',
  'Impostos e taxas': 'essential',
  'Dívidas e juros': 'debt',
  Investimentos: 'investment',
  'Salário': 'income',
  'Outras receitas': 'income',
  Outros: 'unclassified',
}

/** Categorias que entram na divisão essencial/evitável. */
export function isNecessityCategory(c: string): boolean {
  const group = DEFAULT_GROUP[c as Category]
  return group === 'essential' || group === 'avoidable'
}

/** Categorias em inglês da Pluggy (minúsculas) para as nossas. */
const PLUGGY_CATEGORIES: Record<string, Category> = {
  groceries: 'Mercado',
  supermarkets: 'Mercado',
  'food delivery': 'Delivery',
  'eating out': 'Restaurante',
  restaurants: 'Restaurante',
  'food and drinks': 'Restaurante',
  'vehicle maintenance': 'Carro',
  automotive: 'Carro',
  'vehicle insurance': 'Carro',
  'vehicle purchase': 'Carro',
  'gas stations': 'Combustível',
  'ride-hailing': 'Uber e táxi',
  taxi: 'Uber e táxi',
  'taxi and ride-hailing': 'Uber e táxi',
  transportation: 'Transporte público',
  'public transportation': 'Transporte público',
  'tolls and in vehicle payment': 'Transporte público',
  parking: 'Transporte público',
  housing: 'Moradia',
  rent: 'Moradia',
  'real estate financing': 'Moradia',
  electricity: 'Moradia',
  water: 'Moradia',
  telecommunications: 'Moradia',
  internet: 'Moradia',
  mobile: 'Moradia',
  utilities: 'Moradia',
  houseware: 'Moradia',
  pharmacy: 'Farmácia',
  health: 'Saúde',
  healthcare: 'Saúde',
  'hospital clinics and labs': 'Saúde',
  dentist: 'Saúde',
  'gyms and fitness centers': 'Saúde',
  education: 'Educação',
  leisure: 'Lazer',
  entertainment: 'Lazer',
  travel: 'Lazer',
  lodging: 'Lazer',
  tickets: 'Lazer',
  'digital services': 'Assinaturas',
  streaming: 'Assinaturas',
  subscriptions: 'Assinaturas',
  shopping: 'Compras',
  clothing: 'Compras',
  electronics: 'Compras',
  'kids and toys': 'Compras',
  'online shopping': 'Compras',
  services: 'Serviços',
  taxes: 'Impostos e taxas',
  'tax on financial operations': 'Impostos e taxas',
  'bank fees': 'Impostos e taxas',
  'loans and financing': 'Dívidas e juros',
  'interests charged': 'Dívidas e juros',
  'late payment and overdraft costs': 'Dívidas e juros',
  'credit card fees': 'Dívidas e juros',
  investments: 'Investimentos',
  salary: 'Salário',
  'proceeds interests and dividends': 'Outras receitas',
  income: 'Outras receitas',
}

export function mapPluggyCategory(raw: string | null | undefined): Category | null {
  if (!raw) return null
  return PLUGGY_CATEGORIES[raw.trim().toLowerCase()] ?? null
}
