import type { PcrCategoryMapping } from '../types'

/**
 * Resolves a PCR-printed line label to a mapping via case-insensitive substring
 * match (see PcrCategoryMapping.label doc in types.ts) restricted to one section.
 * When multiple mappings match, the most specific (longest label) one wins.
 * Shared by Audits.tsx (stipend audit), Compensation.tsx (expense sync), and
 * PcrCategoryMappingPage.tsx (surfacing unmapped labels) so all three agree on
 * what "mapped" means.
 */
export function resolvePcrCategoryMapping(
  label: string,
  section: 'stipend' | 'expense',
  mappings: PcrCategoryMapping[]
): PcrCategoryMapping | null {
  const lower = label.toLowerCase()
  const matches = mappings.filter(m => m.section === section && lower.includes(m.label.toLowerCase()))
  if (matches.length === 0) return null
  return matches.reduce((best, m) => (m.label.length > best.label.length ? m : best))
}
