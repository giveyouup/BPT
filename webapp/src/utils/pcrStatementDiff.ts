import type { PcrIncomeStatement, PcrStatementLine } from '../types'

/** Line-level differences beyond tolerance ignore float/OCR-cent-level noise. */
const TOLERANCE = 1.0

export interface PcrLineDiff {
  label: string
  section: PcrStatementLine['section']
  oldAmount: number
  newAmount: number
}

export interface PcrMonthDiff {
  year: number
  month: number
  lines: PcrLineDiff[]
}

/**
 * Compares a freshly-extracted income-statement month against whatever is
 * already stored for that month (if anything), returning only the lines that
 * actually changed by more than a cent-level tolerance.
 *
 * Returns null for a brand-new month (nothing to diff against -- safe to
 * auto-apply) or when nothing changed beyond tolerance (also safe to
 * auto-apply, since re-saving identical data is a no-op). A non-null result
 * means the month's numbers were restated since the last upload and should
 * be reviewed before overwriting.
 */
export function diffPcrStatementMonth(
  existing: PcrIncomeStatement | undefined,
  fresh: { year: number; month: number; lines: PcrStatementLine[] }
): PcrMonthDiff | null {
  if (!existing) return null

  const oldByLabel = new Map(existing.lines.map(l => [l.label, l.amount]))
  const newByLabel = new Map(fresh.lines.map(l => [l.label, l.amount]))
  const sectionByLabel = new Map<string, PcrStatementLine['section']>()
  for (const l of existing.lines) sectionByLabel.set(l.label, l.section)
  for (const l of fresh.lines) sectionByLabel.set(l.label, l.section)

  const lines: PcrLineDiff[] = []
  for (const label of new Set([...oldByLabel.keys(), ...newByLabel.keys()])) {
    const oldAmount = oldByLabel.get(label) ?? 0
    const newAmount = newByLabel.get(label) ?? 0
    if (Math.abs(oldAmount - newAmount) < TOLERANCE) continue
    lines.push({ label, section: sectionByLabel.get(label)!, oldAmount, newAmount })
  }
  if (lines.length === 0) return null

  lines.sort((a, b) => a.label.localeCompare(b.label))
  return { year: fresh.year, month: fresh.month, lines }
}
