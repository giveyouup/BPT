import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getReports, getSchedules, getSettings, getStipendMappings, saveReport } from '../utils/storage'
import { computeCalendarMonthWorkingDays, computeCalendarYearStats } from '../utils/calculations'
import {
  formatCurrency, formatHours, formatMonthYear, formatDateShort, getMonthName,
} from '../utils/dateUtils'
import StatCard from '../components/StatCard'
import { shiftBadgeClass, isOffDayShift, getFixedShiftKey, isCallShift } from '../utils/shiftUtils'
import type { WorkingDayStats, Schedule } from '../types'

function countOffDays(allSchedules: Schedule[], year: number) {
  const dateMap = new Map<string, string[]>()
  for (const sched of [...allSchedules].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))) {
    for (const entry of sched.entries) {
      dateMap.set(entry.date, entry.shiftTypes)
    }
  }
  let vacation = 0, holiday = 0, postcall = 0
  const prefix = `${year}-`
  for (const [date, shiftTypes] of dateMap) {
    if (!date.startsWith(prefix)) continue
    if (!shiftTypes.every(isOffDayShift)) continue
    if (shiftTypes.some((s) => s.toUpperCase() === 'V')) vacation++
    else if (shiftTypes.some((s) => s.toUpperCase() === 'H')) holiday++
    else if (shiftTypes.some((s) => s.toUpperCase() === 'POSTCALL')) postcall++
  }
  return { vacation, holiday, postcall, total: vacation + holiday + postcall }
}

const CHART_STYLE = {
  contentStyle: {
    fontSize: 12, borderRadius: 8, border: '1px solid #1f2937',
    backgroundColor: '#111827', color: '#f3f4f6',
  },
  itemStyle: { color: '#f3f4f6' },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
}

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

function shiftSortKey(shift: string): string {
  const u = shift.toUpperCase()
  const gMatch = u.match(/^G(\d+)(?:\s+(WD|WE))?$/)
  if (gMatch) return `0_${gMatch[1].padStart(3, '0')}_${gMatch[2] === 'WE' ? '1' : '0'}`
  if (u.startsWith('FS')) return `1_${(u.match(/^FS(\d*)/)?.[1] ?? '').padStart(3, '0')}_${u}`
  return `2_${u}`
}

function shiftBarColor(shift: string): string {
  const u = shift.toUpperCase()
  if (/^G\d/.test(u)) return u.endsWith('WE') ? '#e11d48' : '#fb7185' // rose: WE darker, WD lighter
  if (u.startsWith('FS')) return '#fbbf24' // amber
  return '#a78bfa' // violet
}

