import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useData } from '../context/DataContext'
import { computeCalendarYearStats } from '../utils/calculations'
import {
  formatCurrency, formatCurrencyFull, formatDateFull, formatHours, formatMonthYear, getMonthName,
} from '../utils/dateUtils'
import StatCard from '../components/StatCard'
import { isOffDayShift, getFixedShiftKey, isCallShift, resolveShiftAlias } from '../utils/shiftUtils'
import type { MonthlyStats } from '../types'

function shiftSortKey(shift: string): string {
  const u = shift.toUpperCase()
  const gMatch = u.match(/^G(\d+)(?:\s+(WD|WE))?$/)
  if (gMatch) return `0_${gMatch[1].padStart(3, '0')}_${gMatch[2] === 'WE' ? '1' : '0'}`
  if (u.startsWith('FS')) return `1_${(u.match(/^FS(\d*)/)?.[1] ?? '').padStart(3, '0')}_${u}`
  if (u === 'NIR') return '2_0'
  if (u === 'BR')  return '2_1'
  if (u === 'APS') return '2_2'
  if (u === 'GI')  return '2_3'
  return `3_${u}`
}

function shiftBarColor(shift: string): string {
  const u = shift.toUpperCase()
  if (/^G\d/.test(u)) return u.endsWith('WE') ? '#e11d48' : '#fb7185'
  if (u.startsWith('FS')) return '#fbbf24'
  return '#a78bfa'
}

const CHART_STYLE = {
  contentStyle: {
    fontSize: 12, borderRadius: 8,
    border: '1px solid #1f2937', backgroundColor: '#111827', color: '#f3f4f6',
  },
  itemStyle: { color: '#f3f4f6' },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
}
const AXIS_PROPS = {
  tick: { fontSize: 11, fill: '#6b7280' },
  axisLine: false as const,
  tickLine: false as const,
}

type ShiftRow = {
  shift: string; days: number
  avgHours: number | null; avgUnits: number
  avgDollarPerHr: number | null; totalPay: number
  isFixed: boolean
}

function buildShiftStats(stats: MonthlyStats[], cutoff: string | null): ShiftRow[] {
  type Entry = { hours: number; days: number; units: number; pay: number }
  const map = new Map<string, Entry>()
  for (const month of stats) {
    for (const day of month.workingDays) {
      if (day.shiftTypes.length === 0) continue
      if (cutoff && day.date > cutoff) continue
      for (const rawSt of day.shiftTypes) {
        if (isOffDayShift(rawSt)) continue
        const canonical = resolveShiftAlias(rawSt.toUpperCase())
        const isFixed = !!getFixedShiftKey(canonical)
        const key = (!isFixed && isCallShift(canonical))
          ? `${canonical} ${day.isCallWeekend ? 'WE' : 'WD'}`
          : canonical
        if (!map.has(key)) map.set(key, { hours: 0, days: 0, units: 0, pay: 0 })
        const entry = map.get(key)!
        entry.hours += day.hours
        entry.days++
        entry.units += day.totalUnits
        entry.pay += day.totalDayPay
      }
    }
  }
  return [...map.entries()]
    .map(([shift, { hours, days, units, pay }]) => ({
      shift, days,
      avgHours: hours > 0 ? Math.round((hours / days) * 10) / 10 : null,
      avgUnits: Math.round((units / days) * 100) / 100,
      avgDollarPerHr: hours > 0 ? Math.round(pay / hours) : null,
      totalPay: pay,
      isFixed: !!getFixedShiftKey(shift),
    }))
    .sort((a, b) => shiftSortKey(a.shift).localeCompare(shiftSortKey(b.shift)))
}

function deltaLabel(actual: number, projected: number): string {
  const diff = projected - actual
  return (diff >= 0 ? '+' : '') + formatCurrency(diff)
}

