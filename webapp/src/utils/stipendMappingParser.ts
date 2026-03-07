import * as XLSX from 'xlsx'
import type { StipendRate } from '../types'

export function parseStipendMapping(buffer: ArrayBuffer): StipendRate[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  const rates: StipendRate[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue
    const shiftType = String(row[0] ?? '').trim()
    const rawAmount = row[1]
    const amount = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount ?? ''))
    if (!shiftType || isNaN(amount) || amount === 0) continue
    rates.push({ shiftType, amount })
  }
  return rates
}
