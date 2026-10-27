# Análise do ano — Design

Data: 2026-10-27

## Intenção

O João olha o ano e não entende por que o dinheiro não sobra. Ele quer abrir o app e ver quanto entrou por mês, para onde foi, o que mais pesou e o que dava para evitar. As categorias precisam ser finas o bastante para responder "gastei muito com delivery?" ou "quanto o carro me custou?".

Este é o projeto 1 de 2. O projeto 2 é o consultor com IA (`2026-10-27-consultor-ia-design.md`). Ele depende daqui: a IA só dá conselho útil se os gastos estiverem bem categorizados e marcados como essencial ou evitável.

## O que os dados mostram hoje

O histórico vai de 2025-10-23 a 2026-10-27, com 858 transações. Fora as transferências entre contas próprias, cerca de R$ 23 mil em débitos estão sem categoria. A maior parte é Pix ou transferência para terceiros (`pluggyCategory` "Transfers", "Transfer - PIX", "Transfer - Bank Slip"). Várias categorias que a Pluggy manda não estão mapeadas e ficam sem categoria. Exemplos: "Vehicle maintenance", "Automotive", "Telecommunications", "Electricity", "Loans and financing", "Real estate financing", "Late payment and overdraft costs", "Interests charged", "Credit card fees", "Bank fees", "Insurance", "Mobile", "Houseware", "Clothing", "Healthcare", "Hospital clinics and labs", "Tolls and in vehicle payment", "Investments", "Donations".

## Objetivos

1. **Categorias mais finas** (lista aprovada pelo João, com acréscimos marcados):
   - Mercado · Delivery · Restaurante
   - Carro (oficina, IPVA, seguro, parcela) · Combustível. O João quer o custo do carro junto, menos o combustível.
   - Uber e táxi · Transporte público (inclui pedágio, *chamada minha*)
   - Moradia (aluguel, financiamento, condomínio, luz, água, internet, celular)
   - Farmácia · Saúde
   - Assinaturas · Lazer · Compras · Educação · Impostos e taxas · Serviços · Outros
   - **Dívidas e juros**: empréstimo, juros, atraso, tarifas de cartão. *Acréscimo meu*: dívida não é essencial nem evitável, é outro problema.
   - **Investimentos**: dinheiro guardado não é gasto. *Acréscimo meu.*
   - Entradas: Salário · Outras receitas
2. **Mapear todas as categorias da Pluggy** que aparecem nos dados para a lista nova. Ex.: "Vehicle maintenance"/"Automotive" → Carro, "Gas stations" → Combustível, "food delivery" → Delivery, "Eating out"/"Restaurants" → Restaurante, "Electricity"/"Telecommunications"/"Mobile" → Moradia, "Pharmacy" → Farmácia, "Loans and financing"/"Interests charged"/"Late payment…"/"Credit card fees" → Dívidas e juros, "Real estate financing" → Moradia, "Investments" → Investimentos. Transferências para terceiros continuam sem categoria. O João categoriza na mão e a regra por descrição, que já existe, aprende.
3. **Essencial ou evitável.** Cada categoria de gasto tem um padrão, e o João pode trocar o padrão de uma categoria e também marcar uma transação específica na mão (decisão do João). A marca na mão vale para aquela transação e não vira regra.
   - Padrão essencial: Mercado, Carro, Combustível, Transporte público, Moradia, Farmácia, Saúde, Educação, Impostos e taxas, Serviços.
   - Padrão evitável: Delivery, Restaurante, Uber e táxi, Lazer, Compras, Assinaturas.
   - Fora dessa divisão: Dívidas e juros (grupo próprio "dívida"), Investimentos (não é gasto), Outros e sem categoria ("sem classificação"), entradas.
   - Os padrões acima são *chamada minha*. O João ajusta.
4. **Tela "Análise"** nova no menu lateral. Por padrão mostra os últimos 12 meses até o mês atual (*chamada minha*):
   - Números do período: quanto entrou, quanto saiu, quanto sobrou ou faltou, e quanto do que saiu foi essencial, evitável e dívida.
   - Mês a mês: entradas contra saídas, com as saídas divididas em essencial, evitável e dívida. Clicar num mês filtra a tela para aquele mês.
   - Categorias que mais pesaram, com valor, parte do total e comparação com a média dos outros meses.
   - Maiores gastos: as transações de maior valor no período.
   - O que dava para evitar: categorias e transações evitáveis que mais pesaram.
   - Destaque para o que está **sem categoria** (quantidade e valor), com acesso direto para categorizar.
   - Clicar numa categoria abre as transações dela no período. Ali dá para trocar a categoria e a marca essencial/evitável.
5. **Configuração dos padrões** essencial/evitável por categoria, em um lugar simples no app.

## O que conta como entrada e como gasto

- Entradas: créditos das contas e da Carteira que não são transferência.
- Gastos: débitos das contas e da Carteira que não são transferência, mais compras no cartão. O pagamento da fatura já é transferência (regra existente), então a compra não conta duas vezes.
- Parcela de cartão conta no mês em que aparece.
- Crédito com categoria de gasto abate essa categoria em vez de contar como entrada (*chamada minha*). Vale para estorno no cartão e para dinheiro devolvido numa conta (ex.: amigo devolve a parte do jantar e o João põe em Restaurante). A categoria usada é a do próprio crédito, sem procurar a compra original. Estorno sem categoria fica de fora, como no gráfico do Início.
- Investimentos aparecem à parte e não somam nos gastos. Resgate (crédito em Investimentos) também não conta como entrada.
- A marca na mão vale para qualquer débito, inclusive "Outros", sem categoria e Dívidas e juros, e tira a transação do grupo dela. A marca continua mesmo se a categoria mudar depois (*chamada minha*).
- Lançamentos do WhatsApp contam como qualquer transação.

## Não-objetivos

- Período livre de datas, exportação ou comparação entre anos.
- Orçamento e limites por categoria (são do projeto 2).
- Categorias criadas pelo usuário. A lista é fixa no código.
- Subcategorias ou tags.

## Anti-objetivos

- Contar um gasto duas vezes (compra no cartão e pagamento da fatura).
- Perder categorias que o João já ajustou na mão (`categoryLocked`) ou regras já aprendidas na troca de nomes.
- Uma tela bonita em que "sem categoria" vira a maior fatia sem que o João perceba.

## Restrições e contexto

- A lista `CATEGORIES` (`apps/api/src/lib/finance/categories.ts`) alimenta o enum da rota de categoria, o `GET /categories` e o esquema do Gemini do WhatsApp. Trocar a lista muda os três.
- Nomes antigos que somem ("Alimentação", "Transporte") precisam de migração dos dados: transações, regras (`CategoryRule`) e lançamentos travados. Transação não travada é recalculada pela categoria da Pluggy. Transação travada e regra com nome antigo usam a categoria da Pluggy quando ela cai num dos nomes novos do mesmo grupo. Senão, o padrão é Alimentação → Restaurante e Transporte → Uber e táxi (*chamada minha*).
- Hoje a tela de Transações não mostra o cartão, e o detalhe do cartão não deixa trocar categoria. A troca de categoria e da marca precisa funcionar para compras no cartão, pelo menos a partir da tela de Análise.
- Toda tabela tem ordenação por coluna (`SortableHead`). Tabela paginada no servidor ordena na API.
- Tema claro e escuro e o layout de tela larga seguem o padrão do app.

## Fica a cargo de quem construir

- Forma de guardar o padrão por categoria e a marca na mão da transação.
- Se a agregação é feita na API num endpoint próprio ou reaproveita o snapshot financeiro.
- Tipo de gráfico e layout exato da tela.
- O mapeamento completo das categorias da Pluggy além dos exemplos acima.
