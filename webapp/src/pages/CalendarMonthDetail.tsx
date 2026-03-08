import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { computeCalendarMonthStats, getApplicableMapping } from '../utils/calculations'
import {
  formatMonthYear, formatDateFull, formatHours, formatCurrency, formatCurrencyFull,
} from '../utils/dateUtils'
import StatCard from '../components/StatCard'
import { shiftBadgeClass, isCallShift, isOffDayShift } from '../utils/shiftUtils'

const SHIFT_TYPE_OPTIONS = ['G1', 'G2', 'G3', 'G4', 'G5', 'APS', 'BR', 'NIR', 'GI', 'ENDO']
import { getCptCategory } from '../utils/cptLookup'

export default function CalendarMonthDetail() {
  const { yearMonth } = useParams<{ yearMonth: string }>()
  const navigate = useNavigate()

  const { reports: allReports, schedules: allSchedules, settings, stipendMappings: allMappings, saveReport, saveManualShift } = useData()

  if (!yearMonth) return null
  const [yearStr, monthStr] = yearMonth.split('-')
  const calYear = parseInt(yearStr)
  const calMonth = parseInt(monthStr)
  if (isNaN(calYear) || isNaN(calMonth)) return null

  const stats = computeCalendarMonthStats(calYear, calMonth, allReports, allSchedules, settings, allMappings)
  const activeMapping = getApplicableMapping(calYear, calMonth, allMappings)

  // Find which PCR reports contributed cases for this calendar month
  const monthPrefix = yearMonth
  const sourceReports = allReports.filter((r) =>
    r.lineItems.some((li) => li.serviceDate.startsWith(monthPrefix))
  )

  if (!stats) {
    return (
      <div className="p-4 md:p-8 text-gray-500">
        No data found for {formatMonthYear(calYear, calMonth)}.{' '}
        <button onClick={() => navigate('/')} className="text-indigo-400">Go home</button>
      </div>
    )
  }

  const prodDays = stats.workingDays.filter((d) => d.hasProduction)
  const noProdDays = stats.workingDays.filter((d) => !d.hasProduction)
  const avgRate = stats.totalDistributableUnits > 0
    ? stats.unitCompensation / stats.totalDistributableUnits
    : null

  // Outlier detection: flag days with units ±1.5 stddev from mean (requires ≥5 data points)
  const unitValues = prodDays.filter((d) => d.totalUnits > 0).map((d) => d.totalUnits)
  const unitMean = unitValues.length ? unitValues.reduce((s, u) => s + u, 0) / unitValues.length : 0
  const unitStddev = unitValues.length > 1
    ? Math.sqrt(unitValues.reduce((s, u) => s + (u - unitMean) ** 2, 0) / unitValues.length)
    : 0
  const canShowOutliers = unitValues.length >= 5 && unitStddev > 0
  const unitOutlier = (u: number): 'high' | 'low' | null => {
    if (!canShowOutliers) return null
    const z = (u - unitMean) / unitStddev
    if (z > 1.5) return 'high'
    if (z < -1.5) return 'low'
    return null
  }

  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = () => setRefreshKey((k) => k + 1)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [showNoProd, setShowNoProd] = useState(false)
  const [editingShiftDate, setEditingShiftDate] = useState<string | null>(null)
  const [shiftDraft, setShiftDraft] = useState<string[]>([])
  const [editingHoursDate, setEditingHoursDate] = useState<string | null>(null)
  const [hoursInput, setHoursInput] = useState('')
  void refreshKey

  const labeledReport = allReports.find((r) => r.year === calYear && r.month === calMonth)

  const saveHoursOverride = async (date: string) => {
    if (!labeledReport) return
    const hours = parseFloat(hoursInput)
    const workingDayOverrides = { ...labeledReport.workingDayOverrides }
    if (!isNaN(hours) && hours >= 0) {
      workingDayOverrides[date] = hours
    } else {
      delete workingDayOverrides[date]
    }
    await saveReport({ ...labeledReport, workingDayOverrides })
    setEditingHoursDate(null)
    refresh()
  }
  const visibleCases = selectedDay
    ? stats.cases.filter((c) => c.serviceDate === selectedDay)
    : stats.cases
  const visibleUnits = visibleCases.reduce((s, c) => s + c.totalUnits, 0)

  const prevMonth = calMonth === 1
    ? `${calYear - 1}-12`
    : `${calYear}-${String(calMonth - 1).padStart(2, '0')}`
  const nextMonth = calMonth === 12
    ? `${calYear + 1}-01`
    : `${calYear}-${String(calMonth + 1).padStart(2, '0')}`

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <button onClick={() => navigate('/')}
            className="text-xs text-gray-600 hover:text-gray-400 mb-1 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(`/calendar/${prevMonth}`)}
              className="p-1 text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
              title="Previous month"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-2xl font-bold text-gray-100">{formatMonthYear(calYear, calMonth)}</h2>
            <button
              onClick={() => navigate(`/calendar/${nextMonth}`)}
              className="p-1 text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
              title="Next month"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-gray-600">Cases by service date</p>
            <span className="text-gray-700">·</span>
            {activeMapping ? (
              <p className="text-xs text-gray-600">
                Stipend: <span className="text-gray-400">{activeMapping.name}</span>
                <span className="text-gray-700 ml-1">(eff. {activeMapping.effectiveDate.slice(0, 7)}{activeMapping.endDate ? ` – ${activeMapping.endDate.slice(0, 7)}` : ''})</span>
              </p>
            ) : (
              <p className="text-xs text-red-500/70">No stipend schedule — check Settings</p>
            )}
          </div>
        </div>

        {/* Links to source PCR reports */}
        {sourceReports.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-gray-600 mb-1">Cases drawn from PCR report{sourceReports.length > 1 ? 's' : ''}:</p>
            <div className="flex flex-col gap-1 items-end">
              {sourceReports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/month/${r.id}`)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  {formatMonthYear(r.year, r.month)} report →
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        <StatCard label="Cases" value={String(stats.totalCases)} />
        <StatCard label="Total Units" value={stats.totalDistributableUnits.toFixed(2)} color="indigo" />
        <StatCard label="Unit Pay" value={formatCurrency(stats.unitCompensation)} color="green"
          sub={avgRate != null ? `$${avgRate.toFixed(2)} avg/unit` : undefined} />
        <StatCard label="Total Pay" value={formatCurrency(stats.totalCompensation)} color="green"
          sub={stats.totalStipends > 0 ? `Incl. ${formatCurrency(stats.totalStipends)} stipends` : undefined} />
        <StatCard label="Hours Worked" value={formatHours(stats.totalHours)} sub={`${stats.daysWorked} days`} />
      </div>

      {(stats.weekdayCallDays > 0 || stats.weekendCallDays > 0) && (
        <div className="flex gap-3 mb-8">
          <div className="bg-gray-900 rounded-lg border border-gray-800 px-4 py-2.5 flex items-center gap-2.5">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Call Days</span>
            <span className="text-sm font-semibold text-rose-400">{stats.weekdayCallDays} weekday</span>
            <span className="text-gray-700">·</span>
            <span className="text-sm font-semibold text-rose-400">{stats.weekendCallDays} weekend/holiday</span>
          </div>
        </div>
      )}

      {/* Working Days */}
      <section className="mb-8">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Working Days</h3>
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-max">
            <thead>
              <tr className="border-b border-gray-800">
                {['Date', 'Shift', 'Cases', 'Units', 'Unit Pay', 'Stipend', 'Add\'l', 'Total', 'Hours'].map((h, i) => (
                  <th key={h} className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider${i === 0 ? ' sticky left-0 z-10 bg-gray-900' : i === 1 ? ' sticky left-[148px] z-10 bg-gray-900' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prodDays.map((day) => {
                const isGap = day.shiftTypes.length === 0 || day.shiftTypes.every(isOffDayShift)
                const outlier = unitOutlier(day.totalUnits)
                const isEditingShift = editingShiftDate === day.date
                const isSelected = selectedDay === day.date
                const stickyBg = isSelected ? 'bg-indigo-950' : 'bg-gray-900 group-hover:bg-gray-800'
                return (
                  <tr
                    key={day.date}
                    onClick={() => !isEditingShift && setSelectedDay(isSelected ? null : day.date)}
                    className={`group border-b border-gray-800 cursor-pointer transition-colors ${
                      isGap ? 'border-l-2 border-l-amber-600/40' : ''
                    } ${
                      isSelected
                        ? 'bg-indigo-950/60 hover:bg-indigo-950/80'
                        : 'hover:bg-gray-800'
                    }`}
                  >
                    <td className={`px-4 py-3 font-medium min-w-[148px] sticky left-0 z-10 ${stickyBg}`}>
                      <div className="flex items-center gap-1.5">
                        <span className={isGap ? 'text-amber-300/80' : 'text-gray-200'}>{formatDateFull(day.date)}</span>
                        {isGap && <span className="text-xs px-1.5 py-0.5 bg-amber-900/30 text-amber-500 rounded">no shift</span>}
                      </div>
                    </td>
                    <td className={`px-4 py-3 min-w-[130px] sticky left-[148px] z-10 ${stickyBg}`} onClick={(e) => e.stopPropagation()}>
                      {isEditingShift ? (
                        <div className="space-y-2 py-1">
                          <div className="flex flex-wrap gap-1">
                            {SHIFT_TYPE_OPTIONS.map((st) => (
                              <button
                                key={st}
                                onClick={() => setShiftDraft((prev) =>
                                  prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]
                                )}
                                className={`text-xs font-mono px-1.5 py-0.5 rounded transition-colors ${
                                  shiftDraft.includes(st) ? shiftBadgeClass(st) : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                                }`}
                              >{st}</button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={async () => { await saveManualShift(day.date, shiftDraft); setEditingShiftDate(null); refresh() }}
                              className="text-xs text-indigo-400 font-medium hover:text-indigo-300"
                            >Save</button>
                            <button
                              onClick={() => setEditingShiftDate(null)}
                              className="text-xs text-gray-600 hover:text-gray-400"
                            >Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1 group">
                          {day.shiftTypes.length === 0 ? (
                            <button
                              onClick={() => { setEditingShiftDate(day.date); setShiftDraft([]) }}
                              className="text-xs text-amber-500/80 hover:text-amber-400 font-medium"
                            >+ Assign shift</button>
                          ) : (
                            <>
                              {day.shiftTypes.map((st) => (
                                <span key={st} className={`text-xs font-mono px-1.5 py-0.5 rounded ${shiftBadgeClass(st)}`}>
                                  {st}{day.isCallWeekend && isCallShift(st) && <span className="ml-1 opacity-70">WE</span>}
                                </span>
                              ))}
                              <button
                                onClick={() => { setEditingShiftDate(day.date); setShiftDraft(day.shiftTypes) }}
                                className="opacity-0 group-hover:opacity-100 ml-0.5 text-gray-700 hover:text-indigo-400 transition-all"
                                title="Edit shift"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{day.caseCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-indigo-400">{day.totalUnits.toFixed(2)}</span>
                        {outlier === 'high' && <span className="text-xs px-1 py-0.5 bg-emerald-900/40 text-emerald-400 rounded">↑ high</span>}
                        {outlier === 'low' && <span className="text-xs px-1 py-0.5 bg-amber-900/40 text-amber-400 rounded">↓ low</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-emerald-400">{day.unitPay > 0 ? formatCurrencyFull(day.unitPay) : '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{day.stipendAmount > 0 ? formatCurrencyFull(day.stipendAmount) : '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{day.additionalStipend > 0 ? formatCurrencyFull(day.additionalStipend) : '—'}</td>
                    <td className="px-4 py-3 font-semibold text-gray-100">{day.totalDayPay > 0 ? formatCurrencyFull(day.totalDayPay) : '—'}</td>
                    <td className="px-4 py-3">
                      {editingHoursDate === day.date ? (
                        <span className="flex items-center gap-1">
                          <input
                            type="number" step="0.5" placeholder="0"
                            value={hoursInput}
                            onChange={(e) => setHoursInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveHoursOverride(day.date)
                              if (e.key === 'Escape') setEditingHoursDate(null)
                            }}
                            className="w-16 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            autoFocus
                          />
                          <button onClick={() => saveHoursOverride(day.date)} className="text-indigo-400 hover:text-indigo-300 text-xs">✓</button>
                          <button onClick={() => setEditingHoursDate(null)} className="text-gray-600 hover:text-gray-400 text-xs">✕</button>
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingHoursDate(day.date); setHoursInput(day.hours > 0 ? day.hours.toFixed(1) : '') }}
                          className={`text-sm hover:text-indigo-400 transition-colors ${day.isOverridden ? 'text-amber-400' : 'text-gray-400'}`}
                        >
                          {formatHours(day.hours)}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-800 border-t border-gray-700">
                <td className="px-4 py-3 text-xs font-semibold text-gray-500 sticky left-0 z-10 bg-gray-800" colSpan={2}>Total</td>
                <td className="px-4 py-3 text-xs font-semibold text-gray-500" colSpan={2}></td>
                <td className="px-4 py-3 font-semibold text-emerald-400">{formatCurrencyFull(stats.unitCompensation)}</td>
                <td className="px-4 py-3 font-semibold text-gray-300">{formatCurrencyFull(stats.shiftStipends)}</td>
                <td className="px-4 py-3 font-semibold text-gray-300">{formatCurrencyFull(stats.additionalStipends)}</td>
                <td className="px-4 py-3 font-semibold text-emerald-400">{formatCurrencyFull(stats.totalCompensation)}</td>
                <td className="px-4 py-3 font-semibold text-gray-100">{formatHours(stats.totalHours)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      </section>

      {/* Scheduled — No Production */}
      {noProdDays.length > 0 && (
        <section className="mb-8">
          <button
            onClick={() => setShowNoProd((v) => !v)}
            className="flex items-center gap-2 mb-1 group"
          >
            <svg
              className={`w-3 h-3 text-gray-600 transition-transform ${showNoProd ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-300 group-hover:text-gray-100 transition-colors">
              Scheduled — No Production
            </h3>
            <span className="text-xs font-normal px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded">
              {noProdDays.length} day{noProdDays.length !== 1 ? 's' : ''}
            </span>
          </button>
          {showNoProd && <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Date', 'Shift', 'Stipend', 'Hours'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {noProdDays.map((day) => (
                  <tr key={day.date} className="border-b border-gray-800 opacity-70">
                    <td className="px-4 py-3 text-gray-400">{formatDateFull(day.date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {day.shiftTypes.map((st) => (
                          <span key={st} className={`text-xs font-mono px-1.5 py-0.5 rounded ${shiftBadgeClass(st)}`}>{st}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{day.stipendAmount > 0 ? formatCurrencyFull(day.stipendAmount) : '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{day.hours > 0 ? formatHours(day.hours) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </section>
      )}

      {/* Cases */}
      <section>
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          Cases
          {selectedDay ? (
            <>
              <span className="text-xs font-normal text-indigo-400">{formatDateFull(selectedDay)}</span>
              <button onClick={() => setSelectedDay(null)} className="text-xs text-gray-600 hover:text-gray-400">
                clear ×
              </button>
            </>
          ) : (
            <span className="text-xs font-normal text-gray-600">service date in {formatMonthYear(calYear, calMonth)}</span>
          )}
        </h3>
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-max">
            <thead>
              <tr className="border-b border-gray-800">
                {['Ticket', 'Date', 'Start', 'End', 'Procedure', 'Type', 'Modifier', 'Base Units', 'Time Units', 'Add-ons', 'Total Units', 'Split'].map((h, i) => (
                  <th key={h} className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider${i === 0 ? ' sticky left-0 z-10 bg-gray-900' : i === 1 ? ' sticky left-[104px] z-10 bg-gray-900' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleCases.map((c) => (
                <tr key={c.ticketNum} className="group border-b border-gray-800 hover:bg-gray-800">
                  <td className="px-4 py-3 font-mono text-xs text-gray-300 min-w-[104px] sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800">{c.ticketNum}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap min-w-[120px] sticky left-[104px] z-10 bg-gray-900 group-hover:bg-gray-800">{formatDateFull(c.serviceDate)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">{c.startTime ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">{c.endTime ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{c.primaryCptAsa}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px]">{getCptCategory(c.primaryCptAsa) ?? '—'}</td>
                  <td className="px-4 py-3">
                    {c.primaryModifier
                      ? <span className="bg-gray-800 text-gray-400 text-xs px-1.5 py-0.5 rounded font-mono">{c.primaryModifier}</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{c.primaryDistributionValue.toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-400">{c.primaryTimeUnits.toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-500">{c.addOnUnits > 0 ? `+${c.addOnUnits.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 font-semibold text-indigo-400">{c.totalUnits.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    {c.isSplit && <span className="bg-amber-900/40 text-amber-400 text-xs px-1.5 py-0.5 rounded">split</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-800 border-t border-gray-700">
                <td className="px-4 py-3 text-xs font-semibold text-gray-500 sticky left-0 z-10 bg-gray-800" colSpan={2}>Total</td>
                <td className="px-4 py-3 text-xs font-semibold text-gray-500" colSpan={7}></td>
                <td className="px-4 py-3 font-semibold text-indigo-400" colSpan={3}>
                  {visibleUnits.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      </section>
    </div>
  )
}
