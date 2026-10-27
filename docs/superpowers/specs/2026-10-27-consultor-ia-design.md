# Consultor financeiro com IA — Design

Data: 2026-10-27

## Intenção

O João quer que o app funcione como um consultor financeiro: avisar na hora quando um gasto o coloca em risco, dizer o que mudar e acompanhar se ele está melhorando. Ele também quer poder perguntar coisas como "dá para comprar um tênis de R$ 300 esse mês?".

Este é o projeto 2 de 2 e depende da Análise do ano (`2026-10-27-analise-anual-design.md`): categorias finas e a marca essencial/evitável.

## Objetivos

1. **Limites por categoria por mês.** A IA propõe cada limite a partir do histórico e o João aceita ou ajusta (decisão do João). Ela propõe para todas as categorias de gasto, menos Dívidas e juros e Investimentos, e o João pode recusar qualquer uma. O gasto do mês segue exatamente a regra da Análise (*chamada minha*). As propostas são revistas uma vez por mês quando ele estoura ou sobra com frequência (*chamada minha*). Sem limite aceito, a categoria não gera aviso.
2. **Dois alarmes** (decisão do João):
   - **Salário:** uma transação nova faz o "Quanto posso gastar" (projeção até o próximo recebimento) ficar negativo.
   - **Categoria:** o gasto do mês numa categoria chega a 80% e a 100% do limite.
   - Cada linha avisa uma vez só. O alarme de categoria avisa uma vez por limiar por mês. O alarme de salário avisa ao ficar negativo e só avisa de novo se voltar ao positivo e cair outra vez. Isso é *chamada minha*, para não virar spam.
   - Os alarmes são calculados por regra, sem IA (*chamada minha*): são imediatos, não dependem da cota do Gemini e não erram conta.
   - Eles disparam quando entra transação nova: sync ou webhook da Pluggy, lançamento manual e lançamento do WhatsApp.
3. **Avisos no app, na hora** (decisão do João):
   - Ficam guardados no servidor. Um sininho no app lista os avisos e marca os lidos.
   - Chegam como notificação do navegador (Web Push) mesmo com o app fechado. No momento o alvo é o computador.
   - Para o celular, o João vai criar depois um app React Native. Ele vai consumir os mesmos avisos guardados, então o modelo não pode depender do navegador.
4. **Resumo do consultor no Início**, sempre que o João abre o app: poucos pontos objetivos. Exemplos: "delivery 30% acima do mês passado", "faltam R$ X até o salário", "você respeitou 5 de 7 limites em setembro". Gerado pela IA quando entram dados novos, no máximo uma vez por dia, e guardado. Abrir o app não chama a IA.
5. **Perguntas ao consultor.** A IA recebe um pacote fixo de números calculados pelo app e responde só com base nele, dizendo quando a pergunta foge do pacote. Não há function calling, o que dá uma chamada por pergunta (*chamada minha*). O pacote tem: "Quanto posso gastar" e a data do próximo recebimento, gasto do mês e limite restante por categoria, contas a pagar e totais dos últimos meses. Com isso, "dá para comprar um tênis de R$ 300?" se responde comparando com o que sobra até o salário e no limite de Compras.
   - No app, um campo de pergunta com respostas baseadas nos números dele.
   - Pelo WhatsApp, dentro da conversa (o João pediu, se não fosse custoso). O interpretador do WhatsApp passa a reconhecer que a mensagem é uma pergunta, além de lançamento, e responde com o mesmo motor do app.
6. **Acompanhar a melhora.** O resumo compara o mês com os anteriores: evitável em queda ou alta, limites respeitados, dívida.

## Não-objetivos

- Avisos ativos pelo WhatsApp fora da janela de 24h. Isso exige um modelo aprovado pela Meta e é cobrado por mensagem. O João preferiu deixar para o app por enquanto.
- App React Native e push no celular.
- A IA mexendo em dados: categorizar, criar limite sem aceite, apagar.
- Investimento, crédito ou qualquer recomendação de produto financeiro.

## Anti-objetivos

- Aviso repetido a cada compra depois de estourar.
- Conselho genérico que não cita os números do João.
- Resposta da IA com valor inventado. Os números vêm do app e a IA só redige.
- Gastar a cota grátis do Gemini abrindo o app ou rodando teste.

## Restrições e contexto

- **Gemini grátis** (`gemini-3.5-flash-lite`), com cota diária limitada. Os lançamentos do WhatsApp têm prioridade: o consultor guarda uma reserva da cota diária para eles e conta o próprio uso (*chamada minha*). Quando a cota do consultor acaba, o app mostra o último resumo e diz que perguntas estão indisponíveis no momento. Não quebra.
- **Privacidade (decisão do João):** para o Gemini vão **só totais**: gasto por categoria e mês, limites, "Quanto posso gastar", contas a pagar em valor e data. Nunca vão transações individuais, descrições, nomes de pessoas, contas ou saldos por conta, porque a camada grátis pode usar o conteúdo para treino. Perguntas sobre uma transação específica ("qual foi minha maior compra?") são respondidas com "veja na Análise". "Maiores gastos" fica fora do resumo da IA.
- **Testes nunca chamam a IA de verdade** (memória do projeto). A validação é com mocks e com o WhatsApp do João.
- O WhatsApp ainda não consegue responder até o chip brasileiro entrar (`docs/whatsapp-setup.md`). Perguntas pelo WhatsApp ficam prontas, mas só funcionam depois disso.
- O sync é serializado por usuário em memória, numa instância só. Os alarmes podem rodar no fim do sync.
- Ainda não há deploy: hoje a API roda no PC do João. Web Push funciona em `localhost`, mas o aviso "na hora" só chega com a API ligada. Com ela desligada, os alarmes saem no próximo sync. O valor completo vem com o deploy, que não faz parte deste projeto.

## Fica a cargo de quem construir

- Como a IA calcula a proposta de limite: média, mediana, quantos meses, se descarta extremos.
- Layout do sininho, do resumo no Início e do campo de pergunta, respeitando o layout do Início já decidido.
- Formato do contexto enviado à IA, desde que respeite a decisão de privacidade.
- Infra de Web Push: service worker, chaves VAPID, armazenamento das inscrições.
