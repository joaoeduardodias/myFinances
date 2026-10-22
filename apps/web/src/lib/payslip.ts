/** '2026-10' em '10/2026'. */
export function formatCompetence(competence: string): string {
  const [year, month] = competence.split('-')
  return `${month}/${year}`
}
