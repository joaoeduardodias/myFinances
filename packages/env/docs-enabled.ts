import { z } from 'zod'

/**
 * Publica ou não o `/docs` (Swagger UI e o OpenAPI por trás dele).
 *
 * Padrão fechado: produção não declara a variável, e o `/docs` aberto entrega
 * o mapa completo da API — as ~60 rotas, com schema de corpo, parâmetros e
 * resposta, inclusive as que ninguém acharia navegando o SPA. Nada ali é
 * segredo, mas é o reconhecimento pronto para quem for procurar brecha.
 *
 * `stringbool` e não `coerce.boolean()`: o `coerce` lê toda string não vazia
 * como verdadeira, então `API_DOCS_ENABLED=false` *abriria* a documentação —
 * a variável desligada fazendo o contrário do que diz. O `stringbool` entende
 * true/false, 1/0, yes/no, e recusa o que não reconhece em vez de adivinhar.
 */
export const docsEnabledSchema = z.stringbool().default(false)
