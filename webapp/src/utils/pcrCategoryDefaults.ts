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
 *
 * The three "Operating Reserves" expense defaults below (operating fee,
 * development reserve, operating expense) are extracted with
 * `PcrStatementLine.section === 'other'` rather than `'expense'` -- they sit
 * before the PCR's own EXPENSES header opens -- but Compensation.tsx's sync
 * still matches expense-section mappings against 'other' lines too (just
 * without flagging an unmapped 'other' line, since most of that bucket is
 * revenue/balance rollups that were never meant to be categorized).
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
  { label: 'Payroll Taxes', section: 'expense', targetKey: 'payrollTaxes' },
  { label: 'Profit Sharing', section: 'expense', targetKey: 'profitSharing' },
  { label: 'Cash Balance Plan', section: 'expense', targetKey: 'cashBalance' },
  { label: 'Dental Insurance', section: 'expense', targetKey: 'healthDental' },
  { label: 'Medical Insurance', section: 'expense', targetKey: 'healthMedical' },
  { label: 'Vision Insurance', section: 'expense', targetKey: 'healthVision' },
  { label: 'Professional Liability-Physicians', section: 'expense', targetKey: 'liabilityInsurance' },
  { label: 'Telephone/Internet', section: 'expense', targetKey: 'phoneInternet' },
  { label: 'License/Dues', section: 'expense', targetKey: 'licensesDues' },
  { label: 'Corporate Development Reserve', section: 'expense', targetKey: 'developmentReserve' },
  { label: 'Corporate Operating Fee', section: 'expense', targetKey: 'operatingFee' },
  { label: 'Operating Expense', section: 'expense', targetKey: 'operatingExpense' },
]
