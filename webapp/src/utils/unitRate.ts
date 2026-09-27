import type { MonthlyReport, PcrIncomeStatement } from '../types'

// The PCR prints "$/unit" to two decimals, but the true rate has sub-cent
// digits -- across ~1,200 units a half-cent rounding is worth several dollars
// of unit pay. The income statement's "Professional Fees" line is the actual
// unit-pay total for that month, so the precise rate is recovered from it:
//     rate = Professional Fees / (total units + unit correction)
// The two-decimal `unitDollarValue` stays as the displayed/entered value; only
// pay math reads the precise one (via payUnitRate).

const TWO_DP_TOLERANCE = 0.005 + 1e-6  // a true rate always rounds to the printed one

function hasMoreThanTwoDecimals(v: number): boolean {
  return Math.abs(Math.round(v * 100) / 100 - v) > 1e-9
}

/** Sum of a statement's "Professional Fees" lines (hand-corrected amounts included), or null if absent. */
export function professionalFees(stmt: PcrIncomeStatement | undefined): number | null {
  if (!stmt) return null
  const matches = stmt.lines.filter((l) => l.label.trim().toLowerCase() === 'professional fees')
  return matches.length ? matches.reduce((s, l) => s + l.amount, 0) : null
}

/**
 * The precise $/unit implied by the month's income statement, or undefined when
 * it can't be trusted or isn't needed:
 *   - no statement / no Professional Fees line for the month
 *   - the report's $/unit was typed with more than two decimals (deliberate precision wins)
 *   - the implied rate doesn't round to the printed one (a misread fee or a
 *     non-unit-pay component -- better to keep the printed rate than skew pay)
 */
export function deriveEffectiveUnitValue(report: MonthlyReport, stmt: PcrIncomeStatement | undefined): number | undefined {
  const printed = report.unitDollarValue
  if (!printed || hasMoreThanTwoDecimals(printed)) return undefined
  const fees = professionalFees(stmt)
  if (fees === null || fees <= 0) return undefined
  const units = report.lineItems.reduce((s, li) => s + li.totalDistributableUnits, 0) + (report.unitCorrection ?? 0)
  if (units <= 0) return undefined
  const rate = fees / units
  return Math.abs(rate - printed) <= TWO_DP_TOLERANCE ? rate : undefined
}

/** Attaches the derived precise rate (never persisted) to each report that has one. */
export function withEffectiveUnitValues(reports: MonthlyReport[], statements: PcrIncomeStatement[]): MonthlyReport[] {
  const byId = new Map(statements.map((s) => [s.id, s]))
  return reports.map((r) => {
    const rate = deriveEffectiveUnitValue(r, byId.get(r.id))
    return rate === undefined ? r : { ...r, effectiveUnitValue: rate }
  })
}

/** The $/unit to multiply units by for pay: the precise rate when known, else the printed one. */
export function payUnitRate(report: Pick<MonthlyReport, 'unitDollarValue' | 'effectiveUnitValue'>): number {
  return report.effectiveUnitValue ?? report.unitDollarValue ?? 0
}
