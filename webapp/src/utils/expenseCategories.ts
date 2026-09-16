/**
 * AnnualExpenses' fixed leaf categories (Compensation.tsx's Business Expenses,
 * Benefits, and Retirement Benefits sections) -- shared so the PCR Category
 * Mapping page can offer the exact same categories as its expense
 * target-key dropdown, rather than a second, driftable copy of the list.
 */
export type Leaf = { key: string; label: string }
export type BenefitsLeaf = Leaf & { subGroup?: string }

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
  { key: 'healthBenicomp', label: 'Benicomp',         subGroup: 'Health Insurance' },
  { key: 'licensesDues',  label: 'Licenses & Dues'  },
  { key: 'cme',           label: 'CME'              },
  { key: 'phoneInternet', label: 'Phone / Internet' },
]

export const RETIREMENT_LEAVES: Leaf[] = [
  { key: 'profitSharing', label: 'Profit Sharing' },
  { key: 'cashBalance',   label: 'Cash Balance'   },
]

export const ALL_LEAVES = [...BUSINESS_LEAVES, ...BENEFITS_LEAVES, ...RETIREMENT_LEAVES]
export const LEAF_LABELS = Object.fromEntries(ALL_LEAVES.map(l => [l.key, l.label])) as Record<string, string>

export const BUSINESS_KEYS = new Set(BUSINESS_LEAVES.map((l) => l.key))
export const BENEFITS_KEYS = new Set(BENEFITS_LEAVES.map((l) => l.key))
export const RETIREMENT_KEYS = new Set(RETIREMENT_LEAVES.map((l) => l.key))

// Most Benefits categories (health insurance premiums, retirement
// contributions) are paid to a third party -- real economic value, but never
// cash the physician can spend. These three are cash reimbursements/
// allowances that land directly in the physician's own bank account instead,
// so Compensation.tsx folds them into Net Income rather than the (non-cash)
// Benefits total. Hardcoded rather than user-configurable per category for
// now -- see webapp/src/pages/Compensation.tsx's benefitsTotal computation.
export const CASH_BENEFIT_KEYS = new Set(['healthBenicomp', 'cme', 'phoneInternet'])
