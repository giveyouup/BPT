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
 *
 * A handful of `otherIncome` and `expense` defaults below target a free-form
 * category name (e.g. "CASE Board", "Student Loan Reimbursement") rather than
 * a fixed leaf key -- Other Income has no fixed leaves at all, and these are
 * specific category names, not universal ones. They're included anyway
 * because Compensation's own sync auto-creates a same-named entry on first
 * apply if it doesn't already exist, so there's no dangling reference even on
 * a brand-new install -- just a specific naming choice a user is free to
 * rename or remap.
 *
 * `SMCS Weekend G3` / `Weekend Body IR` target *promoted* stipend columns
 * (webapp/src/utils/calculations.ts, STIPEND_PROMOTABLE_BASE_KEYS) rather
 * than a base group key. For these to mean anything, `G3::weekend` and
 * `BIR::weekday` must also be pre-promoted by default -- see
 * `DEFAULT_SETTINGS.promotedStipendCodes` in server/db.ts. Both stay fully
 * user-configurable: unpromoting the column in Stipend Calculator's Columns
 * popover, or remapping/removing the row here, works exactly as if the user
 * had set it up themselves.
 */
export const DEFAULT_PCR_CATEGORY_MAPPINGS: Array<{
  label: string
  section: 'stipend' | 'expense' | 'otherIncome'
  targetKey: string
}> = [
  { label: 'Acute Pain', section: 'stipend', targetKey: 'APS' },
  { label: 'Board Runner', section: 'stipend', targetKey: 'BR' },
  { label: 'Fort Sutter', section: 'stipend', targetKey: 'FS' },
  { label: 'ROC', section: 'stipend', targetKey: 'ROC' },
  { label: 'CV NIR', section: 'stipend', targetKey: 'NIR' },
  { label: 'CV Anesthesia', section: 'stipend', targetKey: 'NIR' },
  { label: 'SMCS General Call (1-2)', section: 'stipend', targetKey: 'mainOrCall' },
  { label: 'SMCS General Call (3-17)', section: 'stipend', targetKey: 'otherG' },
  { label: 'SMCS GI Weekend', section: 'stipend', targetKey: 'GI' },
  { label: 'Alhambra', section: 'stipend', targetKey: 'alhambra' },
  { label: 'SMCS Weekend G3', section: 'stipend', targetKey: 'G3::weekend' },
  { label: 'Weekend Body IR', section: 'stipend', targetKey: 'BIR::weekday' },
  { label: 'Payroll Taxes', section: 'expense', targetKey: 'payrollTaxes' },
  { label: 'Profit Sharing', section: 'expense', targetKey: 'profitSharing' },
  { label: 'Cash Balance Plan', section: 'expense', targetKey: 'cashBalance' },
  { label: 'Pension-Cash Balance', section: 'expense', targetKey: 'cashBalance' },
  { label: 'Dental Insurance', section: 'expense', targetKey: 'healthDental' },
  { label: 'Medical Insurance', section: 'expense', targetKey: 'healthMedical' },
  { label: 'Vision Insurance', section: 'expense', targetKey: 'healthVision' },
  { label: 'Medical Reimbursement-Benicomp', section: 'expense', targetKey: 'healthBenicomp' },
  { label: 'CME \\ Professional Development', section: 'expense', targetKey: 'cme' },
  { label: 'Professional Liability-Physicians', section: 'expense', targetKey: 'liabilityInsurance' },
  { label: 'Telephone/Internet', section: 'expense', targetKey: 'phoneInternet' },
  { label: 'License/Dues', section: 'expense', targetKey: 'licensesDues' },
  { label: 'Corporate Development Reserve', section: 'expense', targetKey: 'developmentReserve' },
  { label: 'Corporate Operating Fee', section: 'expense', targetKey: 'operatingFee' },
  { label: 'Operating Expense', section: 'expense', targetKey: 'operatingExpense' },
  { label: 'Student Loan Reimbursement-Cares Act', section: 'expense', targetKey: 'Student Loan Reimbursement' },
  { label: 'CASE Board / Chairs / Comm / Schedule', section: 'otherIncome', targetKey: 'CASE Board' },
  { label: 'CASE Board', section: 'otherIncome', targetKey: 'Director of Board' },
]
