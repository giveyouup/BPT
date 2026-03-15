import * as XLSX from 'xlsx'
import type { LineItem } from '../types'
import { excelSerialToISODate } from './dateUtils'

function parseTime(val: unknown): string | null {
  if (val == null || val === '') return null
  if (typeof val === 'string') {
    const t = val.trim()
    if (/^\d{1,2}:\d{2}$/.test(t)) return t.padStart(5, '0')
    return null
  }
  if (typeof val === 'number') {
    // Excel time fraction: 0.5 = 12:00:00
    const totalMins = Math.round(val * 24 * 60)
    const h = Math.floor(totalMins / 60) % 24
    const m = totalMins % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  return null
}

function parseNum(val: unknown): number | null {
  if (val == null || val === '') return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

function parseServiceDate(val: unknown): string {
  if (typeof val === 'number') return excelSerialToISODate(val)
  return String(val ?? '')
}

// ─── Raw Case Distribution Report format (PHIMED) ────────────────────────────
//
// The raw export has 9 title/header rows before data, 31 columns (many null),
// and a footer with grand totals + search criteria. Column layout is fixed:

const RAW_COLS = {
  incidentId:              0,
  serviceDate:             6,
  ticketNum:               9,
  cptAsa:                 11,
  modifier:               12,
  unitValue:              14,
  distributionValue:      16,
  ageValue:               18,
  startTime:              20,
  endTime:                22,
  totalTime:              25,
  timeUnits:              26,
  totalDistributableUnits: 30,
} as const

function isRawFormat(rows: unknown[][]): boolean {
  // Clean format: row 0 col 0 is "Incident ID"
  if (String(rows[0]?.[0] ?? '').trim().toLowerCase() === 'incident id') return false
  // Raw format: data rows (large integers in col 0) don't start until row 8+
  for (let i = 8; i < Math.min(rows.length, 20); i++) {
    const val = rows[i]?.[0]
    if (typeof val === 'number' && val > 100000) return true
  }
  return false
}

function parseRawRows(rows: unknown[][]): LineItem[] {
  const items: LineItem[] = []
  for (const row of rows) {
    const incidentRaw = row[RAW_COLS.incidentId]
    if (typeof incidentRaw !== 'number' || incidentRaw < 100000) continue
    items.push({
      incidentId:              String(Math.round(incidentRaw)),
      serviceDate:             parseServiceDate(row[RAW_COLS.serviceDate]),
      ticketNum:               String(row[RAW_COLS.ticketNum] ?? '').trim(),
      cptAsa:                  String(row[RAW_COLS.cptAsa] ?? '').trim(),
      modifier:                row[RAW_COLS.modifier] != null ? String(row[RAW_COLS.modifier]).trim() : '',
      unitValue:               parseNum(row[RAW_COLS.unitValue]),
      distributionValue:       parseNum(row[RAW_COLS.distributionValue]) ?? 0,
      startTime:               parseTime(row[RAW_COLS.startTime]),
      endTime:                 parseTime(row[RAW_COLS.endTime]),
      totalTime:               parseTime(row[RAW_COLS.totalTime]),
      timeUnits:               parseNum(row[RAW_COLS.timeUnits]) ?? 0,
      totalDistributableUnits: parseNum(row[RAW_COLS.totalDistributableUnits]) ?? 0,
    })
  }
  return items
}

// Scan footer rows for "Posted Date from MM/DD/YYYY to MM/DD/YYYY"
function detectMonthFromRows(rows: unknown[][]): { month: number; year: number } | null {
  for (const row of rows) {
    for (const cell of row) {
      const s = String(cell ?? '')
      const m = s.match(/posted date from\s+(\d{2})\/(\d{2})\/(\d{4})/i)
      if (m) return { month: parseInt(m[1]), year: parseInt(m[3]) }
    }
  }
  return null
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isRawXlsx(buffer: ArrayBuffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: 'array' })
    const wsName = wb.SheetNames.find((n) => n !== 'Claude Cache') ?? wb.SheetNames[0]
    const ws = wb.Sheets[wsName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null })
    return isRawFormat(rows)
  } catch {
    return false
  }
}

