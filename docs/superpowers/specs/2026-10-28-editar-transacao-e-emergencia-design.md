# Editar transação na Análise e marca "emergência" — Design

Data: 2026-10-28

## Intenção

Na tela Análise, o João olha "Maiores gastos" e quer corrigir a transação ali mesmo: trocar a categoria e a descrição. Hoje só dá para trocar a categoria (e a marca) pelo detalhe da categoria, e a descrição não é editável em lugar nenhum.

Ele também quer separar o gasto imprevisto do gasto evitável. O exemplo dele: conserto do carro. Não é descuido (evitável) nem custo fixo (essencial). Ver isso à parte responde "o mês estourou por imprevisto ou por descuido?".

Continuação da análise do ano (`2026-10-27-analise-anual-design.md`).

## Objetivos

1. **Marca "Emergência"**, terceira opção ao lado de essencial e evitável.
   - Só manual, transação por transação (decisão do João). Nenhuma categoria tem emergência como padrão, e o diálogo "Essencial ou evitável" continua com as duas opções.
   - Vale para qualquer débito, como as outras marcas (inclusive Outros, sem categoria e Dívidas e juros), e tira a transação do grupo dela.
2. **Emergência na Análise** como grupo próprio, igual a dívida (*chamada minha*):
   - entra no "Saiu";
   - indicador "Emergência" com o % do Saiu;
   - cor própria nas barras empilhadas do gráfico, nos dois temas;
   - não entra em "Dava pra evitar".
3. **Janela da transação.** Clicar numa linha de "Maiores gastos" abre a transação para editar:
   - descrição;
   - categoria (mesmo comportamento de hoje: trava e aprende regra pela descrição);
   - marca: "Padrão da categoria", "Essencial", "Evitável", "Emergência". Crédito não tem marca.
   - Mostra também, só para leitura, data, conta e valor (*chamada minha*).
   - A mesma janela abre em "Dava pra evitar" e nas linhas do detalhe da categoria (*chamada minha*: um jeito só de editar).
   - Salvar atualiza Análise, Transações e Início.
4. **Detalhe da categoria mais largo**, sem rolagem horizontal (pedido do João).
   - Em tela larga ocupa por volta de metade da tela; no celular, tela cheia (*chamada minha*).
   - As linhas ficam só com data, descrição, conta e valor; os selects de categoria e marca saem das linhas e vão para a janela da transação (*chamada minha*). Clicar na linha abre a janela.

## Descrição editada

- A descrição nova aparece em todo o app no lugar da do banco.
- A sincronização da Pluggy não a sobrescreve. O app já tem isso para o lançamento do WhatsApp substituído pela Pluggy: `descriptionLocked` + `originalDescription` (texto do banco). A edição usa o mesmo mecanismo.
- A regra de categoria continua presa ao texto do banco (`descriptionKey` não muda na edição), para a regra seguir pegando as próximas compras do mesmo lugar (*chamada minha*).
- Apagar a descrição (salvar vazia) volta o texto do banco (*chamada minha*).
- Vale para qualquer transação, inclusive de cartão e lançamento manual.

## Não-objetivos

- Editar data, valor ou conta.
- Emergência como padrão de categoria.
- Editar a transação pela tela Transações ou pelo detalhe do cartão (fica para depois, se o João quiser).

## Anti-objetivos

- A descrição editada sumir na próxima sincronização.
- Editar a descrição quebrar a regra de categoria aprendida.
- Emergência somar duas vezes (no grupo dela e no da categoria) ou sumir do "Saiu".

## Restrições e contexto

- Marca hoje: `enum Necessity { ESSENTIAL AVOIDABLE }`, `Transaction.necessity`, `PATCH /transactions/:id/necessity`. A troca de padrão por categoria (`PUT /category-necessities/:category`) aceita só ESSENTIAL/AVOIDABLE e deve continuar assim.
- A agregação é `annualAnalysis` em `apps/api/src/lib/finance/annual-analysis.ts`; meses e totais têm um campo por grupo.
- O lançamento do WhatsApp tem "Desfazer" que volta o texto do banco usando `originalDescription`; a edição não pode quebrar isso.
- Toda tabela tem `SortableHead`; textos em português; tema claro e escuro pelos tokens de `index.css`.
- A API está fora do formatador do Biome.

## Fica a cargo de quem construir

- Rota da descrição (nova rota ou uma rota única de edição da transação).
- Componente da janela (Dialog ou Sheet) e como o detalhe da categoria a abre por cima.
- Largura exata do detalhe e tom da cor de emergência.
