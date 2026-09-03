import type { MonthlyReport, Schedule, PcrCategoryMapping, PcrIncomeStatement, Settings, StipendMapping } from '../types'
import { classifyStipendBase, computeShiftStipendTotals } from './calculations'
import { resolveShiftAlias, isOffDayShift } from './shiftUtils'
import { resolvePcrCategoryMapping } from './pcrCategoryMatching'

// Fort Sutter and Alhambra are paid as a lump monthly amount on the PCR rather
// than computed per-shift, so there's no rate-sheet portion to net out --
// the PCR's own paid amount IS the correct "Additional Stipend" number.
//
// ROC is different: it has BOTH a per-shift rate-sheet stipend AND a variable
// lump sum on top, but the PCR reports only their combined total. Carrying
// the full PCR total into "Additional Stipend" would double-count the
// per-shift portion (StipendCalculator/the audit already add the rate-sheet
// amount separately) -- so for ROC only the excess over
// computeShiftStipendTotals()'s rate-sheet-derived amount is carved out.
const CARVEOUT_GROUPS = ['FS', 'ROC', 'alhambra'] as const
type CarveoutGroup = typeof CARVEOUT_GROUPS[number]

/** Earliest date in (year, month) whose schedule includes a shift classified into `group`. */
function findFirstShiftDate(year: number, month: number, group: string, allSchedules: Schedule[]): string | null {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`
  let earliest: string | null = null
  for (const sched of allSchedules) {
    for (const entry of sched.entries) {
      if (!entry.date.startsWith(prefix)) continue
      if (earliest !== null && entry.date >= earliest) continue
      const matches = entry.shiftTypes.some((raw) => {
        if (isOffDayShift(raw)) return false
        return classifyStipendBase(resolveShiftAlias(raw.toUpperCase())) === group
      })
      if (matches) earliest = entry.date
    }
  }
  return earliest
}

function makeStubReport(id: string, year: number, month: number, physicianId: string, settings: Settings): MonthlyReport {
  return {
    id, year, month,
    physicianId,
    filename: `stub-${id}`,
    uploadDate: new Date().toISOString(),
    unitDollarValue: 0,
    paddingMinutes: settings.defaultPaddingMinutes,
    defaultNoTimeHours: settings.defaultNoTimeHours,
    lineItems: [],
    workingDayOverrides: {},
    dayStipends: {},
    stipends: [],
  }
}

/**
 * Carries a PCR income statement's Fort Sutter / ROC / Alhambra stipend
 * amounts (identified via PcrCategoryMapping) into the "Additional Stipend"
 * entry for the first matching shift day of the source month -- one month
 * prior to the PCR's own printed month, per its payout lag -- instead of the
 * user having to look up and type each one in on the Dashboard by hand.
 *
 * Idempotent: previously-applied carveouts for a group are tracked
 * (date -> group) on the source report and cleared before a fresh one is
 * written, so re-running this (a corrected re-upload, or a schedule edit that
 * moves which day is "first") doesn't leave a stale duplicate amount behind.
 *
 * Returns the updated report to be saved, or null if there was nothing to
 * apply (no FS/ROC/Alhambra line mapped in this statement) or nothing changed.
 */
export function applyPcrStipendCarveouts(
  statement: PcrIncomeStatement,
  mappings: PcrCategoryMapping[],
  allReports: MonthlyReport[],
  allSchedules: Schedule[],
  physicianId: string,
  settings: Settings,
  stipendMappings: StipendMapping[],
): MonthlyReport | null {
  const sourceMonth = statement.month === 1 ? 12 : statement.month - 1
  const sourceYear = statement.month === 1 ? statement.year - 1 : statement.year
  const sourceId = `${sourceYear}-${String(sourceMonth).padStart(2, '0')}`

  const amounts: Partial<Record<CarveoutGroup, number>> = {}
  for (const line of statement.lines) {
    if (line.section !== 'stipend') continue
    const mapping = resolvePcrCategoryMapping(line.label, 'stipend', mappings)
    if (!mapping) continue
    if ((CARVEOUT_GROUPS as readonly string[]).includes(mapping.targetKey)) {
      const key = mapping.targetKey as CarveoutGroup
      amounts[key] = (amounts[key] ?? 0) + line.amount
    }
  }
  if (Object.keys(amounts).length === 0) return null

  if (amounts.ROC !== undefined) {
    const shiftOnly = computeShiftStipendTotals(
      sourceYear, sourceMonth, allReports, allSchedules, settings, stipendMappings, settings.promotedStipendCodes ?? [],
    )
    amounts.ROC = Math.round((amounts.ROC - (shiftOnly.ROC ?? 0)) * 100) / 100
  }

  const existing = allReports.find((r) => r.id === sourceId)
  const report = existing ?? makeStubReport(sourceId, sourceYear, sourceMonth, physicianId, settings)

  const dayStipends = { ...report.dayStipends }
  const carveouts = { ...(report.autoStipendCarveouts ?? {}) }
  let changed = false

  for (const [group, amount] of Object.entries(amounts) as [CarveoutGroup, number][]) {
    // Clear any previous carve-out for this group first (a corrected re-upload,
    // or a schedule edit that moves which day is "first", shouldn't leave a
    // stale duplicate sitting on the old date).
    for (const [date, g] of Object.entries(carveouts)) {
      if (g === group) { delete dayStipends[date]; delete carveouts[date]; changed = true }
    }
    if (amount <= 0) continue // nothing to (re)apply -- same as Dashboard's own $0-clears-the-entry rule
    const targetDate = findFirstShiftDate(sourceYear, sourceMonth, group, allSchedules)
    if (!targetDate) continue // no matching shift this month -- nothing to attach to
    dayStipends[targetDate] = amount
    carveouts[targetDate] = group
    changed = true
  }

  if (!changed) return null
  return { ...report, dayStipends, autoStipendCarveouts: carveouts }
}

/**
 * Bulk variant for manually re-applying carveouts across every saved PCR
 * income statement at once (e.g. after adding/changing a Fort Sutter/ROC/
 * Alhambra mapping so historical months, ingested before the mapping
 * existed, get backfilled too). Returns only the reports that actually
 * changed, ready to be saved.
 */
export function applyPcrStipendCarveoutsForAllStatements(
  statements: PcrIncomeStatement[],
  mappings: PcrCategoryMapping[],
  allReports: MonthlyReport[],
  allSchedules: Schedule[],
  physicianId: string,
  settings: Settings,
  stipendMappings: StipendMapping[],
): MonthlyReport[] {
  const updated: MonthlyReport[] = []
  let working = allReports
  for (const statement of statements) {
    const result = applyPcrStipendCarveouts(statement, mappings, working, allSchedules, physicianId, settings, stipendMappings)
    if (!result) continue
    updated.push(result)
    working = [...working.filter((r) => r.id !== result.id), result]
  }
  return updated
}
