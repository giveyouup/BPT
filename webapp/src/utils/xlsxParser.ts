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
// The raw export has header/title rows before data, 31 sparse columns, and a
// footer with grand totals + search criteria. The label row contains keywords
// like "Incident ID", "Service Dt", "Ticket Num", etc. at the column positions
// that mostly match the data — except "Service Dt" (label col+2) and "Ticket
// Num" (label col+1) due to merged cells in the original XLS.

const RAW_COLS_DEFAULT = {
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

type RawCols = typeof RAW_COLS_DEFAULT

function findRawCols(rows: unknown[][]): RawCols {
  // Scan for the header label row — identified by "Incident ID" in col 0
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r]
    if (String(row?.[0] ?? '').trim().toLowerCase() !== 'incident id') continue

    // Build column map from this row's keyword positions
    const map: Partial<Record<keyof RawCols, number>> = {}
    map.incidentId = 0
    for (let c = 1; c < row.length; c++) {
      const cell = String(row[c] ?? '').trim().toLowerCase()
      if (cell === 'service dt')             map.serviceDate  = c + 2  // merged-cell offset
      else if (cell === 'ticket num')        map.ticketNum    = c + 1  // merged-cell offset
      else if (cell === 'cpt/asa')           map.cptAsa       = c
      else if (cell === 'modifier')          map.modifier     = c
      else if (cell.includes('unit value'))  map.unitValue    = c
      else if (cell.includes('age value'))   map.ageValue     = c
      else if (cell === 'time units')        map.timeUnits    = c
    }
    // Scan the combined row (r-1) for multi-row header labels
    const rowAbove = rows[r - 1] ?? []
    for (let c = 0; c < rowAbove.length; c++) {
      const cell = String(rowAbove[c] ?? '').trim().toLowerCase()
      if (cell === 'distribution')           map.distributionValue      = c
      else if (cell === 'start')             map.startTime              = c
      else if (cell === 'end')               map.endTime                = c
      else if (cell === 'total distrib')     map.totalDistributableUnits = c
      // "Total" label sits above the Total Time column, but only if not already "Total Distrib"
    }
    // "Total Time" shares row r-1 label "Total" — find it between endTime and timeUnits
    if (map.endTime != null && map.timeUnits != null) {
      map.totalTime = map.endTime + 3  // consistent offset in both files
    }

    // If we found enough columns, use the dynamic map; otherwise fall back
    const required: (keyof RawCols)[] = ['serviceDate', 'ticketNum', 'cptAsa', 'distributionValue', 'timeUnits', 'totalDistributableUnits']
    if (required.every((k) => map[k] != null)) {
      return { ...RAW_COLS_DEFAULT, ...map } as RawCols
    }
    break
  }
  return RAW_COLS_DEFAULT
}

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
  const cols = findRawCols(rows)
  const items: LineItem[] = []
  for (const row of rows) {
    const incidentRaw = row[cols.incidentId]
    if (typeof incidentRaw !== 'number' || incidentRaw < 100000) continue
    items.push({
      incidentId:              String(Math.round(incidentRaw)),
      serviceDate:             parseServiceDate(row[cols.serviceDate]),
      ticketNum:               String(row[cols.ticketNum] ?? '').trim(),
      cptAsa:                  String(row[cols.cptAsa] ?? '').trim(),
      modifier:                row[cols.modifier] != null ? String(row[cols.modifier]).trim() : '',
      unitValue:               parseNum(row[cols.unitValue]),
      distributionValue:       parseNum(row[cols.distributionValue]) ?? 0,
      startTime:               parseTime(row[cols.startTime]),
      endTime:                 parseTime(row[cols.endTime]),
      totalTime:               parseTime(row[cols.totalTime]),
      timeUnits:               parseNum(row[cols.timeUnits]) ?? 0,
      totalDistributableUnits: parseNum(row[cols.totalDistributableUnits]) ?? 0,
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
