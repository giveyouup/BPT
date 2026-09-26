import type { PcrIncomeStatement, PcrStatementLine } from '../types'

type Section = PcrStatementLine['section']

/** True for a line a person changed or typed in (as opposed to pure OCR output). */
export const isHandEdited = (line: PcrStatementLine): boolean => !!line.ocr || !!line.added

const originalOf = (line: PcrStatementLine) => line.ocr ?? { label: line.label, section: line.section, amount: line.amount }

/**
 * Stable identities for a statement's OCR-derived lines: "section|label|n",
 * where n counts repeats of the same original section+label (the PCR prints
 * e.g. "PCR Surplus/(Deficit)" twice). Built from the ORIGINAL OCR values, so
 * a line keeps its identity after its label/section/amount are hand-edited.
 * Hand-added lines have none.
 */
function assignKeys(lines: PcrStatementLine[]): (string | null)[] {
  const counts = new Map<string, number>()
  return lines.map((l) => {
    if (l.added) return null
    const o = originalOf(l)
    const base = `${o.section}|${o.label}`
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    return `${base}|${n}`
  })
}

function withLines(stmt: PcrIncomeStatement, lines: PcrStatementLine[], deletedKeys = stmt.deletedKeys): PcrIncomeStatement {
  const { deletedKeys: _drop, ...rest } = stmt
  return deletedKeys?.length ? { ...rest, lines, deletedKeys } : { ...rest, lines }
}

/** Applies a hand edit to one line, remembering what the OCR originally read. */
export function editLine(
  stmt: PcrIncomeStatement,
  index: number,
  patch: Partial<Pick<PcrStatementLine, 'label' | 'section' | 'amount'>>,
): PcrIncomeStatement {
  const lines = stmt.lines.map((line, i) => {
    if (i !== index) return line
    const next = { ...line, ...patch }
    if (line.added) return next
    const o = originalOf(line)
    const same = next.label === o.label && next.section === o.section && next.amount === o.amount
    const { ocr: _o, ...bare } = next
    return same ? bare : { ...bare, ocr: o }
  })
  return withLines(stmt, lines)
}

/** Puts a line back to what the OCR read (no-op for hand-added lines). */
export function revertLine(stmt: PcrIncomeStatement, index: number): PcrIncomeStatement {
  const line = stmt.lines[index]
  if (!line?.ocr) return stmt
  const { ocr, ...bare } = line
  return withLines(stmt, stmt.lines.map((l, i) => (i === index ? { ...bare, ...ocr } : l)))
}

export function deleteLine(stmt: PcrIncomeStatement, index: number): PcrIncomeStatement {
  const line = stmt.lines[index]
  if (!line) return stmt
  const keys = assignKeys(stmt.lines)
  const lines = stmt.lines.filter((_, i) => i !== index)
  const key = keys[index]
  return withLines(stmt, lines, key ? [...(stmt.deletedKeys ?? []), key] : stmt.deletedKeys)
}

export function addLine(
  stmt: PcrIncomeStatement,
  line: { label: string; section: Section; amount: number },
): PcrIncomeStatement {
  return withLines(stmt, [...stmt.lines, { ...line, added: true }])
}

/**
 * Lays a fresh extraction over what's stored for the same month without
 * losing hand work: edited lines keep their corrected values, hand-added lines
 * stay, and hand-deleted lines stay deleted. Everything else takes the new
 * OCR output. With nothing stored, the fresh lines pass through untouched.
 */
export function mergeFreshWithEdits(
  existing: PcrIncomeStatement | undefined,
  freshLines: PcrStatementLine[],
): { lines: PcrStatementLine[]; deletedKeys?: string[] } {
  if (!existing || !(existing.deletedKeys?.length || existing.lines.some(isHandEdited))) {
    return { lines: freshLines }
  }
  const deleted = new Set(existing.deletedKeys ?? [])
  const existingKeys = assignKeys(existing.lines)
  const editedByKey = new Map<string, PcrStatementLine>()
  existing.lines.forEach((l, i) => { if (l.ocr && existingKeys[i]) editedByKey.set(existingKeys[i]!, l) })

  const freshKeys = assignKeys(freshLines)
  const used = new Set<string>()
  const lines: PcrStatementLine[] = []
  freshLines.forEach((l, i) => {
    const k = freshKeys[i]!
    if (deleted.has(k)) return
    const edited = editedByKey.get(k)
    if (edited) {
      used.add(k)
      // Keep what was corrected, but track the PDF's latest reading; a line whose
      // amount was never touched (only its label/section) follows the new amount.
      const amountEdited = edited.amount !== edited.ocr!.amount
      lines.push({ ...edited, amount: amountEdited ? edited.amount : l.amount, ocr: { ...edited.ocr!, amount: l.amount } })
    } else lines.push(l)
  })
  // Corrected lines whose original the new PDF no longer shows, and lines typed in by hand
  existing.lines.forEach((l, i) => {
    if (l.added || (l.ocr && !used.has(existingKeys[i]!))) lines.push(l)
  })
  return { lines, deletedKeys: existing.deletedKeys }
}