export default function Dashboard() {
  const navigate = useNavigate()
  const reports = getReports()
  const allSchedules = getSchedules()
  const settings = getSettings()
  const allMappings = getStipendMappings()

  const years = [...new Set(reports.map((r) => r.year))].sort((a, b) => b - a)
  const [selectedYear, setSelectedYear] = useState<number>(years[0] ?? new Date().getFullYear())
  const [selectedId, setSelectedId] = useState<string>('')
  const [tick, setTick] = useState(0)
  const [editingDayDate, setEditingDayDate] = useState<string | null>(null)
  const [dayStipendInput, setDayStipendInput] = useState('')
  const [editingHoursDate, setEditingHoursDate] = useState<string | null>(null)
  const [hoursInput, setHoursInput] = useState('')

  const saveDayStipend = (date: string) => {
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
    saveReport({ ...report, dayStipends })
    setEditingDayDate(null)
    setTick((t) => t + 1)
  }
  const saveHoursOverride = (date: string) => {
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
    saveReport({ ...report, workingDayOverrides })
    setEditingHoursDate(null)
    setTick((t) => t + 1)
  }

  void tick

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
  const offDays = countOffDays(allSchedules, selectedYear)

  const chartData = yearStats.map((s) => ({
    month: getMonthName(s.month).slice(0, 3),
    id: s.id,
    units: Math.round(s.totalDistributableUnits * 10) / 10,
    total: Math.round(s.totalCompensation),
  }))

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

  const shiftHoursData = (() => {
    const map = new Map<string, { total: number; count: number }>()
    for (const month of yearStats) {
      for (const day of month.workingDays) {
        if (day.hours <= 0 || day.shiftTypes.length === 0) continue
        for (const rawSt of day.shiftTypes) {
          if (isOffDayShift(rawSt) || getFixedShiftKey(rawSt)) continue
          const canonical = rawSt.toUpperCase()
          const key = isCallShift(canonical)
            ? `${canonical} ${day.isCallWeekend ? 'WE' : 'WD'}`
            : canonical
          if (!map.has(key)) map.set(key, { total: 0, count: 0 })
          const entry = map.get(key)!
          entry.total += day.hours
          entry.count++
        }
      }
    }
    return [...map.entries()]
      .map(([shift, { total, count }]) => ({ shift, avgHours: Math.round((total / count) * 10) / 10, count }))
      .sort((a, b) => shiftSortKey(a.shift).localeCompare(shiftSortKey(b.shift)))
  })()

  const axisProps = { tick: { fontSize: 11, fill: '#6b7280' }, axisLine: false as const, tickLine: false as const }

  return (
    <div className="p-8">
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

      {/* YTD Stats */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        <StatCard label="YTD Units" value={ytdUnits.toFixed(1)} sub={`${yearStats.length} months`} color="indigo" />
        <StatCard label="YTD Compensation" value={formatCurrency(ytdCompensation)} sub="Units + stipends" color="green" private />
        <StatCard label="YTD Hours" value={formatHours(ytdHours)}
          sub={`${yearStats.reduce((s, m) => s + m.daysWorked, 0)} days worked`} />
        <StatCard
          label="Avg $/Unit"
          value={ytdUnits > 0
            ? `$${(yearStats.reduce((s, m) => s + m.unitCompensation, 0) / ytdUnits).toFixed(2)}`
            : '—'}
          sub="Unit dollar average"
          color="amber"
        />
        <StatCard
          label="YTD Days Off"
          value={offDays.total > 0 ? String(offDays.total) : '—'}
          sub={offDays.total > 0
            ? [
                offDays.postcall > 0 ? `${offDays.postcall} postcall` : '',
                offDays.holiday > 0 ? `${offDays.holiday} holiday` : '',
                offDays.vacation > 0 ? `${offDays.vacation} vacation` : '',
              ].filter(Boolean).join(' · ')
            : undefined}
        />
      </div>

      {/* Year charts */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Monthly Units</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip formatter={(v: number) => [v.toFixed(1), 'Units']} {...CHART_STYLE} />
              <Bar dataKey="units" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Monthly Compensation</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => [formatCurrency(v), 'Total']} {...CHART_STYLE} />
              <Bar dataKey="total" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {shiftHoursData.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-8">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Avg Hours by Shift Type</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={shiftHoursData} margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="shift" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={(v) => `${v}h`} />
              <Tooltip
                labelFormatter={(label: string) => label.replace(/ WD$/, ' Weekday').replace(/ WE$/, ' Weekend')}
                formatter={(v: number, _: string, entry: { payload?: { count: number } }) =>
                  [`${v}h avg · ${entry.payload?.count ?? 0} days`, 'Shift length']}
                {...CHART_STYLE}
              />
              <Bar dataKey="avgHours" radius={[4, 4, 0, 0]}>
                {shiftHoursData.map((entry) => (
                  <Cell key={entry.shift} fill={shiftBarColor(entry.shift)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

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
                onClick={() => setSelectedId(s.id)}
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
        <div className="grid grid-cols-6 divide-x divide-gray-800 border-b border-gray-800">
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
            <div className="space-y-3">
              {weeks.map((w) => (
                <div key={w.key} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-32 flex-shrink-0">{w.label}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-4 bg-sky-500 rounded-full transition-all"
                      style={{ width: `${(w.hours / maxWeekHours) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-gray-200 w-14 text-right flex-shrink-0">
                    {formatHours(w.hours)}
                  </span>
                  <span className="text-xs text-gray-600 w-10 flex-shrink-0">{w.days}d</span>
                </div>
              ))}
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
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    <span className="w-24 flex-shrink-0">Date</span>
                    <span className="w-16 flex-shrink-0">Shift</span>
                    <span className="w-16 flex-shrink-0">Cases</span>
                    <span className="w-14 text-right flex-shrink-0">Units</span>
                    <span className="w-16 text-right flex-shrink-0">Unit Pay</span>
                    <span className="w-16 text-right flex-shrink-0">Stipend</span>
                    <span className="w-20 text-right flex-shrink-0">Add'l</span>
                    <span className="w-16 text-right flex-shrink-0">Total</span>
                    <span className="text-right flex-shrink-0 ml-auto">Hours</span>
                  </div>
                  <div className="space-y-0.5">
                    {monthDays.map((day) => (
                      <div
                        key={day.date}
                        className={`flex items-center gap-2 py-1 text-xs ${!day.hasProduction ? 'opacity-50' : ''}`}
                      >
                        <span className="text-gray-500 w-24 flex-shrink-0">{formatDateShort(day.date)}</span>
                        <span className="w-16 flex-shrink-0 flex flex-wrap gap-0.5">
                          {day.shiftTypes.map((st) => (
                            <span key={st} className={`font-mono px-1.5 py-0.5 rounded ${shiftBadgeClass(st)}`}>
                              {st}
                            </span>
                          ))}
                        </span>
                        <span className="w-16 text-gray-500 flex-shrink-0">
                          {day.caseCount > 0 ? `${day.caseCount} cases` : (!day.hasProduction ? 'no prod.' : '')}
                        </span>
                        <span className="w-14 text-right text-indigo-400 flex-shrink-0">
                          {day.totalUnits > 0 ? day.totalUnits.toFixed(2) : '—'}
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
                        <span className="w-16 text-right font-medium text-gray-200 flex-shrink-0">
                          {day.totalDayPay > 0 ? formatCurrency(day.totalDayPay) : '—'}
                        </span>
                        <span className="text-right flex-shrink-0 ml-auto">
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
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )} {/* end selStats && selReport */}

      {/* Monthly breakdown table */}
      {yearStats.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300">{selectedYear} Reports</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Month', 'Cases', 'Units', '$/Unit', 'Unit Pay', 'Stipends', 'Total', 'Hours'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yearStats
                .slice()
                .reverse()
                .map((s) => {
                  const avgRate = s.totalDistributableUnits > 0
                    ? s.unitCompensation / s.totalDistributableUnits
                    : null
                  return (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/calendar/${s.year}-${String(s.month).padStart(2, '0')}`)}
                      className="border-b border-gray-800 hover:bg-gray-800 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-200">{formatMonthYear(s.year, s.month)}</td>
                      <td className="px-4 py-3 text-gray-400">{s.totalCases}</td>
                      <td className="px-4 py-3 text-gray-300">{s.totalDistributableUnits.toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-400">{avgRate != null ? `$${avgRate.toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-3 text-emerald-400 font-medium">{formatCurrency(s.unitCompensation)}</td>
                      <td className="px-4 py-3 text-gray-400">{formatCurrency(s.totalStipends)}</td>
                      <td className="px-4 py-3 text-emerald-400 font-semibold">{formatCurrency(s.totalCompensation)}</td>
                      <td className="px-4 py-3 text-gray-400">{formatHours(s.totalHours)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
