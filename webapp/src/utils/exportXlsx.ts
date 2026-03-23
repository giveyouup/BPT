import * as XLSX from 'xlsx'
import type { MonthlyStats, WorkingDayStats, CaseSummary, StipendMapping } from '../types'
import { formatMonthYear, getMonthName } from './dateUtils'

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename)
}

// ─── Shift Type Analytics ──────────────────────────────────────────────────

export interface ShiftExportRow {
  shift: string
  days: number
  avgHours: number | null
  avgUnits: number
  avgDollarPerHr: number | null
  totalPay: number
  isFixed: boolean
  wiAvgDollarPerHr?: number | null
  wiTotalPay?: number | null
}

export function exportShiftAnalytics(
  rows: ShiftExportRow[],
  year: number,
  hasProjection = false,
) {
  const headers = ['Shift', 'Days', 'Avg Hours', 'Avg Units', 'Avg $/hr', 'Total Pay']
  if (hasProjection) headers.push('Proj Avg $/hr', 'Proj Total Pay')

  const data: (string | number | null)[][] = [
    headers,
    ...rows.map((r) => {
      const row: (string | number | null)[] = [
        r.shift,
        r.days,
        r.isFixed ? null : (r.avgHours ?? null),
        r.avgUnits,
        r.avgDollarPerHr ?? null,
        r.totalPay,
      ]
      if (hasProjection) row.push(r.wiAvgDollarPerHr ?? null, r.wiTotalPay ?? null)
      return row
    }),
  ]

  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Shift Analytics')
  download(wb, `BRACT_${year}_shift_analytics.xlsx`)
}

// ─── Month-by-Month Breakdown ──────────────────────────────────────────────

export function exportMonthBreakdown(
  yearStats: MonthlyStats[],
  year: number,
  proj?: {
    unitPayByMonth?: number[]
    stipendsByMonth?: number[]
    totalByMonth?: number[]
  },
) {
  const hasProj = !!proj
  const headers = ['Month', 'Cases', 'Units', '$/Unit', 'Unit Pay', 'Stipends', 'Total Pay', 'Hours', '$/hr', 'Days']
  if (hasProj) headers.push('Proj Unit Pay', 'Proj Stipends', 'Proj Total')

  const rows = yearStats.map((s, i) => {
    const actualRate = s.totalDistributableUnits > 0 ? s.unitCompensation / s.totalDistributableUnits : null
    const dollarPerHr = s.totalHours > 0 ? s.totalCompensation / s.totalHours : null
    const row: (string | number | null)[] = [
      formatMonthYear(s.year, s.month),
      s.totalCases,
      s.totalDistributableUnits,
      actualRate,
      s.unitCompensation,
      s.totalStipends,
      s.totalCompensation,
      s.totalHours,
      dollarPerHr,
      s.daysWorked,
    ]
    if (hasProj) {
      row.push(proj.unitPayByMonth?.[i] ?? null, proj.stipendsByMonth?.[i] ?? null, proj.totalByMonth?.[i] ?? null)
    }
    return row
  })

  const ytdUnits  = yearStats.reduce((s, m) => s + m.totalDistributableUnits, 0)
  const ytdUnitPay = yearStats.reduce((s, m) => s + m.unitCompensation, 0)
  const ytdStipends = yearStats.reduce((s, m) => s + m.totalStipends, 0)
  const ytdTotal  = yearStats.reduce((s, m) => s + m.totalCompensation, 0)
  const ytdHours  = yearStats.reduce((s, m) => s + m.totalHours, 0)
  const ytdCases  = yearStats.reduce((s, m) => s + m.totalCases, 0)
  const ytdDays   = yearStats.reduce((s, m) => s + m.daysWorked, 0)

  const footer: (string | number | null)[] = [
    'Year Total',
    ytdCases,
    ytdUnits,
    ytdUnits > 0 ? ytdUnitPay / ytdUnits : null,
    ytdUnitPay,
    ytdStipends,
    ytdTotal,
    ytdHours,
    ytdHours > 0 ? ytdTotal / ytdHours : null,
    ytdDays,
  ]
  if (hasProj) {
    footer.push(
      proj.unitPayByMonth?.reduce((s, v) => s + v, 0) ?? null,
      proj.stipendsByMonth?.reduce((s, v) => s + v, 0) ?? null,
      proj.totalByMonth?.reduce((s, v) => s + v, 0) ?? null,
    )
  }

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, footer])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Monthly Breakdown')
  download(wb, `BRACT_${year}_monthly_breakdown.xlsx`)
}