const CLEAN_HEADERS = [
  'IncidentID', 'ServiceDt', 'TicketNum', 'CPT/ASA', 'Modifier',
  'UnitValue', 'DistributionValue', 'AgeValue',
  'StartTime', 'EndTime', 'TotalTime', 'TimeUnits', 'TotalDistributableUnits',
]

export function exportCleanXlsx(items: LineItem[], filename: string): void {
  const rows: unknown[][] = [CLEAN_HEADERS]
  for (const li of items) {
    rows.push([
      li.incidentId,
      li.serviceDate,
      li.ticketNum,
      li.cptAsa,
      li.modifier,
      li.unitValue,
      li.distributionValue,
      null,                       // AgeValue — not captured from raw
      li.startTime,
      li.endTime,
      li.totalTime,
      li.timeUnits,
      li.totalDistributableUnits,
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

export function parseXlsx(buffer: ArrayBuffer): LineItem[] {
  const wb = XLSX.read(buffer, { type: 'array' })

  // Use Sheet1, skip the Claude Cache sheet
  const wsName =
    wb.SheetNames.find((n) => n !== 'Claude Cache') ?? wb.SheetNames[0]
  const ws = wb.Sheets[wsName]

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
  })

  if (rows.length < 2) throw new Error('No data found in spreadsheet')

  // Auto-detect raw PHIMED Case Distribution Report format
  if (isRawFormat(rows)) return parseRawRows(rows)

  // ── Clean/compact format (existing logic) ──────────────────────────────────
  // Col indices: 0=IncidentID, 1=ServiceDt, 2=TicketNum, 3=CPT/ASA,
  // 4=Modifier, 5=UnitValue, 6=DistributionValue, 7=AgeValue,
  // 8=StartTime, 9=EndTime, 10=TotalTime, 11=TimeUnits, 12=TotalDistributableUnits

  const items: LineItem[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.every((c) => c == null)) continue

    const incidentRaw = row[0]
    const incidentId =
      typeof incidentRaw === 'number'
        ? String(Math.round(incidentRaw))
        : String(incidentRaw ?? '')

    items.push({
      incidentId,
      serviceDate:             parseServiceDate(row[1]),
      ticketNum:               String(row[2] ?? '').trim(),
      cptAsa:                  String(row[3] ?? '').trim(),
      modifier:                row[4] != null ? String(row[4]).trim() : '',
      unitValue:               parseNum(row[5]),
      distributionValue:       parseNum(row[6]) ?? 0,
      startTime:               parseTime(row[8]),
      endTime:                 parseTime(row[9]),
      totalTime:               parseTime(row[10]),
      timeUnits:               parseNum(row[11]) ?? 0,
      totalDistributableUnits: parseNum(row[12]) ?? 0,
    })
  }

  return items
}

// Attempt to detect month/year from filename like "January 2026.xlsx"
export function detectMonthYear(
  filename: string
): { month: number; year: number } | null {
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ]
  const lower = filename.toLowerCase().replace(/\.[^.]+$/, '')
  const yearMatch = lower.match(/\b(20\d{2})\b/)
  const year = yearMatch ? parseInt(yearMatch[1]) : null
  const monthIdx = monthNames.findIndex((m) => lower.includes(m))
  if (year && monthIdx >= 0) {
    return { month: monthIdx + 1, year }
  }
  return null
}

// Detect month/year from raw file content (reads the "Posted Date" footer line).
// Call this after parseXlsx if detectMonthYear(filename) returns null.
export function detectMonthYearFromBuffer(buffer: ArrayBuffer): { month: number; year: number } | null {
  try {
    const wb = XLSX.read(buffer, { type: 'array' })
    const wsName = wb.SheetNames.find((n) => n !== 'Claude Cache') ?? wb.SheetNames[0]
    const ws = wb.Sheets[wsName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null })
    return detectMonthFromRows(rows)
  } catch {
    return null
  }
}
