/**
 * Default PCR income-statement label -> internal category mappings.
 *
 * `label` is matched as a case-insensitive substring against the PCR's own
 * printed line label (not an exact match) -- e.g. "Acute Pain" matches the
 * real printed label "SMCS Acute Pain". This is deliberately loose: PCR
 * labels have shown minor prefix variation between report periods, and a
 * short, distinctive substring is more robust to that than requiring an
 * exact match.
 *
 * Stipend `targetKey` values are StipendCalculator's own internal group
 * keys (webapp/src/pages/StipendCalculator.tsx, classifyBase()/
 * getStipendGroup()), not free text -- they must match exactly for the
 * PCR Audit to compare paid-vs-owed correctly.
 */
export const DEFAULT_PCR_CATEGORY_MAPPINGS: Array<{
  label: string
  section: 'stipend' | 'expense'
  targetKey: string
}> = [
  { label: 'Acute Pain', section: 'stipend', targetKey: 'APS' },
  { label: 'Board Runner', section: 'stipend', targetKey: 'BR' },
  { label: 'Fort Sutter', section: 'stipend', targetKey: 'FS' },
  { label: 'ROC', section: 'stipend', targetKey: 'ROC' },
  { label: 'CV NIR', section: 'stipend', targetKey: 'NIR' },
  { label: 'CV Anesthesia', section: 'stipend', targetKey: 'NIR' },
  { label: 'SMCS General Call (1-2)', section: 'stipend', targetKey: 'mainOrCall' },
]
