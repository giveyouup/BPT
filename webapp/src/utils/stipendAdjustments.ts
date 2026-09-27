import type { MonthlyReport, Settings } from '../types'
import { makeStubReport } from './pcrStipendCarveouts'

/**
 * A "stipend adjustment" is a signed dollar amount stored per date in
 * MonthlyReport.dayStipends (positive adds to that day's stipend, negative
 * reduces it -- e.g. someone else covered half a shift). Returns the reports
 * that need saving after setting `date`'s adjustment to `amount` (0 clears it):
 *   - the date's own month report gets the value (a stub is created if that
 *     month has no report yet);
 *   - the same date is removed from any other report that also carried it (the
 *     Dashboard can store an adjacent-month day on the month being viewed), so
 *     the amount is never counted twice;
 *   - a value edited by hand stops being an auto-placed PCR carve-out, so the
 *     carve-out bookkeeping for that date is dropped and a later upload won't replace it.
 */
export function applyDayAdjustment(
  allReports: MonthlyReport[],
  date: string,
  amount: number,
  physicianId: string,
  settings: Settings,
): MonthlyReport[] {
  const [y, m] = date.split('-').map(Number)
  const ownId = `${y}-${String(m).padStart(2, '0')}`
  const changed = new Map<string, MonthlyReport>()

  for (const r of allReports) {
    if (r.id === ownId || r.dayStipends?.[date] === undefined) continue
    const { [date]: _gone, ...rest } = r.dayStipends
    changed.set(r.id, { ...r, dayStipends: rest })
  }

  const own = allReports.find((r) => r.id === ownId)
  const base = own ?? makeStubReport(ownId, y, m, physicianId, settings)
  const dayStipends = { ...base.dayStipends }
  if (amount === 0) delete dayStipends[date]
  else dayStipends[date] = amount
  const next: MonthlyReport = { ...base, dayStipends }
  if (base.autoStipendCarveouts?.[date]) {
    const { [date]: _tag, ...rest } = base.autoStipendCarveouts
    next.autoStipendCarveouts = rest
  }
  // Nothing to record on a brand-new stub when clearing a value that never existed
  if (!own && amount === 0) return [...changed.values()]
  changed.set(ownId, next)
  return [...changed.values()]
}

/** Parses typed adjustment text: "-500", "$1,200.50", "(500)" (accounting negative). NaN when unusable. */
export function parseSignedAmount(text: string): number {
  const t = text.trim()
  if (!t) return NaN
  const negative = t.startsWith('-') || /^\(.*\)$/.test(t)
  const n = Number(t.replace(/[()$,\s-]/g, ''))
  return Number.isFinite(n) ? (negative ? -n : n) : NaN
}
