import * as XLSX from 'xlsx'
import type { StipendRate } from '../types'

export interface ParsedStipendSheet {
  sheetName: string
  detectedDate: string | null  // YYYY-MM-01 or null
  rates: StipendRate[]
}

const MONTH_NAMES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']

function extractDateFromSheetName(name: string): string | null {
  // YYYY-MM anywhere in the name (our export format always leads with this)
  const isoMatch = name.match(/\b(\d{4})-(\d{2})\b/)
  if (isoMatch) {
    const y = parseInt(isoMatch[1]), m = parseInt(isoMatch[2])
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12)
      return `${isoMatch[1]}-${isoMatch[2]}-01`
  }
  // "Jan 2025" or "January 2025"
  const mnyMatch = name.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-]+(\d{4})\b/)
  if (mnyMatch) {
    const m = MONTH_NAMES.indexOf(mnyMatch[1].slice(0, 3)) + 1
    const y = parseInt(mnyMatch[2])
    if (y >= 2000 && y <= 2100) return `${y}-${String(m).padStart(2, '0')}-01`
  }
  // "2025 Jan" or "2025 January"
  const ynmMatch = name.toLowerCase().match(/\b(\d{4})[\s\-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/)
  if (ynmMatch) {
    const y = parseInt(ynmMatch[1])
    const m = MONTH_NAMES.indexOf(ynmMatch[2].slice(0, 3)) + 1
    if (y >= 2000 && y <= 2100) return `${y}-${String(m).padStart(2, '0')}-01`
  }
  return null
}

function parseSheetRates(sheet: XLSX.WorkSheet): StipendRate[] {
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

/** Parse all sheets. Returns one entry per non-empty sheet. */
export function parseStipendMappings(buffer: ArrayBuffer): ParsedStipendSheet[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  return wb.SheetNames
    .map((sheetName) => ({
      sheetName,
      detectedDate: extractDateFromSheetName(sheetName),
      rates: parseSheetRates(wb.Sheets[sheetName]),
    }))
    .filter((s) => s.rates.length > 0)
}

/** Legacy single-sheet parse (first sheet only). */
export function parseStipendMapping(buffer: ArrayBuffer): StipendRate[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  return parseSheetRates(wb.Sheets[wb.SheetNames[0]])
}
