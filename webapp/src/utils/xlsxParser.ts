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

export function parseXlsx(buffer: ArrayBuffer): LineItem[] {
  const wb = XLSX.read(buffer, { type: 'array' })

  // Use Sheet1, skip the Claude Cache sheet
  const wsName =
    wb.SheetNames.find((n) => n !== 'Claude Cache') ?? wb.SheetNames[0]
  const ws = wb.Sheets[wsName]

  // raw:true preserves original types; header:1 gives array-of-arrays
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
  })

  if (rows.length < 2) throw new Error('No data found in spreadsheet')

  const items: LineItem[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.every((c) => c == null)) continue

    // Col indices (0-based):
    // A=0 IncidentID, B=1 ServiceDt, C=2 TicketNum, D=3 CPT/ASA,
    // E=4 Modifier, F=5 UnitValue, G=6 DistributionValue, H=7 AgeValue (ignored),
    // I=8 StartTime, J=9 EndTime, K=10 TotalTime, L=11 TimeUnits, M=12 TotalDistributableUnits

    const rawDate = row[1]
    let serviceDate: string
    if (typeof rawDate === 'number') {
      serviceDate = excelSerialToISODate(rawDate)
    } else {
      serviceDate = String(rawDate ?? '')
    }

    const incidentRaw = row[0]
    const incidentId =
      typeof incidentRaw === 'number'
        ? String(Math.round(incidentRaw))
        : String(incidentRaw ?? '')

    items.push({
      incidentId,
      serviceDate,
      ticketNum: String(row[2] ?? '').trim(),
      cptAsa: String(row[3] ?? '').trim(),
      modifier: row[4] != null ? String(row[4]).trim() : '',
      unitValue: parseNum(row[5]),
      distributionValue: parseNum(row[6]) ?? 0,
      startTime: parseTime(row[8]),
      endTime: parseTime(row[9]),
      totalTime: parseTime(row[10]),
      timeUnits: parseNum(row[11]) ?? 0,
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