// ─── Dashboard Month (day-by-day) ─────────────────────────────────────────

export function exportDashboardMonth(
  monthDays: WorkingDayStats[],
  cases: CaseSummary[],
  year: number,
  month: number,
) {
  // Day-level sheet
  const dayHeaders = ['Date', 'Shift', 'Start', 'End', 'Cases', 'Units', 'Units/hr', 'Unit Pay', 'Stipend', "Add'l Stipend", '$/hr', 'Total Pay', 'Hours']
  const dayRows = monthDays.map((day) => {
    const unitsPerHr = day.hours > 0 && day.totalUnits > 0 ? day.totalUnits / day.hours : null
    const dollarPerHr = day.hours > 0 && day.totalDayPay > 0 ? day.totalDayPay / day.hours : null
    return [
      day.date,
      day.shiftTypes.join(' / ') || '—',
      day.firstStartTime ?? null,
      day.lastEndTime ?? null,
      day.caseCount > 0 ? day.caseCount : null,
      day.totalUnits > 0 ? day.totalUnits : null,
      unitsPerHr,
      day.unitPay > 0 ? day.unitPay : null,
      day.stipendAmount > 0 ? day.stipendAmount : null,
      day.additionalStipend > 0 ? day.additionalStipend : null,
      dollarPerHr,
      day.totalDayPay > 0 ? day.totalDayPay : null,
      day.hours > 0 ? day.hours : null,
    ]
  })

  // Case-level sheet
  const caseHeaders = ['Date', 'Ticket #', 'Procedure', 'Start', 'End', 'Base Units', 'Time Units', 'Add-on Units', 'Total Units']
  const caseRows = cases.map((c) => [
    c.serviceDate,
    c.ticketNum,
    c.primaryCptAsa,
    c.startTime ?? null,
    c.endTime ?? null,
    c.primaryDistributionValue,
    c.primaryTimeUnits,
    c.addOnUnits > 0 ? c.addOnUnits : null,
    c.totalUnits,
  ])

  const monthLabel = `${getMonthName(month)} ${year}`
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([dayHeaders, ...dayRows]), 'Daily Summary')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([caseHeaders, ...caseRows]), 'Cases')
  download(wb, `BRACT_${year}_${String(month).padStart(2, '0')}_${getMonthName(month)}.xlsx`)
  void monthLabel
}

// ─── Stipend Rate Schedules ────────────────────────────────────────────────

export function exportStipendMappings(mappings: StipendMapping[]) {
  const wb = XLSX.utils.book_new()
  const sorted = [...mappings].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
  sorted.forEach((m) => {
    const rows: (string | number)[][] = m.rates.map((r) => [r.shiftType, r.amount])
    const ws = XLSX.utils.aoa_to_sheet(rows)
    // Always lead with YYYY-MM so the importer can auto-detect the date.
    // Sheet names must be ≤31 chars and unique.
    const datePrefix = m.effectiveDate.slice(0, 7)
    const namePart = m.name ? ` ${m.name}` : ''
    const rawName = `${datePrefix}${namePart}`.slice(0, 31)
    let sheetName = rawName
    let dedupIdx = 2
    while (wb.SheetNames.includes(sheetName)) {
      sheetName = `${rawName.slice(0, 28)}_${dedupIdx++}`
    }
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  })
  download(wb, 'BRACT_stipend_rate_schedules.xlsx')
}
