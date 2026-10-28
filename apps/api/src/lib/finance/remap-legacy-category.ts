import { CATEGORIES, type Category, mapPluggyCategory } from './categories'

/** Nomes antigos que viraram um grupo de categorias, com o padrão de cada um. */
const LEGACY_GROUPS: Record<string, { members: readonly Category[]; fallback: Category }> = {
  'Alimentação': { members: ['Mercado', 'Delivery', 'Restaurante'], fallback: 'Restaurante' },
  Transporte: {
    members: ['Carro', 'Combustível', 'Uber e táxi', 'Transporte público'],
    fallback: 'Uber e táxi',
  },
}

/**
 * Leva uma categoria da lista antiga para a nova. Nome da lista nova fica como está;
 * nome antigo usa a categoria da Pluggy quando ela cai no mesmo grupo, senão o padrão.
 */
export function remapLegacyCategory(
  category: string | null,
  pluggyCategory: string | null,
): Category | null {
  if (!category) return null
  if ((CATEGORIES as readonly string[]).includes(category)) return category as Category
  const group = LEGACY_GROUPS[category]
  if (!group) return null
  const mapped = mapPluggyCategory(pluggyCategory)
  return mapped && group.members.includes(mapped) ? mapped : group.fallback
}
