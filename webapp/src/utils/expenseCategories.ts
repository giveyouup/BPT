/**
 * AnnualExpenses' fixed leaf categories (Compensation.tsx's Cash Compensation,
 * Business Expenses, Benefits, and Retirement Benefits sections) -- shared so
 * the PCR Category Mapping page can offer the exact same categories as its
 * expense target-key dropdown, rather than a second, driftable copy of the
 * list.
 */
export type Leaf = { key: string; label: string }
export type BenefitsLeaf = Leaf & { subGroup?: string }

// Physician Salary and these reimbursements are cash that lands directly in
// the physician's own bank account -- unlike the rest of Benefits (health
// insurance premiums, paid to a third party) or Business Expenses (paid by
// the practice on the physician's behalf), this is the practice's own record
// of what it has already disbursed as pay. Compensation.tsx uses it to
// compute Cash Compensation directly (Physician Salary + Cash
// Reimbursements) rather than as a pure leftover, with the gap against the
// true total surfaced explicitly as an "Outstanding Salary Balance" line
// (see Compensation.tsx) instead of being silently absorbed.
export const CASH_COMP_LEAVES: BenefitsLeaf[] = [
  { key: 'salary',           label: 'Physician Salary' },
  { key: 'healthBenicomp',   label: 'Benicomp',         subGroup: 'Cash Reimbursements' },
  { key: 'cme',              label: 'CME',              subGroup: 'Cash Reimbursements' },
  { key: 'businessMeetings', label: 'Business Meetings', subGroup: 'Cash Reimbursements' },
  { key: 'phoneInternet',    label: 'Phone / Internet', subGroup: 'Cash Reimbursements' },
  { key: 'studentLoanReimbursement', label: 'Student Loan Reimbursement', subGroup: 'Cash Reimbursements' },
  { key: 'equipmentSupplies',        label: 'Equipment and Supplies',     subGroup: 'Cash Reimbursements' },
]

export const BUSINESS_LEAVES: Leaf[] = [
  { key: 'operatingFee',       label: 'Operating Fee (7%)'    },
  { key: 'operatingExpense',   label: 'Operating Expense'     },
  { key: 'developmentReserve', label: 'Development Fee (10%)' },
  { key: 'payrollTaxes',       label: 'Payroll Taxes'         },
  { key: 'liabilityInsurance', label: 'Liability Insurance'   },
]

export const BENEFITS_LEAVES: BenefitsLeaf[] = [
  { key: 'healthDental',   label: 'Dental',           subGroup: 'Health Insurance' },
  { key: 'healthMedical',  label: 'Medical',          subGroup: 'Health Insurance' },
  { key: 'healthVision',   label: 'Vision',           subGroup: 'Health Insurance' },
  { key: 'licensesDues',  label: 'Licenses & Dues'  },
]

export const RETIREMENT_LEAVES: Leaf[] = [
  { key: 'profitSharing', label: 'Profit Sharing' },
  { key: 'cashBalance',   label: 'Cash Balance'   },
]

export const ALL_LEAVES = [...CASH_COMP_LEAVES, ...BUSINESS_LEAVES, ...BENEFITS_LEAVES, ...RETIREMENT_LEAVES]
export const LEAF_LABELS = Object.fromEntries(ALL_LEAVES.map(l => [l.key, l.label])) as Record<string, string>

export const CASH_COMP_KEYS = new Set(CASH_COMP_LEAVES.map((l) => l.key))
export const BUSINESS_KEYS = new Set(BUSINESS_LEAVES.map((l) => l.key))
export const BENEFITS_KEYS = new Set(BENEFITS_LEAVES.map((l) => l.key))
export const RETIREMENT_KEYS = new Set(RETIREMENT_LEAVES.map((l) => l.key))

// Every fixed leaf key across all four sections, plus the two Practice
// Reconciliation fields -- these all live directly in AnnualExpenses.recurring
// (as opposed to a free-form category, which lives in one of the entries[]
// arrays instead). Shared by Compensation.tsx (which key to write to on blur,
// and when pruning stale keys) and utils/pcrExpenseSync.ts (same distinction,
// for PCR sync).
export const KNOWN_RECURRING_KEYS = new Set([
  ...CASH_COMP_KEYS, ...BUSINESS_KEYS, ...BENEFITS_KEYS, ...RETIREMENT_KEYS,
  'carryforwardIn', 'yearEndBalance',
])
