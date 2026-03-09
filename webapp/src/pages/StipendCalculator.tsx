import { useState } from 'react'
import { useData } from '../context/DataContext'
import { getApplicableMapping } from '../utils/calculations'
import { formatCurrencyFull, formatDateFull, getMonthName } from '../utils/dateUtils'
import { isCallShift, isOffDayShift, isWeekendOrHoliday, resolveShiftAlias, computeFederalHolidays, isAlwaysWeekendStipend } from '../utils/shiftUtils'
import type { StipendMapping } from '../types'

// ─── Stipend group classification ────────────────────────────────────────────

type StipendGroup = 'mainOrCall' | 'otherG' | 'APS' | 'BR' | 'NIR' | 'ROC' | 'FS' | 'other'

function getStipendGroup(canonical: string): StipendGroup {
  if (isCallShift(canonical)) return 'mainOrCall'
  if (/^G\d+$/.test(canonical)) return 'otherG'
  if (canonical === 'APS') return 'APS'
  if (canonical === 'BR') return 'BR'
  if (canonical === 'NIR') return 'NIR'
  if (canonical === 'ROC') return 'ROC'
  if (/^FS\d*$/i.test(canonical)) return 'FS'
  return 'other'
}

function getShiftStipend(raw: string, isWeekend: boolean, mapping: StipendMapping): number {
  const shiftType = resolveShiftAlias(raw.toUpperCase())
  if (isCallShift(shiftType)) {
    const key = `${shiftType}_${isWeekend ? 'weekend' : 'weekday'}`.toLowerCase()
    return mapping.rates.find((r) => r.shiftType.toLowerCase() === key)?.amount ?? 0
  }
  if (isAlwaysWeekendStipend(shiftType)) {
    const key = `${shiftType}_weekend`.toLowerCase()
    return mapping.rates.find((r) => r.shiftType.toLowerCase() === key)?.amount ?? 0
  }
  const variantKey = `${shiftType}_${isWeekend ? 'weekend' : 'weekday'}`.toLowerCase()
  const variantRate = mapping.rates.find((r) => r.shiftType.toLowerCase() === variantKey)
  if (variantRate) return variantRate.amount
  return mapping.rates.find((r) => r.shiftType.toLowerCase() === shiftType.toLowerCase())?.amount ?? 0
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayDetail {
  date: string
  shift: string
  group: StipendGroup | 'additional'
  isWeekend: boolean
  amount: number
}

interface MonthRow {
  year: number
  month: number
  mainOrCall: number
  otherG: number
  APS: number
  BR: number
  NIR: number
  ROC: number
  FS: number
  other: number
  additional: number
  mappingName: string | null
  details: DayDetail[]
}

// ─── Group metadata ───────────────────────────────────────────────────────────

const GROUPS: {
  key: keyof Omit<MonthRow, 'year' | 'month' | 'mappingName' | 'details'>
  label: string
  headerClass: string
  cellClass: string
  activeBg: string
}[] = [
  { key: 'mainOrCall', label: 'G1/G2 Call',  headerClass: 'text-rose-400',   cellClass: 'text-rose-300',   activeBg: 'bg-rose-900/20' },
  { key: 'otherG',     label: 'Other G',      headerClass: 'text-pink-400',   cellClass: 'text-pink-300',   activeBg: 'bg-pink-900/20' },
  { key: 'APS',        label: 'APS',          headerClass: 'text-amber-400',  cellClass: 'text-amber-300',  activeBg: 'bg-amber-900/20' },
  { key: 'BR',         label: 'BR',           headerClass: 'text-orange-400', cellClass: 'text-orange-300', activeBg: 'bg-orange-900/20' },
  { key: 'NIR',        label: 'NIR',          headerClass: 'text-yellow-400', cellClass: 'text-yellow-300', activeBg: 'bg-yellow-900/20' },
  { key: 'ROC',        label: 'ROC',          headerClass: 'text-violet-400', cellClass: 'text-violet-300', activeBg: 'bg-violet-900/20' },
  { key: 'FS',         label: 'FS',           headerClass: 'text-sky-400',    cellClass: 'text-sky-300',    activeBg: 'bg-sky-900/20' },
  { key: 'other',      label: 'Other',        headerClass: 'text-gray-500',   cellClass: 'text-gray-400',   activeBg: 'bg-gray-700/30' },
  { key: 'additional', label: 'Additional',   headerClass: 'text-teal-400',   cellClass: 'text-teal-300',   activeBg: 'bg-teal-900/20' },
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function StipendCalculator() {
  const { reports, schedules: allSchedules, settings, stipendMappings: allMappings } = useData()

  const scheduleYears = allSchedules.flatMap((s) => s.entries.map((e) => parseInt(e.date.slice(0, 4))))
  const reportYears = reports.map((r) => r.year)
  const years = [...new Set([...scheduleYears, ...reportYears])].sort((a, b) => b - a)

  const [selectedYear, setSelectedYear] = useState<number>(years[0] ?? new Date().getFullYear())
  const [activeCell, setActiveCell] = useState<{ month: number; group: string } | null>(null)

  if (allSchedules.length === 0) {
    return (
      <div className="p-4 md:p-8 text-gray-500">
        No schedule uploaded yet. Upload a schedule to see stipend calculations.
      </div>
    )
  }

  const dateMap = new Map<string, string[]>()
  for (const sched of [...allSchedules].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))) {
    for (const entry of sched.entries) dateMap.set(entry.date, entry.shiftTypes)
  }

  const additionalByDate = new Map<string, number>()
  for (const report of reports) {
    for (const [date, amount] of Object.entries(report.dayStipends ?? {})) {
      additionalByDate.set(date, (additionalByDate.get(date) ?? 0) + amount)
    }
  }

  const holidayList = settings.holidays[selectedYear] ?? computeFederalHolidays(selectedYear)
  const yearPrefix = `${selectedYear}-`

  const datesInYear = [...dateMap.entries()]
    .filter(([date, shiftTypes]) => date.startsWith(yearPrefix) && shiftTypes.some((s) => !isOffDayShift(s)))
    .sort(([a], [b]) => a.localeCompare(b))

  const monthMap = new Map<number, typeof datesInYear>()
  for (const entry of datesInYear) {
    const month = parseInt(entry[0].slice(5, 7))
    if (!monthMap.has(month)) monthMap.set(month, [])
    monthMap.get(month)!.push(entry)
  }

  const rows: MonthRow[] = []
  for (const [month, entries] of [...monthMap.entries()].sort((a, b) => a[0] - b[0])) {
    const mapping = allMappings.length ? getApplicableMapping(selectedYear, month, allMappings) : null

    const row: MonthRow = {
      year: selectedYear, month,
      mainOrCall: 0, otherG: 0, APS: 0, BR: 0, NIR: 0, ROC: 0, FS: 0, other: 0, additional: 0,
      mappingName: mapping ? (mapping.name || mapping.filename) : null,
      details: [],
    }

    for (const [date, shiftTypes] of entries) {
      const isWeekend = isWeekendOrHoliday(date, holidayList)

      for (const raw of shiftTypes) {
        if (isOffDayShift(raw)) continue
        const canonical = resolveShiftAlias(raw.toUpperCase())
        const group = getStipendGroup(canonical)
        const amount = mapping ? getShiftStipend(raw, isWeekend, mapping) : 0
        row[group] += amount
        if (amount > 0) {
          row.details.push({ date, shift: canonical, group, isWeekend, amount })
        }
      }

      const addl = additionalByDate.get(date) ?? 0
      if (addl > 0) {
        row.additional += addl
        row.details.push({ date, shift: '—', group: 'additional', isWeekend, amount: addl })
      }
    }

    const total = GROUPS.reduce((s, g) => s + row[g.key], 0)
    if (total > 0 || entries.length > 0) rows.push(row)
  }

  const totals = GROUPS.reduce((acc, g) => {
    acc[g.key] = rows.reduce((s, r) => s + r[g.key], 0)
    return acc
  }, {} as Record<string, number>)

  const rowTotal = (r: MonthRow) => GROUPS.reduce((s, g) => s + r[g.key], 0)
  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0)
  const visibleGroups = GROUPS.filter((g) => rows.some((r) => r[g.key] > 0))

  const mappingNames = [...new Set(rows.map((r) => r.mappingName).filter(Boolean))]
  const footerMappingLabel = mappingNames.length === 1 ? mappingNames[0] : mappingNames.length > 1 ? 'varies' : null

  const toggleCell = (month: number, group: string) => {
    setActiveCell((prev) =>
      prev?.month === month && prev?.group === group ? null : { month, group }
    )
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold text-gray-100">Stipend Calculator</h2>
        {years.length > 1 && (
          <div className="flex gap-2 ml-4">
            {years.map((y) => (
              <button key={y} onClick={() => { setSelectedYear(y); setActiveCell(null) }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  y === selectedYear ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}>
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      {allMappings.length === 0 && (
        <div className="flex items-center gap-2 mb-5 px-3 py-2 bg-amber-900/20 border border-amber-800/40 rounded-lg w-fit">
          <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs text-amber-400">No stipend rate schedule uploaded — rate-based columns will show $0</span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-gray-500 text-sm">No scheduled shifts found for {selectedYear}.</p>
      ) : (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider sticky left-0 z-10 bg-gray-900">
                    Month
                  </th>
                  {visibleGroups.map((g) => (
                    <th key={g.key} className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${g.headerClass}`}>
                      {g.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-emerald-500 uppercase tracking-wider whitespace-nowrap">
                    Total
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                    Rate Schedule
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const total = rowTotal(row)
                  const expandedGroup = activeCell?.month === row.month ? activeCell.group : null
                  const expandedGroupMeta = visibleGroups.find((g) => g.key === expandedGroup)
                  const detailRows = expandedGroup
                    ? row.details.filter((d) => d.group === expandedGroup).sort((a, b) => a.date.localeCompare(b.date))
                    : []

                  return (
                    <tr key={`${row.year}-${row.month}`} className="group border-b border-gray-800 hover:bg-gray-800">
                      <td className="px-4 py-3 font-medium text-gray-200 sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800">
                        {getMonthName(row.month)}
                      </td>
                      {visibleGroups.map((g) => {
                        const isActive = expandedGroup === g.key
                        const hasValue = row[g.key] > 0
                        const cellDetailRows = isActive ? detailRows : []
                        return (
                          <td
                            key={g.key}
                            onClick={() => hasValue ? toggleCell(row.month, g.key) : undefined}
                            className={`px-4 py-3 text-right align-top transition-colors ${
                              hasValue ? 'cursor-pointer' : ''
                            } ${isActive ? g.activeBg : ''} ${hasValue ? g.cellClass : 'text-gray-700'}`}
                          >
                            <span className={`${hasValue && isActive ? 'underline underline-offset-2' : ''}`}>
                              {hasValue ? formatCurrencyFull(row[g.key]) : '—'}
                            </span>

                            {/* Inline detail card */}
                            {isActive && cellDetailRows.length > 0 && (
                              <div className={`mt-2 rounded-lg border overflow-hidden w-fit max-w-[280px] text-left ${g.activeBg} border-gray-700/50`}
                                onClick={(e) => e.stopPropagation()}>
                                <table className="text-xs">
                                  <thead>
                                    <tr className="border-b border-gray-700/50">
                                      <th className="px-3 py-1.5 text-left text-gray-600 font-semibold uppercase tracking-wider whitespace-nowrap">Date</th>
                                      <th className="px-3 py-1.5 text-left text-gray-600 font-semibold uppercase tracking-wider">Day</th>
                                      <th className="px-3 py-1.5 text-right text-gray-600 font-semibold uppercase tracking-wider">Amt</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {cellDetailRows.map((d, i) => (
                                      <tr key={i} className="border-b border-gray-700/30 last:border-0">
                                        <td className="px-3 py-1.5 text-gray-300 whitespace-nowrap">{formatDateFull(d.date)}</td>
                                        <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{d.isWeekend ? 'WE/Hol' : 'WD'}</td>
                                        <td className={`px-3 py-1.5 text-right font-semibold whitespace-nowrap ${g.cellClass}`}>{formatCurrencyFull(d.amount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="border-t border-gray-700/50">
                                      <td className="px-3 py-1.5 text-gray-500 font-semibold">{cellDetailRows.length}d</td>
                                      <td />
                                      <td className={`px-3 py-1.5 text-right font-bold whitespace-nowrap ${g.cellClass}`}>
                                        {formatCurrencyFull(cellDetailRows.reduce((s, d) => s + d.amount, 0))}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-4 py-3 text-right align-top font-semibold text-emerald-400">
                        {formatCurrencyFull(total)}
                      </td>
                      <td className="px-4 py-3 text-left align-top text-xs text-gray-500">
                        {row.mappingName ?? <span className="text-gray-700">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-800 border-t border-gray-700 font-semibold">
                  <td className="px-4 py-3 text-gray-300 sticky left-0 z-10 bg-gray-800">
                    {selectedYear} Total
                  </td>
                  {visibleGroups.map((g) => (
                    <td key={g.key} className={`px-4 py-3 text-right ${totals[g.key] > 0 ? g.cellClass : 'text-gray-600'}`}>
                      {totals[g.key] > 0 ? formatCurrencyFull(totals[g.key]) : '—'}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right text-emerald-400">
                    {formatCurrencyFull(grandTotal)}
                  </td>
                  <td className="px-4 py-3 text-left text-xs text-gray-600">
                    {footerMappingLabel ?? '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
