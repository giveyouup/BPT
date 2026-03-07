import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { computeMonthlyStats, getApplicableMapping } from '../utils/calculations'
import {
  formatMonthYear, formatDateFull, formatHours, formatCurrency, formatCurrencyFull,
} from '../utils/dateUtils'
import StatCard from '../components/StatCard'
import { getCptCategory } from '../utils/cptLookup'

const inputCls = 'border border-gray-700 bg-gray-800 text-gray-100 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function MonthlyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = () => setRefreshKey((k) => k + 1)

  // $/unit edit
  const [editingUnitValue, setEditingUnitValue] = useState(false)
  const [unitValueInput, setUnitValueInput] = useState('')

  // Case filter
  const [caseFilter, setCaseFilter] = useState('')

  const { reports, schedules: allSchedules, settings, stipendMappings: allMappings, saveReport, deleteReport } = useData()

  if (!id) return null
  const liveReport = reports.find((r) => r.id === id)
  if (!liveReport) {
    return (
      <div className="p-4 md:p-8 text-gray-500">
        Report not found.{' '}
        <button onClick={() => navigate('/')} className="text-indigo-400">Go home</button>
      </div>
    )
  }

  // Suppress unused warning on refreshKey
  void refreshKey

  const liveStats = computeMonthlyStats(liveReport, allSchedules, settings, allMappings)
  const autoMapping = getApplicableMapping(liveReport.year, liveReport.month, allMappings)

  const calendarYearMonth = `${liveReport.year}-${String(liveReport.month).padStart(2, '0')}`

  // ── $/unit ───────────────────────────────────────────────────────────────
  const saveUnitValue = async () => {
    const val = parseFloat(unitValueInput)
    if (isNaN(val) || val <= 0) return
    await saveReport({ ...liveReport, unitDollarValue: val })
    setEditingUnitValue(false)
    refresh()
  }

  const handleDelete = async () => {
    if (!confirm(`Delete ${formatMonthYear(liveReport.year, liveReport.month)} report? This cannot be undone.`)) return
    await deleteReport(liveReport.id)
    navigate('/')
  }

  // ── Case filter ──────────────────────────────────────────────────────────
  const filteredCases = liveStats.cases.filter((c) => {
    if (!caseFilter.trim()) return true
    const q = caseFilter.toLowerCase().trim()
    return (
      c.ticketNum.toLowerCase().includes(q) ||
      c.serviceDate.includes(q) ||
      formatDateFull(c.serviceDate).toLowerCase().includes(q)
    )
  })
  const filteredTotal = filteredCases.reduce((s, c) => s + c.totalUnits, 0)


  return (
    <div className="p-4 md:p-8">
      {/* Raw data notice */}
      <div className="flex items-center gap-2 mb-5 px-3 py-2 bg-amber-900/20 border border-amber-800/40 rounded-lg w-fit">
        <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-xs font-medium text-amber-400 uppercase tracking-wide">Raw PCR Report</span>
        <span className="text-gray-700">·</span>
        <span className="text-xs text-amber-600">Line items as uploaded — dates reflect billing period, not service attribution</span>
        <span className="text-gray-700">·</span>
        <button
          onClick={() => navigate(`/calendar/${calendarYearMonth}`)}
          className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
        >
          View {formatMonthYear(liveReport.year, liveReport.month)} calendar
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">
            {formatMonthYear(liveReport.year, liveReport.month)}
          </h2>
          <div className="flex items-center gap-1.5 mt-0.5 text-sm text-gray-500 flex-wrap">
            <span>{liveReport.filename}</span>
            <span>&middot;</span>
            {editingUnitValue ? (
              <span className="inline-flex items-center gap-1.5">
                <span>$</span>
                <input type="number" step="0.01" value={unitValueInput}
                  onChange={(e) => setUnitValueInput(e.target.value)}
                  className={`${inputCls} w-20 px-1.5 py-0.5 text-xs`}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') saveUnitValue(); if (e.key === 'Escape') setEditingUnitValue(false) }}
                />
                <span>/unit</span>
                <button onClick={saveUnitValue} className="text-xs text-indigo-400 font-medium hover:text-indigo-300">Save</button>
                <button onClick={() => setEditingUnitValue(false)} className="text-xs text-gray-600 hover:text-gray-400">Cancel</button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <span>${liveReport.unitDollarValue.toFixed(2)}/unit</span>
                <button onClick={() => { setUnitValueInput(liveReport.unitDollarValue.toFixed(2)); setEditingUnitValue(true) }}
                  className="text-gray-700 hover:text-indigo-400 transition-colors" title="Edit $/unit">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </span>
            )}
            <span>&middot;</span>
            <span>{liveReport.paddingMinutes}min padding</span>
          </div>
        </div>
        <button onClick={handleDelete}
          className="text-xs text-red-500 hover:text-red-400 px-3 py-1.5 border border-red-900 rounded-lg">
          Delete Report
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        <StatCard label="Cases" value={String(liveStats.totalCases)} />
        <StatCard label="Total Units" value={liveStats.totalDistributableUnits.toFixed(2)} color="indigo" />
        <StatCard label="Unit Pay" value={formatCurrency(liveStats.unitCompensation)} color="green" />
        <StatCard label="Total Pay" value={formatCurrency(liveStats.totalCompensation)} color="green"
          sub={liveStats.totalStipends > 0 ? `Incl. ${formatCurrency(liveStats.totalStipends)} stipends` : undefined} />
        <StatCard label="Hours Worked" value={formatHours(liveStats.totalHours)} sub={`${liveStats.daysWorked} days`} />
      </div>
      {/* Cases */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            Line Items
            {caseFilter.trim() && (
              <span className="text-xs font-normal text-gray-500">
                {filteredCases.length} of {liveStats.cases.length}
              </span>
            )}
          </h3>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Filter by ticket or date…"
              value={caseFilter} onChange={(e) => setCaseFilter(e.target.value)}
              className={`${inputCls} pl-8 pr-7 py-1.5 text-xs w-52`}
            />
            {caseFilter && (
              <button onClick={() => setCaseFilter('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Ticket', 'Date', 'Start', 'End', 'Procedure', 'Type', 'Modifier', 'Base Units', 'Time Units', 'Add-ons', 'Total Units', 'Split'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-600">
                    No cases match "{caseFilter}"
                  </td>
                </tr>
              ) : filteredCases.map((c) => (
                <tr key={c.ticketNum} className="border-b border-gray-800 hover:bg-gray-800">
                  <td className="px-4 py-3 font-mono text-xs text-gray-300">{c.ticketNum}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDateFull(c.serviceDate)}</td>
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
                  <td className="px-4 py-3 flex items-center gap-1 flex-wrap">
                    {c.isSplit && <span className="bg-amber-900/40 text-amber-400 text-xs px-1.5 py-0.5 rounded">split</span>}
                    {!c.serviceDate.startsWith(`${liveReport.year}-${String(liveReport.month).padStart(2, '0')}`) && (
                      <span className="bg-gray-800 text-gray-500 text-xs px-1.5 py-0.5 rounded">cross-month</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-800 border-t border-gray-700">
                <td className="px-4 py-3 text-xs font-semibold text-gray-500" colSpan={9}>
                  {caseFilter.trim() ? 'Filtered Total' : 'Total'}
                </td>
                <td className="px-4 py-3 font-semibold text-indigo-400" colSpan={3}>{filteredTotal.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Compensation Summary */}
      <section>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Compensation Summary</h3>
        <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
          <div className="flex justify-between items-center px-5 py-4">
            <div>
              <p className="text-sm text-gray-300">Unit-Based Compensation</p>
              <p className="text-xs text-gray-600 mt-0.5">
                {liveStats.totalDistributableUnits.toFixed(2)} units × ${liveReport.unitDollarValue.toFixed(2)}/unit
              </p>
            </div>
            <p className="text-base font-semibold text-gray-100">{formatCurrencyFull(liveStats.unitCompensation)}</p>
          </div>
          {liveStats.shiftStipends > 0 && (
            <div className="flex justify-between items-center px-5 py-4">
              <div>
                <p className="text-sm text-gray-300">Shift-Based Stipends</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  Auto-computed from stipend rates
                  {autoMapping ? ` (eff. ${autoMapping.effectiveDate})` : ''}
                </p>
              </div>
              <p className="text-base font-semibold text-gray-100">{formatCurrencyFull(liveStats.shiftStipends)}</p>
            </div>
          )}
          {liveStats.additionalStipends > 0 && (
            <div className="flex justify-between items-center px-5 py-4">
              <p className="text-sm text-gray-300">Additional Stipend</p>
              <p className="text-base font-semibold text-gray-100">{formatCurrencyFull(liveStats.additionalStipends)}</p>
            </div>
          )}
          <div className="flex justify-between items-center px-5 py-4 bg-emerald-900/10">
            <p className="text-sm font-bold text-gray-100">Total Compensation</p>
            <p className="text-xl font-bold text-emerald-400">{formatCurrencyFull(liveStats.totalCompensation)}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
