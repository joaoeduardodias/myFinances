# Consultor: metas acompanhadas e indicadores — Design

Data: 2026-10-29. Continua `2026-10-27-consultor-ia-design.md`.

## Intenção

O João quer que o consultor o conduza cada vez melhor ao longo do tempo. O Gemini não guarda nada entre chamadas, então quem acumula o histórico é o app. Ele guarda as metas que o João aceitou, mede cada uma por regra e manda o resultado ao Gemini junto com indicadores já calculados.

## Metas (aprovado pelo João)

- O consultor propõe metas nas respostas do chat. Cada proposta aparece com um botão "Aceitar meta" e só vira meta quando o João clica. A IA nunca cria nem muda meta sozinha.
- Há dois tipos de meta:
  - **Teto de categoria**: gastar até R$ X por mês, numa das categorias de limite.
  - **Quanto sobra da renda**: guardar pelo menos X% da renda. Sobra = renda − essencial − evitável − emergência − dívida − sem classificação; o investido conta como sobra. Só existe com renda configurada.
- **Meta não é limite** (*minha chamada*, aceita): o limite é o alarme que vem do hábito, a meta é o corte combinado. A revisão de limites não mexe em meta.
- Pode haver uma meta ativa por categoria e uma de sobra. Uma meta nova do mesmo alvo encerra a anterior. O João pode encerrar qualquer meta.
- O acompanhamento é por regra, mês a mês, a partir do mês em que a meta foi aceita: cumpriu ou estourou, com o valor do mês. O mês atual aparece como parcial.
- As metas e o acompanhamento vão no pacote de toda pergunta e de todo resumo. Cumpriu dois meses seguidos: o consultor pode propor o próximo passo. Estourou: pode propor um alvo mais realista.
- As metas aparecem numa seção "Metas" do card do consultor, com o andamento do mês e o botão para encerrar (*minha chamada*, aceita).
- No WhatsApp, a resposta vem só em texto, sem proposta de meta.

## Indicadores no pacote

O app calcula e manda, por mês:
- a sobra em % da renda;
- o essencial em % da renda;
- a tendência da renda: média dos 3 últimos meses fechados contra a dos 3 anteriores. Fica estável quando a diferença é de até 5%;
- as categorias em alta contínua nos 3 últimos meses fechados.

Continuam indo só totais (decisão de privacidade da entrega 3).

## Card de conversa

O João pediu para melhorar a UI e a UX do card mantendo a linha atual: bolhas, sugestões de pergunta quando a conversa está vazia, indicador de "digitando", campo que cresce com o texto, contador perto do limite e envio por ícone.
