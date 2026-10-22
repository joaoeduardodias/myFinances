import '@testing-library/jest-dom'

// jsdom não tem matchMedia, que o useIsMobile da sidebar consulta. innerWidth
// é 1024 aqui, então o stub responde como o desktop que os testes assumem.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia
