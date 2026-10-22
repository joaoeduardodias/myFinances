/** @type  {import('eslint').Linter.Config} */

// As variantes `Unsafe` do Prisma recebem SQL como string: qualquer dado do
// produtor concatenado ali vira injeção. `Prisma.raw` é o mesmo buraco por
// outro nome — ele marca o texto como SQL literal, fora dos parâmetros.
// O caminho seguro é o template `Prisma.sql`/`$executeRaw`, onde tudo o que é
// interpolado vira parâmetro. Hoje o repositório não usa nenhuma das três;
// a regra existe para que continue assim.
const forbiddenRawSql = [
  {
    selector:
      "MemberExpression[property.name=/^\\$(queryRaw|executeRaw)Unsafe$/]",
    message:
      'Use o template `$queryRaw`/`$executeRaw` (parametrizado). As variantes ' +
      '`Unsafe` recebem SQL como string e abrem injeção.',
  },
  {
    selector: "MemberExpression[object.name='Prisma'][property.name='raw']",
    message:
      '`Prisma.raw` insere texto cru no SQL, fora dos parâmetros. Use ' +
      '`Prisma.sql` com interpolação, ou `Prisma.join` para listas de valores.',
  },
]

module.exports = {
  extends: ['@rocketseat/eslint-config/node'],
  plugins: ['simple-import-sort'],
  rules: {
    'simple-import-sort/imports': 'error',
    'no-restricted-syntax': ['error', ...forbiddenRawSql],
  },
}
