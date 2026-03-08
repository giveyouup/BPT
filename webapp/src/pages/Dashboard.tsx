import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { computeCalendarMonthWorkingDays, computeCalendarYearStats } from '../utils/calculations'
import {
  formatCurrency, formatHours, formatMonthYear, formatDateShort, getMonthName,
} from '../utils/dateUtils'
import { shiftBadgeClass } from '../utils/shiftUtils'
import type { WorkingDayStats } from '../types'


function weekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const day = date.getDay()
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

interface WeekBucket { key: string; label: string; hours: number; days: number }

function groupByWeek(workingDays: WorkingDayStats[]): WeekBucket[] {
  const map = new Map<string, { hours: number; days: number; min: string; max: string }>()
  for (const day of workingDays) {
    const key = weekStart(day.date)
    if (!map.has(key)) map.set(key, { hours: 0, days: 0, min: day.date, max: day.date })
    const w = map.get(key)!
    w.hours += day.hours
    w.days++
    if (day.date < w.min) w.min = day.date
    if (day.date > w.max) w.max = day.date
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      key,
      label: v.min === v.max ? formatDateShort(v.min) : `${formatDateShort(v.min)} – ${formatDateShort(v.max)}`,
      hours: v.hours,
      days: v.days,
    }))
}


export default function Dashboard() {
  const navigate = useNavigate()
  const { reports, schedules: allSchedules, settings, stipendMappings: allMappings, saveReport } = useData()

  const years = [...new Set(reports.map((r) => r.year))].sort((a, b) => b - a)
  const [selectedYear, setSelectedYear] = useState<number>(years[0] ?? new Date().getFullYear())
  const [selectedId, setSelectedId] = useState<string>('')
  const [editingDayDate, setEditingDayDate] = useState<string | null>(null)
  const [dayStipendInput, setDayStipendInput] = useState('')
  const [editingHoursDate, setEditingHoursDate] = useState<string | null>(null)
  const [hoursInput, setHoursInput] = useState('')
  const [hideCompensation, setHideCompensation] = useState(true)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)

  const saveDayStipend = async (date: string) => {
    if (!selStats) return
    const report = reports.find((r) => r.id === selStats.id)
    if (!report) return
    const amount = parseFloat(dayStipendInput)
    const dayStipends = { ...report.dayStipends }
    if (!isNaN(amount) && amount > 0) {
      dayStipends[date] = amount
    } else {
      delete dayStipends[date]
    }
    await saveReport({ ...report, dayStipends })
    setEditingDayDate(null)
  }
  const saveHoursOverride = async (date: string) => {
    if (!selStats) return
    const report = reports.find((r) => r.id === selStats.id)
    if (!report) return
    const hours = parseFloat(hoursInput)
    const workingDayOverrides = { ...report.workingDayOverrides }
    if (!isNaN(hours) && hours >= 0) {
      workingDayOverrides[date] = hours
    } else {
      delete workingDayOverrides[date]
    }
    await saveReport({ ...report, workingDayOverrides })
    setEditingHoursDate(null)
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-200 mb-2">No reports yet</h2>
        <p className="text-gray-500 mb-6 max-w-sm">
          Upload your first monthly PCR spreadsheet to start tracking your production and compensation.
        </p>
        <button
          onClick={() => navigate('/upload')}
          className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
        >
          Upload First Report
        </button>
      </div>
    )
  }

  const yearStats = computeCalendarYearStats(selectedYear, reports, allSchedules, settings, allMappings)

  const ytdUnits = yearStats.reduce((s, m) => s + m.totalDistributableUnits, 0)
  const ytdCompensation = yearStats.reduce((s, m) => s + m.totalCompensation, 0)
  const ytdHours = yearStats.reduce((s, m) => s + m.totalHours, 0)

  // selStats: prefer selectedId if it's in the selected year, else last month of selected year
  const selStats =
    yearStats.find((s) => s.id === selectedId) ?? yearStats[yearStats.length - 1]
  const effectiveRate = selStats && selStats.totalDistributableUnits > 0
    ? selStats.unitCompensation / selStats.totalDistributableUnits
    : null

  // Aggregate working days for the selected calendar month across ALL reports and schedules
  const monthDays = computeCalendarMonthWorkingDays(selStats.year, selStats.month, reports, allSchedules, settings, allMappings)
  const monthHours = monthDays.reduce((s, d) => s + d.hours, 0)
  const prodDays = monthDays.filter((d) => d.hasProduction)
  const noProdDays = monthDays.filter((d) => !d.hasProduction)
  const weeks = groupByWeek(monthDays)
  const maxWeekHours = Math.max(...weeks.map((w) => w.hours), 1)



  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">{selectedYear} Overview</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {yearStats.length} month{yearStats.length !== 1 ? 's' : ''} uploaded
          </p>
        </div>
        {years.length > 1 && (
          <div className="flex gap-2 ml-4">
            {years.map((y) => (
              <button key={y} onClick={() => setSelectedYear(y)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  y === selectedYear ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}>
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* YTD pulse strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 bg-gray-900 rounded-xl border border-gray-800 divide-y sm:divide-y-0 sm:divide-x divide-gray-800 mb-6">
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">YTD Units</p>
          <p className="text-xl font-bold text-indigo-400 mt-1">{ytdUnits.toFixed(1)}</p>
          <p className="text-xs text-gray-600 mt-0.5">{yearStats.length} months</p>
        </div>
        <div className="px-6 py-4 sm:flex-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">YTD Compensation</p>
            <button onClick={() => setHideCompensation((h) => !h)} className="text-gray-600 hover:text-gray-400 transition-colors" aria-label={hideCompensation ? 'Show' : 'Hide'}>
              {hideCompensation ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-xl font-bold text-emerald-400 mt-1">{hideCompensation ? '••••••' : formatCurrency(ytdCompensation)}</p>
          <p className="text-xs text-gray-600 mt-0.5">Units + stipends</p>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">YTD Hours</p>
          <p className="text-xl font-bold text-gray-100 mt-1">{formatHours(ytdHours)}</p>
          <p className="text-xs text-gray-600 mt-0.5">{yearStats.reduce((s, m) => s + m.daysWorked, 0)} days worked</p>
        </div>
      </div>

      {/* Month selector + weekly hours panel */}
      {selStats && (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden mb-6">
        {/* Month tabs */}
        <div className="border-b border-gray-800 px-4 py-3 flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider mr-2">Month</span>
          {yearStats
            .slice()
            .reverse()
            .map((s) => (
              <button
                key={s.id}
                onClick={() => { setSelectedId(s.id); setSelectedWeek(null) }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  s.id === selStats.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                {getMonthName(s.month).slice(0, 3)}
              </button>
            ))}
        </div>

        {/* Selected month summary */}
        <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-gray-800 border-b border-gray-800">
          {[
            { label: 'Cases', value: String(selStats.totalCases) },
            { label: 'Units', value: selStats.totalDistributableUnits.toFixed(2) },
            { label: '$/Unit', value: effectiveRate != null ? `$${effectiveRate.toFixed(2)} avg` : '—' },
            { label: 'Unit Pay', value: formatCurrency(selStats.unitCompensation) },
            { label: 'Stipends', value: formatCurrency(selStats.totalStipends) },
            { label: 'Total Pay', value: formatCurrency(selStats.totalCompensation) },
          ].map((item) => (
            <div key={item.label} className="px-5 py-4">
              <p className="text-xs text-gray-500">{item.label}</p>
              <p className="text-base font-semibold text-gray-100 mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Weekly hours */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-300">
              Hours by Week — {formatMonthYear(selStats.year, selStats.month)}
            </h3>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>{prodDays.length} worked</span>
              {noProdDays.length > 0 && (
                <span className="text-gray-600">{noProdDays.length} no production</span>
              )}
              <span>&middot;</span>
              <span className="font-medium text-gray-300">{formatHours(monthHours)} total</span>
              <button
                onClick={() => navigate(`/month/${selStats.id}`)}
                className="text-indigo-400 font-medium hover:text-indigo-300"
              >
                View details →
              </button>
            </div>
          </div>

          {weeks.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No working days in {formatMonthYear(selStats.year, selStats.month)}.</p>
          ) : (
            <div className="space-y-1.5">
              {weeks.map((w) => {
                const isSelected = selectedWeek === w.key
                const isDimmed = selectedWeek !== null && !isSelected
                return (
                  <button
                    key={w.key}
                    onClick={() => setSelectedWeek(isSelected ? null : w.key)}
                    className={`w-full flex items-center gap-3 rounded-lg px-2 py-1 transition-colors text-left ${
                      isSelected ? 'bg-sky-950/60 ring-1 ring-sky-500/40' : 'hover:bg-gray-800/50'
                    } ${isDimmed ? 'opacity-40' : ''}`}
                  >
                    <span className={`text-xs w-32 flex-shrink-0 ${isSelected ? 'text-sky-300 font-medium' : 'text-gray-500'}`}>{w.label}</span>
                    <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
                      <div
                        className={`h-4 rounded-full transition-all ${isSelected ? 'bg-sky-400' : 'bg-sky-500'}`}
                        style={{ width: `${(w.hours / maxWeekHours) * 100}%` }}
                      />
                    </div>
                    <span className={`text-xs font-semibold w-14 text-right flex-shrink-0 ${isSelected ? 'text-sky-300' : 'text-gray-200'}`}>
                      {formatHours(w.hours)}
                    </span>
                    <span className="text-xs text-gray-600 w-10 flex-shrink-0">{w.days}d</span>
                  </button>
                )
              })}
              <div className="flex items-center gap-3 pt-2 border-t border-gray-800">
                <span className="text-xs font-semibold text-gray-500 w-32 flex-shrink-0">Total</span>
                <div className="flex-1" />
                <span className="text-xs font-bold text-gray-100 w-14 text-right flex-shrink-0">
                  {formatHours(monthHours)}
                </span>
                <span className="text-xs text-gray-600 w-10 flex-shrink-0">{monthDays.length}d</span>
              </div>

              {/* Day-by-day shift detail */}
              {monthDays.some((d) => d.shiftTypes.length > 0) && (
                <div className="mt-4 pt-4 border-t border-gray-800 overflow-x-auto">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1 min-w-max">
                    <span className="w-20 flex-shrink-0 sticky left-0 bg-gray-900 z-10 pr-2 -mr-2">Date</span>
                    <span className="w-14 flex-shrink-0 sticky left-[88px] bg-gray-900 z-10 pr-2 -mr-2">Shift</span>
                    <span className="w-12 flex-shrink-0">Start</span>
                    <span className="w-12 flex-shrink-0">End</span>
                    <span className="w-14 flex-shrink-0">Cases</span>
                    <span className="w-12 text-right flex-shrink-0">Units</span>
                    <span className="w-14 text-right flex-shrink-0">Units/hr</span>
                    <span className="w-16 text-right flex-shrink-0">Unit Pay</span>
                    <span className="w-16 text-right flex-shrink-0">Stipend</span>
                    <span className="w-20 text-right flex-shrink-0">Add'l</span>
                    <span className="w-12 text-right flex-shrink-0">$/hr</span>
                    <span className="w-16 text-right flex-shrink-0">Total</span>
                    <span className="w-12 text-right flex-shrink-0 ml-auto">Hours</span>
                  </div>
                  <div className="space-y-0.5 min-w-max">
                    {monthDays.filter((d) => !selectedWeek || weekStart(d.date) === selectedWeek).map((day) => {
                      const unitsPerHr = day.hours > 0 && day.totalUnits > 0 ? day.totalUnits / day.hours : null
                      const dollarPerHr = day.hours > 0 && day.totalDayPay > 0 ? day.totalDayPay / day.hours : null
                      return (
                        <div
                          key={day.date}
                          className={`flex items-center gap-2 py-1 text-xs ${!day.hasProduction ? 'opacity-50' : ''}`}
                        >
                          <span className="text-gray-500 w-20 flex-shrink-0 sticky left-0 bg-gray-900 z-10 pr-2 -mr-2">{formatDateShort(day.date)}</span>
                          <span className="w-14 flex-shrink-0 flex flex-wrap gap-0.5 sticky left-[88px] bg-gray-900 z-10 pr-2 -mr-2">
                            {day.shiftTypes.map((st) => (
                              <span key={st} className={`font-mono px-1.5 py-0.5 rounded ${shiftBadgeClass(st)}`}>
                                {st}
                              </span>
                            ))}
                          </span>
                          <span className="w-12 text-gray-500 flex-shrink-0">{day.firstStartTime ?? '—'}</span>
                          <span className="w-12 text-gray-500 flex-shrink-0">{day.lastEndTime ?? '—'}</span>
                          <span className="w-14 text-gray-500 flex-shrink-0">
                            {day.caseCount > 0 ? `${day.caseCount} cases` : (!day.hasProduction ? 'no prod.' : '')}
                          </span>
                          <span className="w-12 text-right text-indigo-400 flex-shrink-0">
                            {day.totalUnits > 0 ? day.totalUnits.toFixed(2) : '—'}
                          </span>
                          <span className="w-14 text-right text-indigo-300 flex-shrink-0">
                            {unitsPerHr !== null ? unitsPerHr.toFixed(2) : '—'}
                          </span>
                          <span className="w-16 text-right text-emerald-400 flex-shrink-0">
                            {day.unitPay > 0 ? formatCurrency(day.unitPay) : '—'}
                          </span>
                          <span className="w-16 text-right text-emerald-400 flex-shrink-0">
                            {day.stipendAmount > 0 ? formatCurrency(day.stipendAmount) : '—'}
                          </span>
                          <span className="w-20 text-right flex-shrink-0">
                            {editingDayDate === day.date ? (
                              <span className="flex items-center justify-end gap-1">
                                <input
                                  type="number" step="0.01" placeholder="0"
                                  value={dayStipendInput}
                                  onChange={(e) => setDayStipendInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveDayStipend(day.date)
                                    if (e.key === 'Escape') setEditingDayDate(null)
                                  }}
                                  className="w-16 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  autoFocus
                                />
                                <button onClick={() => saveDayStipend(day.date)} className="text-indigo-400 hover:text-indigo-300 text-xs">✓</button>
                                <button onClick={() => setEditingDayDate(null)} className="text-gray-600 hover:text-gray-400 text-xs">✕</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => { setEditingDayDate(day.date); setDayStipendInput(day.additionalStipend > 0 ? day.additionalStipend.toFixed(2) : '') }}
                                className="text-right w-full hover:text-indigo-400 transition-colors"
                              >
                                {day.additionalStipend > 0
                                  ? <span className="text-emerald-400">{formatCurrency(day.additionalStipend)}</span>
                                  : <span className="text-gray-700">+</span>}
                              </button>
                            )}
                          </span>
                          <span className="w-12 text-right text-emerald-300 flex-shrink-0">
                            {dollarPerHr !== null ? `$${dollarPerHr.toFixed(0)}` : '—'}
                          </span>
                          <span className="w-16 text-right font-medium text-gray-200 flex-shrink-0">
                            {day.totalDayPay > 0 ? formatCurrency(day.totalDayPay) : '—'}
                          </span>
                          <span className="w-12 text-right flex-shrink-0 ml-auto">
                            {editingHoursDate === day.date ? (
                              <span className="flex items-center justify-end gap-1">
                                <input
                                  type="number" step="0.5" placeholder="0"
                                  value={hoursInput}
                                  onChange={(e) => setHoursInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveHoursOverride(day.date)
                                    if (e.key === 'Escape') setEditingHoursDate(null)
                                  }}
                                  className="w-14 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  autoFocus
                                />
                                <button onClick={() => saveHoursOverride(day.date)} className="text-indigo-400 hover:text-indigo-300 text-xs">✓</button>
                                <button onClick={() => setEditingHoursDate(null)} className="text-gray-600 hover:text-gray-400 text-xs">✕</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => { setEditingHoursDate(day.date); setHoursInput(day.hours > 0 ? day.hours.toFixed(1) : '') }}
                                className={`hover:text-indigo-400 transition-colors ${day.isOverridden ? 'text-amber-400' : 'text-gray-400'}`}
                              >
                                {day.hours > 0 ? formatHours(day.hours) : '—'}
                              </button>
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )} {/* end selStats && selReport */}

    </div>
  )
}
