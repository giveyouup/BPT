import { useState } from 'react'
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

export default function AnnualSummary() {
  const [shiftTab, setShiftTab] = useState<'hours' | 'dollars'>('hours')
  const [shiftSort, setShiftSort] = useState<{ col: string; dir: 1 | -1 }>({ col: 'shift', dir: 1 })
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

  const yearStats = computeCalendarYearStats(year, reports, allSchedules, settings, allMappings)

  const ytdUnits = yearStats.reduce((s, m) => s + m.totalDistributableUnits, 0)
  const ytdUnitPay = yearStats.reduce((s, m) => s + m.unitCompensation, 0)
  const ytdStipends = yearStats.reduce((s, m) => s + m.totalStipends, 0)
  const ytdTotal = yearStats.reduce((s, m) => s + m.totalCompensation, 0)
  const ytdHours = yearStats.reduce((s, m) => s + m.totalHours, 0)
  const ytdCases = yearStats.reduce((s, m) => s + m.totalCases, 0)

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

  const shiftDataCutoff = (() => {
    let max = ''
    for (const month of yearStats)
      for (const day of month.workingDays)
        if (day.hasProduction && day.date > max) max = day.date
    return max || null
  })()

  const shiftStatsData = (() => {
    type Entry = { hours: number; days: number; units: number; pay: number }
    const map = new Map<string, Entry>()
    for (const month of yearStats) {
      for (const day of month.workingDays) {
        if (day.shiftTypes.length === 0) continue
        if (shiftDataCutoff && day.date > shiftDataCutoff) continue
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
        shift,
        days,
        avgHours: hours > 0 ? Math.round((hours / days) * 10) / 10 : null,
        avgUnits: Math.round((units / days) * 100) / 100,
        avgDollarPerHr: hours > 0 ? Math.round(pay / hours) : null,
        totalPay: pay,
        isFixed: !!getFixedShiftKey(shift),
      }))
      .sort((a, b) => shiftSortKey(a.shift).localeCompare(shiftSortKey(b.shift)))
  })()

  const chartData = yearStats.map((s) => ({
    month: getMonthName(s.month).slice(0, 3),
    units: Math.round(s.totalDistributableUnits * 100) / 100,
    unitPay: Math.round(s.unitCompensation),
    stipends: Math.round(s.totalStipends),
    total: Math.round(s.totalCompensation),
    hours: Math.round(s.totalHours * 10) / 10,
    ratePerUnit: s.totalDistributableUnits > 0
      ? Math.round((s.unitCompensation / s.totalDistributableUnits) * 100) / 100
      : 0,
  }))

  return (
    <div className="p-4 md:p-8">
      {/* Header + year selector */}
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold text-gray-100">{year} Annual Summary</h2>
        {years.length > 1 && (
          <div className="flex gap-2 ml-4">
            {years.map((y) => (
              <button key={y} onClick={() => navigate(`/annual/${y}`)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  y === year ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}>
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

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
        <StatCard label="YTD Total Pay" value={formatCurrency(ytdTotal)} color="green"
          sub={`${formatCurrency(ytdUnitPay)} unit · ${formatCurrency(ytdStipends)} stipends`} private />
        <StatCard label="YTD Hours" value={formatHours(ytdHours)}
          sub={`${yearStats.reduce((s, m) => s + m.daysWorked, 0)} days worked · ${yearStats.length} months`} />
        <StatCard
          label="Avg $/hr"
          value={ytdHours > 0 ? `$${(ytdTotal / ytdHours).toFixed(0)}/hr` : '—'}
          sub="Total compensation ÷ hours"
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
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Monthly Compensation</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number, name: string) => [formatCurrency(v), name === 'unitPay' ? 'Unit Pay' : 'Stipends']}
                {...CHART_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
                formatter={(v) => (v === 'unitPay' ? 'Unit Pay' : 'Stipends')} />
              <Bar dataKey="unitPay" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
              <Bar dataKey="stipends" stackId="a" fill="#34d399" radius={[4, 4, 0, 0]} />
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
              <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, '$/Unit']} {...CHART_STYLE} />
              <Line type="monotone" dataKey="ratePerUnit" stroke="#f59e0b" strokeWidth={2}
                dot={{ r: 4, fill: '#f59e0b' }} />
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

      {shiftStatsData.length > 0 && (() => {
        const hoursData = shiftStatsData.filter((d) => !d.isFixed && d.avgHours != null)
        const dollarsData = shiftStatsData.filter((d) => d.avgDollarPerHr != null)
        return (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-8">
            {/* Tab header */}
            <div className="flex items-center justify-between mb-4">
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
                      <Cell key={entry.shift} fill={shiftBarColor(entry.shift)} />
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
              const sortedRows = [...shiftStatsData].sort((a, b) => {
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
                        {row.shift.replace(/ WD$/, ' WD').replace(/ WE$/, ' WE')}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">{row.days}</td>
                      <td className="px-4 py-2.5 text-gray-400">
                        {row.isFixed ? <span className="text-gray-600 text-xs">fixed</span> : row.avgHours != null ? `${row.avgHours}h` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-indigo-400">{row.avgUnits.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-amber-400">{row.avgDollarPerHr != null ? `$${row.avgDollarPerHr}/hr` : '—'}</td>
                      <td className="px-4 py-2.5 text-emerald-400 font-semibold">{formatCurrencyFull(row.totalPay)}</td>
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
            {yearStats.map((s) => {
              const avgRate = s.totalDistributableUnits > 0
                ? s.unitCompensation / s.totalDistributableUnits
                : null
              const dollarPerHr = s.totalHours > 0 ? s.totalCompensation / s.totalHours : null
              return (
                <tr key={s.id} onClick={() => navigate(`/calendar/${s.year}-${String(s.month).padStart(2, '0')}`)}
                  className="group border-b border-gray-800 hover:bg-gray-800 cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-200 sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800">{formatMonthYear(s.year, s.month)}</td>
                  <td className="px-4 py-3 text-gray-400">{s.totalCases}</td>
                  <td className="px-4 py-3 text-gray-300 font-medium">{s.totalDistributableUnits.toFixed(2)}</td>
                  <td className="px-4 py-3 text-amber-400">{avgRate != null ? `$${avgRate.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-emerald-400">{formatCurrencyFull(s.unitCompensation)}</td>
                  <td className="px-4 py-3 text-gray-400">{formatCurrencyFull(s.totalStipends)}</td>
                  <td className="px-4 py-3 text-emerald-400 font-semibold">{formatCurrencyFull(s.totalCompensation)}</td>
                  <td className="px-4 py-3 text-gray-400">{formatHours(s.totalHours)}</td>
                  <td className="px-4 py-3 text-amber-400">{dollarPerHr != null ? `$${dollarPerHr.toFixed(0)}` : '—'}</td>
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
              <td className="px-4 py-3 text-amber-400">
                {ytdUnits > 0 ? `$${(ytdUnitPay / ytdUnits).toFixed(2)} avg` : '—'}
              </td>
              <td className="px-4 py-3 text-emerald-400">{formatCurrencyFull(ytdUnitPay)}</td>
              <td className="px-4 py-3 text-gray-300">{formatCurrencyFull(ytdStipends)}</td>
              <td className="px-4 py-3 text-emerald-400">{formatCurrencyFull(ytdTotal)}</td>
              <td className="px-4 py-3 text-gray-300">{formatHours(ytdHours)}</td>
              <td className="px-4 py-3 text-amber-400">{ytdHours > 0 ? `$${(ytdTotal / ytdHours).toFixed(0)}` : '—'}</td>
              <td className="px-4 py-3 text-gray-300">{yearStats.reduce((s, m) => s + m.daysWorked, 0)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  )
}
