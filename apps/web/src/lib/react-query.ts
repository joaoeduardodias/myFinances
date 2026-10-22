import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Voltar à aba refazia toda consulta da tela — o relatório lê o rebanho
      // inteiro. Com 30 s de frescor, o foco só busca de novo o que envelheceu.
      staleTime: 30_000,
      // Mas abrir uma tela continua buscando sempre: as mutações invalidam só
      // o próprio domínio (pesagem não invalida o painel), e com o frescor
      // valendo na navegação o painel mostraria número velho.
      refetchOnMount: 'always',
    },
  },
})
