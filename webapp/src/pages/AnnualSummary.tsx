import { useParams, useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useData } from '../context/DataContext'
import { computeCalendarYearStats } from '../utils/calculations'
import {
  formatCurrency, formatCurrencyFull, formatHours, formatMonthYear, getMonthName,
} from '../utils/dateUtils'
import StatCard from '../components/StatCard'
import { isOffDayShift, getFixedShiftKey, isCallShift, resolveShiftAlias } from '../utils/shiftUtils'

function shiftSortKey(shift: string): string {
  const u = shift.toUpperCase()
  const gMatch = u.match(/^G(\d+)(?:\s+(WD|WE))?$/)
  if (gMatch) return `0_${gMatch[1].padStart(3, '0')}_${gMatch[2] === 'WE' ? '1' : '0'}`
  if (u.startsWith('FS')) return `1_${(u.match(/^FS(\d*)/)?.[1] ?? '').padStart(3, '0')}_${u}`
  return `2_${u}`
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

  const shiftHoursData = (() => {
    const map = new Map<string, { total: number; count: number }>()
    for (const month of yearStats) {
      for (const day of month.workingDays) {
        if (day.hours <= 0 || day.shiftTypes.length === 0) continue
        for (const rawSt of day.shiftTypes) {
          if (isOffDayShift(rawSt) || getFixedShiftKey(rawSt)) continue
          const canonical = resolveShiftAlias(rawSt.toUpperCase())
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
      <div className="grid grid-cols-2 gap-6 mb-6">
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
      <div className="grid grid-cols-2 gap-6 mb-8">
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

      {shiftHoursData.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-8">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Avg Hours by Shift Type</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={shiftHoursData} margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="shift" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => `${v}h`} />
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

      {/* Month-by-month table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300">Month-by-Month Breakdown</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              {['Month', 'Cases', 'Units', '$/Unit', 'Unit Pay', 'Stipends', 'Total Pay', 'Hours', '$/hr', 'Days'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
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
                  className="border-b border-gray-800 hover:bg-gray-800 cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-200">{formatMonthYear(s.year, s.month)}</td>
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
              <td className="px-4 py-3 text-gray-300">Year Total</td>
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
  )
}