export default function AnnualSummary() {
  const [shiftTab, setShiftTab] = useState<'hours' | 'dollars'>('hours')
  const [shiftSort, setShiftSort] = useState<{ col: string; dir: 1 | -1 }>({ col: 'shift', dir: 1 })
  const [whatIfMappingId, setWhatIfMappingId] = useState<string | null>(null)
  const [whatIfUnitRate, setWhatIfUnitRate] = useState<number | null>(null)
  const [showWhatIfPopover, setShowWhatIfPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showWhatIfPopover) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node))
        setShowWhatIfPopover(false)
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowWhatIfPopover(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [showWhatIfPopover])
  const { year: yearParam } = useParams<{ year: string }>()
  const navigate = useNavigate()

  const { reports, schedules: allSchedules, settings, stipendMappings: allMappings } = useData()
  const years = [...new Set(reports.map((r) => r.year))].sort((a, b) => b - a)
  const year = yearParam ? parseInt(yearParam) : years[0]

  if (!year || years.length === 0) {
    return (
      <div className="p-4 md:p-8 text-gray-500">
        No reports uploaded yet.{' '}
        <button onClick={() => navigate('/upload')} className="text-indigo-400">Upload one</button>
      </div>
    )
  }

  // ── Actual stats ──────────────────────────────────────────────────────────
  const yearStats = computeCalendarYearStats(year, reports, allSchedules, settings, allMappings)

  const ytdUnits    = yearStats.reduce((s, m) => s + m.totalDistributableUnits, 0)
  const ytdUnitPay  = yearStats.reduce((s, m) => s + m.unitCompensation, 0)
  const ytdStipends = yearStats.reduce((s, m) => s + m.totalStipends, 0)
  const ytdTotal    = yearStats.reduce((s, m) => s + m.totalCompensation, 0)
  const ytdHours    = yearStats.reduce((s, m) => s + m.totalHours, 0)
  const ytdCases    = yearStats.reduce((s, m) => s + m.totalCases, 0)

  // ── Projection stats (ephemeral, local only) ─────────────────────────────
  const whatIfMapping = whatIfMappingId
    ? allMappings.find(m => m.id === whatIfMappingId) ?? null
    : null

  // Force the selected mapping to cover all dates by stripping its date bounds
  const whatIfYearStats = whatIfMapping
    ? computeCalendarYearStats(year, reports, allSchedules, settings,
        [{ ...whatIfMapping, effectiveDate: '0000-01-01', endDate: undefined }])
    : null

  const isProjectionActive = whatIfMapping !== null || whatIfUnitRate !== null

  // Per-month projected unit pay when rate is overridden
  const projUnitPayByMonth: number[] | null = whatIfUnitRate != null
    ? yearStats.map(m => m.totalDistributableUnits * whatIfUnitRate)
    : null

  // Per-month projected stipends when mapping is active
  const projStipendsByMonth: number[] | null = whatIfYearStats
    ? whatIfYearStats.map(m => m.totalStipends)
    : null

  // Per-month projected total (combines whichever overrides are active)
  const projTotalByMonth: number[] | null = (projUnitPayByMonth || projStipendsByMonth)
    ? yearStats.map((m, i) => {
        const up = projUnitPayByMonth?.[i] ?? m.unitCompensation
        const stip = projStipendsByMonth?.[i] ?? m.totalStipends
        return up + stip
      })
    : null

  const projYtdUnitPay  = projUnitPayByMonth?.reduce((s, v) => s + v, 0) ?? null
  const wiStipends      = projStipendsByMonth?.reduce((s, v) => s + v, 0) ?? null
  const wiTotal         = projTotalByMonth?.reduce((s, v) => s + v, 0) ?? null

  // ── Off-days ──────────────────────────────────────────────────────────────
  const offDays = (() => {
    const dateMap = new Map<string, string[]>()
    for (const sched of [...allSchedules].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))) {
      for (const entry of sched.entries) dateMap.set(entry.date, entry.shiftTypes)
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
  })()

  // ── Shift analytics ───────────────────────────────────────────────────────
  const shiftDataCutoff = (() => {
    let max = ''
    for (const month of yearStats)
      for (const day of month.workingDays)
        if (day.hasProduction && day.date > max) max = day.date
    return max || null
  })()

  const shiftStatsData    = buildShiftStats(yearStats, shiftDataCutoff)
  const whatIfShiftStats  = whatIfYearStats ? buildShiftStats(whatIfYearStats, shiftDataCutoff) : null

  // Merge actual + what-if by shift key for the table
  const shiftTableData = shiftStatsData.map(row => {
    const wi = whatIfShiftStats?.find(r => r.shift === row.shift)
    return {
      ...row,
      wiAvgDollarPerHr: wi?.avgDollarPerHr ?? null,
      wiTotalPay: wi?.totalPay ?? null,
    }
  })

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = yearStats.map((s, i) => {
    const projUp   = projUnitPayByMonth?.[i]
    const projStip = projStipendsByMonth?.[i]
    return {
      month: getMonthName(s.month).slice(0, 3),
      units: Math.round(s.totalDistributableUnits * 100) / 100,
      unitPay: Math.round(s.unitCompensation),
      projUnitPay: projUp != null ? Math.round(projUp) : undefined,
      stipends: Math.round(s.totalStipends),
      wiStipends: projStip != null ? Math.round(projStip) : undefined,
      total: Math.round(s.totalCompensation),
      hours: Math.round(s.totalHours * 10) / 10,
      ratePerUnit: s.totalDistributableUnits > 0
        ? Math.round((s.unitCompensation / s.totalDistributableUnits) * 100) / 100
        : 0,
      projRatePerUnit: whatIfUnitRate != null ? whatIfUnitRate : undefined,
    }
  })

  // Dollar/hr chart data for shift analytics — use what-if when active
  const activeShiftStats = whatIfShiftStats ?? shiftStatsData

  return (
    <div className="p-4 md:p-8">

      {/* Header + year selector + what-if selector */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-100">{year} Annual Summary</h2>
        {years.length > 1 && (
          <div className="flex gap-2 ml-4">
            {years.map((y) => (
              <button key={y} onClick={() => { navigate(`/annual/${y}`); setWhatIfMappingId(null); setWhatIfUnitRate(null) }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  y === year ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}>
                {y}
              </button>
            ))}
          </div>
        )}

        {/* Projection icon button */}
        <div className="relative ml-auto" ref={popoverRef}>
          <button
            onClick={() => setShowWhatIfPopover(v => !v)}
            className={`p-1.5 rounded-md transition-colors ${
              isProjectionActive
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-gray-700 hover:text-gray-400'
            }`}
            title="Rate projection"
            aria-label="Rate projection"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </button>

          {showWhatIfPopover && (
            <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-3.5">
              <p className="text-xs font-semibold text-gray-200 mb-0.5">Rate Projection</p>
              <p className="text-[10px] text-gray-500 mb-3">Apply hypothetical rates to this year's production data</p>

              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Stipend Mapping</p>
              <select
                value={whatIfMappingId ?? ''}
                onChange={e => setWhatIfMappingId(e.target.value || null)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-amber-500 mb-3"
              >
                <option value="">— actual rates —</option>
                {allMappings.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>

              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">$/Unit Override</p>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={ytdUnits > 0 ? (ytdUnitPay / ytdUnits).toFixed(2) : '0.00'}
                  value={whatIfUnitRate ?? ''}
                  onChange={e => setWhatIfUnitRate(e.target.value !== '' ? parseFloat(e.target.value) : null)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-md pl-6 pr-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <p className="text-[10px] text-gray-600 mt-1 mb-3">
                Leave blank to use actual avg {ytdUnits > 0 ? `$${(ytdUnitPay / ytdUnits).toFixed(2)}` : '—'}/unit
              </p>

              {isProjectionActive && (
                <button
                  onClick={() => { setWhatIfMappingId(null); setWhatIfUnitRate(null); setShowWhatIfPopover(false) }}
                  className="w-full text-xs text-amber-500 hover:text-amber-400 transition-colors text-center py-1 border-t border-gray-700 pt-2.5"
                >
                  Clear projection
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* What-if banner */}
      {isProjectionActive && (
        <div className="flex items-center gap-2.5 mb-5 px-3.5 py-2.5 bg-amber-950/40 border border-amber-700/40 rounded-lg">
          <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <span className="text-xs text-amber-400 flex-1">
            Projection active —
            {whatIfMapping && <> stipend mapping: <span className="font-semibold">{whatIfMapping.name}</span></>}
            {whatIfMapping && whatIfUnitRate != null && <span className="text-amber-600"> · </span>}
            {whatIfUnitRate != null && <> unit rate: <span className="font-semibold">${whatIfUnitRate.toFixed(2)}/unit</span></>}
            . Figures in amber are hypothetical — no data has been changed.
          </span>
          <button
            onClick={() => { setWhatIfMappingId(null); setWhatIfUnitRate(null) }}
            className="text-amber-600 hover:text-amber-400 transition-colors flex-shrink-0 ml-1"
            aria-label="Clear projection"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Shift analytics cutoff notice */}
      {shiftDataCutoff && (
        <div className="flex items-center gap-2 mb-5 px-3 py-2 bg-gray-800/60 border border-gray-700/60 rounded-lg w-fit">
          <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-xs text-gray-500">
            Shift analytics use data through{' '}
            <span className="text-gray-300 font-medium">{formatDateFull(shiftDataCutoff)}</span>
            {' '}— days after this date lack processed billing data
          </span>
        </div>
      )}

      {/* YTD Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="YTD Total Pay"
          value={isProjectionActive && wiTotal != null ? formatCurrency(wiTotal) : formatCurrency(ytdTotal)}
          color={isProjectionActive ? 'amber' : 'green'}
          sub={isProjectionActive && wiTotal != null
            ? `Actual: ${formatCurrency(ytdTotal)} · ${deltaLabel(ytdTotal, wiTotal)}`
            : `${formatCurrency(ytdUnitPay)} unit · ${formatCurrency(ytdStipends)} stipends`}
          private
        />
        <StatCard label="YTD Hours" value={formatHours(ytdHours)}
          sub={`${yearStats.reduce((s, m) => s + m.daysWorked, 0)} days worked · ${yearStats.length} months`} />
        <StatCard
          label="Avg $/hr"
          value={isProjectionActive && wiTotal != null
            ? `$${(wiTotal / ytdHours).toFixed(0)}/hr`
            : ytdHours > 0 ? `$${(ytdTotal / ytdHours).toFixed(0)}/hr` : '—'}
          sub={isProjectionActive && wiTotal != null
            ? `Actual: $${(ytdTotal / ytdHours).toFixed(0)}/hr · ${deltaLabel(ytdTotal / ytdHours, wiTotal / ytdHours)}`
            : 'Total compensation ÷ hours'}
          color="amber"
          private
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

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Units per Month</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} />
              <Tooltip formatter={(v: number) => [v.toFixed(2), 'Units']} {...CHART_STYLE} />
              <Bar dataKey="units" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Monthly Compensation</h3>
          {isProjectionActive && (
            <p className="text-[10px] text-amber-600 mb-3">
              {[
                whatIfMapping && `Stipends: ${whatIfMapping.name}`,
                whatIfUnitRate != null && `Unit rate: $${whatIfUnitRate.toFixed(2)}/unit`,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number, name: string) => [
                  formatCurrency(v),
                  name === 'projUnitPay' ? 'Unit Pay (proj)'
                  : name === 'unitPay' ? 'Unit Pay'
                  : name === 'wiStipends' ? 'Stipends (proj)'
                  : 'Stipends (actual)',
                ]}
                {...CHART_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
                formatter={(v) =>
                  v === 'projUnitPay' ? 'Unit Pay (proj)'
                  : v === 'unitPay' ? 'Unit Pay'
                  : v === 'wiStipends' ? 'Stipends (proj)'
                  : 'Stipends (actual)'
                } />
              {projUnitPayByMonth
                ? <Bar dataKey="projUnitPay" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                : <Bar dataKey="unitPay" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
              }
              {isProjectionActive
                ? <Bar dataKey="wiStipends" stackId="a" fill={whatIfMapping ? '#fbbf24' : '#34d399'} radius={[4, 4, 0, 0]} />
                : <Bar dataKey="stipends" stackId="a" fill="#34d399" radius={[4, 4, 0, 0]} />
              }
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Dollar per Unit Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => `$${v.toFixed(0)}`} domain={['auto', 'auto']} />
              <Tooltip
                formatter={(v: number, name: string) => [`$${v.toFixed(2)}`, name === 'projRatePerUnit' ? '$/Unit (proj)' : '$/Unit (actual)']}
                {...CHART_STYLE}
              />
              <Line type="monotone" dataKey="ratePerUnit" stroke="#f59e0b" strokeWidth={2}
                dot={{ r: 4, fill: '#f59e0b' }} />
              {whatIfUnitRate != null && (
                <Line type="monotone" dataKey="projRatePerUnit" stroke="#fb923c" strokeWidth={2}
                  strokeDasharray="5 3" dot={{ r: 3, fill: '#fb923c' }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Hours Worked per Month</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} />
              <Tooltip formatter={(v: number) => [formatHours(v), 'Hours']} {...CHART_STYLE} />
              <Bar dataKey="hours" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Shift Type Analytics */}
      {shiftStatsData.length > 0 && (() => {
        const hoursData = activeShiftStats.filter((d) => !d.isFixed && d.avgHours != null)
        const dollarsData = activeShiftStats.filter((d) => d.avgDollarPerHr != null)
        return (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-8">
            {/* Tab header */}
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-300">Shift Type Analytics</h3>
              <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                <button
                  onClick={() => setShiftTab('hours')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    shiftTab === 'hours' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Avg Hours
                </button>
                <button
                  onClick={() => setShiftTab('dollars')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    shiftTab === 'dollars' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Avg $/hr
                </button>
              </div>
            </div>
            {whatIfMapping && (
              <p className="text-[10px] text-amber-600 mb-3">$/hr and pay figures using {whatIfMapping.name} stipend mapping</p>
            )}

            {/* Chart */}
            {shiftTab === 'hours' ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={hoursData} margin={{ top: 0, right: 32, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="shift" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => `${v}h`} />
                  <Tooltip
                    labelFormatter={(label: string) => label.replace(/ WD$/, ' Weekday').replace(/ WE$/, ' Weekend')}
                    formatter={(v: number, _: string, entry: { payload?: { days: number } }) =>
                      [`${v}h avg · ${entry.payload?.days ?? 0} days`, 'Shift length']}
                    {...CHART_STYLE}
                  />
                  {[8, 10, 12].map((h) => (
                    <ReferenceLine key={h} y={h} stroke="#374151" strokeDasharray="4 4"
                      label={{ value: `${h}h`, position: 'right', fill: '#6b7280', fontSize: 10 }} />
                  ))}
                  <Bar dataKey="avgHours" radius={[4, 4, 0, 0]}>
                    {hoursData.map((entry) => (
                      <Cell key={entry.shift} fill={shiftBarColor(entry.shift)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dollarsData} margin={{ top: 0, right: 32, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="shift" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => `$${v}`} domain={[0, 650]} />
                  <Tooltip
                    labelFormatter={(label: string) => label.replace(/ WD$/, ' Weekday').replace(/ WE$/, ' Weekend')}
                    formatter={(v: number, _: string, entry: { payload?: { days: number } }) =>
                      [`$${v}/hr avg · ${entry.payload?.days ?? 0} days`, '$/hr']}
                    {...CHART_STYLE}
                  />
                  <Bar dataKey="avgDollarPerHr" radius={[4, 4, 0, 0]}>
                    {dollarsData.map((entry) => (
                      <Cell key={entry.shift} fill={whatIfMapping ? '#f59e0b' : shiftBarColor(entry.shift)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {/* Stat table */}
            {(() => {
              const cols: { label: string; key: string }[] = [
                { label: 'Shift', key: 'shift' },
                { label: 'Days', key: 'days' },
                { label: 'Avg Hours', key: 'avgHours' },
                { label: 'Avg Units', key: 'avgUnits' },
                { label: 'Avg $/hr', key: 'avgDollarPerHr' },
                { label: 'Total Pay', key: 'totalPay' },
              ]
              const toggleSort = (key: string) =>
                setShiftSort((s) => s.col === key ? { col: key, dir: s.dir === 1 ? -1 : 1 } : { col: key, dir: key === 'shift' ? 1 : -1 })
              const sortedRows = [...shiftTableData].sort((a, b) => {
                if (shiftSort.col === 'shift') {
                  const cmp = shiftSortKey(a.shift).localeCompare(shiftSortKey(b.shift))
                  return cmp * shiftSort.dir
                }
                const av = a[shiftSort.col as keyof typeof a] ?? -Infinity
                const bv = b[shiftSort.col as keyof typeof b] ?? -Infinity
                return av < bv ? -shiftSort.dir : av > bv ? shiftSort.dir : 0
              })
              return (
                <div className="overflow-x-auto mt-5">
                  <table className="w-full text-sm min-w-max">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {cols.map(({ label, key }, i) => (
                          <th key={key} onClick={() => toggleSort(key)}
                            className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-gray-300 ${shiftSort.col === key ? 'text-indigo-400' : 'text-gray-600'}${i === 0 ? ' sticky left-0 z-10 bg-gray-900' : ''}`}>
                            <span className="flex items-center gap-1">
                              {label}
                              {shiftSort.col === key && (
                                <span className="text-indigo-400">{shiftSort.dir === 1 ? '↑' : '↓'}</span>
                              )}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => (
                        <tr key={row.shift} className="group border-b border-gray-800 hover:bg-gray-800">
                          <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-200 sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800">
                            {row.shift}
                          </td>
                          <td className="px-4 py-2.5 text-gray-400">{row.days}</td>
                          <td className="px-4 py-2.5 text-gray-400">
                            {row.isFixed ? <span className="text-gray-600 text-xs">fixed</span> : row.avgHours != null ? `${row.avgHours}h` : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-indigo-400">{row.avgUnits.toFixed(2)}</td>
                          <td className="px-4 py-2.5">
                            {whatIfMapping && row.wiAvgDollarPerHr != null ? (
                              <span className="flex flex-col">
                                <span className="text-amber-400 font-medium">${row.wiAvgDollarPerHr}/hr</span>
                                <span className="text-gray-600 text-[10px]">actual: {row.avgDollarPerHr != null ? `$${row.avgDollarPerHr}/hr` : '—'}</span>
                              </span>
                            ) : (
                              <span className="text-amber-400">{row.avgDollarPerHr != null ? `$${row.avgDollarPerHr}/hr` : '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {whatIfMapping && row.wiTotalPay != null ? (
                              <span className="flex flex-col">
                                <span className="text-amber-400 font-semibold">{formatCurrencyFull(row.wiTotalPay)}</span>
                                <span className="text-gray-600 text-[10px]">actual: {formatCurrencyFull(row.totalPay)}</span>
                              </span>
                            ) : (
                              <span className="text-emerald-400 font-semibold">{formatCurrencyFull(row.totalPay)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        )
      })()}

      {/* Month-by-month table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300">Month-by-Month Breakdown</h3>
          {whatIfMapping && (
            <p className="text-[10px] text-amber-600 mt-0.5">Stipends and totals shown using {whatIfMapping.name}</p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-max">
            <thead>
              <tr className="border-b border-gray-800">
                {['Month', 'Cases', 'Units', '$/Unit', 'Unit Pay', 'Stipends', 'Total Pay', 'Hours', '$/hr', 'Days'].map((h, i) => (
                  <th key={h} className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider${i === 0 ? ' sticky left-0 z-10 bg-gray-900' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yearStats.map((s, i) => {
                const actualRate = s.totalDistributableUnits > 0 ? s.unitCompensation / s.totalDistributableUnits : null
                const projUp    = projUnitPayByMonth?.[i] ?? null
                const projStip  = projStipendsByMonth?.[i] ?? null
                const projTotal = projTotalByMonth?.[i] ?? null
                const actualDollarPerHr = s.totalHours > 0 ? s.totalCompensation / s.totalHours : null
                const projDollarPerHr   = projTotal != null && s.totalHours > 0 ? projTotal / s.totalHours : null
                return (
                  <tr key={s.id} onClick={() => navigate(`/calendar/${s.year}-${String(s.month).padStart(2, '0')}`)}
                    className="group border-b border-gray-800 hover:bg-gray-800 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-200 sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800">{formatMonthYear(s.year, s.month)}</td>
                    <td className="px-4 py-3 text-gray-400">{s.totalCases}</td>
                    <td className="px-4 py-3 text-gray-300 font-medium">{s.totalDistributableUnits.toFixed(2)}</td>
                    {/* $/Unit */}
                    <td className="px-4 py-3">
                      {whatIfUnitRate != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400">${whatIfUnitRate.toFixed(2)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {actualRate != null ? `$${actualRate.toFixed(2)}` : '—'}</span>
                        </span>
                      ) : (
                        <span className="text-amber-400">{actualRate != null ? `$${actualRate.toFixed(2)}` : '—'}</span>
                      )}
                    </td>
                    {/* Unit Pay */}
                    <td className="px-4 py-3">
                      {projUp != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400">{formatCurrencyFull(projUp)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {formatCurrencyFull(s.unitCompensation)}</span>
                        </span>
                      ) : (
                        <span className="text-emerald-400">{formatCurrencyFull(s.unitCompensation)}</span>
                      )}
                    </td>
                    {/* Stipends */}
                    <td className="px-4 py-3">
                      {projStip != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400 font-medium">{formatCurrencyFull(projStip)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {formatCurrencyFull(s.totalStipends)}</span>
                        </span>
                      ) : (
                        <span className="text-gray-400">{formatCurrencyFull(s.totalStipends)}</span>
                      )}
                    </td>
                    {/* Total Pay */}
                    <td className="px-4 py-3">
                      {projTotal != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400 font-semibold">{formatCurrencyFull(projTotal)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {formatCurrencyFull(s.totalCompensation)}</span>
                        </span>
                      ) : (
                        <span className="text-emerald-400 font-semibold">{formatCurrencyFull(s.totalCompensation)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatHours(s.totalHours)}</td>
                    {/* $/hr */}
                    <td className="px-4 py-3">
                      {projDollarPerHr != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400">${projDollarPerHr.toFixed(0)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {actualDollarPerHr != null ? `$${actualDollarPerHr.toFixed(0)}` : '—'}</span>
                        </span>
                      ) : (
                        <span className="text-amber-400">{actualDollarPerHr != null ? `$${actualDollarPerHr.toFixed(0)}` : '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{s.daysWorked}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-800 border-t border-gray-700 font-semibold">
                <td className="px-4 py-3 text-gray-300 sticky left-0 z-10 bg-gray-800">Year Total</td>
                <td className="px-4 py-3 text-gray-300">{ytdCases}</td>
                <td className="px-4 py-3 text-indigo-400">{ytdUnits.toFixed(2)}</td>
                {/* $/Unit footer */}
                <td className="px-4 py-3">
                  {whatIfUnitRate != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">${whatIfUnitRate.toFixed(2)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: {ytdUnits > 0 ? `$${(ytdUnitPay / ytdUnits).toFixed(2)}` : '—'} avg</span>
                    </span>
                  ) : (
                    <span className="text-amber-400">{ytdUnits > 0 ? `$${(ytdUnitPay / ytdUnits).toFixed(2)} avg` : '—'}</span>
                  )}
                </td>
                {/* Unit Pay footer */}
                <td className="px-4 py-3">
                  {projYtdUnitPay != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">{formatCurrencyFull(projYtdUnitPay)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: {formatCurrencyFull(ytdUnitPay)}</span>
                    </span>
                  ) : (
                    <span className="text-emerald-400">{formatCurrencyFull(ytdUnitPay)}</span>
                  )}
                </td>
                {/* Stipends footer */}
                <td className="px-4 py-3">
                  {wiStipends != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">{formatCurrencyFull(wiStipends)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: {formatCurrencyFull(ytdStipends)}</span>
                    </span>
                  ) : (
                    <span className="text-gray-300">{formatCurrencyFull(ytdStipends)}</span>
                  )}
                </td>
                {/* Total Pay footer */}
                <td className="px-4 py-3">
                  {wiTotal != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">{formatCurrencyFull(wiTotal)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: {formatCurrencyFull(ytdTotal)} · {deltaLabel(ytdTotal, wiTotal)}</span>
                    </span>
                  ) : (
                    <span className="text-emerald-400">{formatCurrencyFull(ytdTotal)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-300">{formatHours(ytdHours)}</td>
                <td className="px-4 py-3">
                  {wiTotal != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">${(wiTotal / ytdHours).toFixed(0)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: ${(ytdTotal / ytdHours).toFixed(0)}</span>
                    </span>
                  ) : (
                    <span className="text-amber-400">{ytdHours > 0 ? `$${(ytdTotal / ytdHours).toFixed(0)}` : '—'}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-300">{yearStats.reduce((s, m) => s + m.daysWorked, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
