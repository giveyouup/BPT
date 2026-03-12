import { useState, useMemo, useRef, useEffect, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { computeCalendarYearStats } from '../utils/calculations'
import { isOffDayShift } from '../utils/shiftUtils'
import { shiftBadgeClass } from '../utils/shiftUtils'
import { formatDateFull, getMonthName } from '../utils/dateUtils'

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getDow(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return DOW_NAMES[new Date(y, m - 1, d).getDay()]
}

function SectionBadge({ count, variant }: { count: number; variant: 'warn' | 'neutral' }) {
  if (count === 0) return null
  const cls = variant === 'warn'
    ? 'bg-amber-900/40 text-amber-400 border-amber-700/40'
    : 'bg-gray-800 text-gray-400 border-gray-700'
  return (
    <span className={`px-2 py-0.5 text-xs font-semibold border rounded-full ${cls}`}>
      {count} day{count !== 1 ? 's' : ''}
    </span>
  )
}

function EmptyCheck({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-emerald-900/10 border border-emerald-800/30 rounded-lg w-fit">
      <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      <span className="text-xs text-emerald-400">{message}</span>
    </div>
  )
}

export default function Audits() {
  const { reports, schedules, settings, stipendMappings, saveReport } = useData()
  const navigate = useNavigate()

  const now = new Date()

  const years = useMemo(() => {
    const s = new Set<number>()
    s.add(now.getFullYear())
    for (const r of reports) s.add(r.year)
    for (const sched of schedules)
      for (const e of sched.entries) {
        const y = parseInt(e.date.slice(0, 4))
        if (!isNaN(y)) s.add(y)
      }
    return [...s].sort((a, b) => b - a)
  }, [reports, schedules])

  const [selectedYear, setSelectedYear] = useState<number>(years[0] ?? now.getFullYear())
  const [reassignPopover, setReassignPopover] = useState<{ date: string; input: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (reassignPopover) setTimeout(() => dateInputRef.current?.focus(), 0)
  }, [reassignPopover?.date])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setReassignPopover(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const yearStats = useMemo(
    () => computeCalendarYearStats(selectedYear, reports, schedules, settings, stipendMappings),
    [selectedYear, reports, schedules, settings, stipendMappings]
  )

  const allDays = useMemo(() => yearStats.flatMap(m => m.workingDays), [yearStats])

  // Section 1: production that landed on a non-working day and couldn't be attributed
  const orphanedProduction = useMemo(
    () => allDays
      .filter(d => d.hasProduction && (d.shiftTypes.length === 0 || d.shiftTypes.every(isOffDayShift)))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [allDays]
  )

  // Cutoff: latest date with production — days after this have no uploaded billing data yet
  const billingCutoff = useMemo(() => {
    let max = ''
    for (const d of allDays) if (d.hasProduction && d.date > max) max = d.date
    return max || null
  }, [allDays])

  // Section 2: scheduled working shifts with zero production (excludes V/H/Postcall and post-cutoff days)
  const noProdDays = useMemo(
    () => allDays
      .filter(d =>
        !d.hasProduction &&
        d.shiftTypes.length > 0 &&
        !d.shiftTypes.every(isOffDayShift) &&
        (billingCutoff === null || d.date <= billingCutoff)
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
    [allDays, billingCutoff]
  )

  // Working day set — used to warn when reassigning to a non-working day
  const workingDaySet = useMemo(
    () => new Set(allDays.filter(d => d.shiftTypes.length > 0 && !d.shiftTypes.every(isOffDayShift)).map(d => d.date)),
    [allDays]
  )

  function goToDashboard(date: string) {
    navigate('/', { state: { date } })
  }

  async function handleReassign() {
    if (!reassignPopover) return
    const { date: fromDate, input: toDate } = reassignPopover
    if (!toDate || toDate === fromDate) { setReassignPopover(null); return }

    setSaving(true)
    try {
      // Find all reports containing line items on fromDate and mutate their serviceDate
      const affected = reports.filter(r => r.lineItems.some(li => li.serviceDate === fromDate))
      await Promise.all(
        affected.map(r =>
          saveReport({
            ...r,
            lineItems: r.lineItems.map(li =>
              li.serviceDate === fromDate ? { ...li, serviceDate: toDate } : li
            ),
          })
        )
      )
      setReassignPopover(null)
    } finally {
      setSaving(false)
    }
  }

  // Tally for Section 2: count days per shift-type group
  const noProdTally = useMemo(() => {
    const GROUPS: { key: string; label: string; match: (s: string) => boolean }[] = [
      { key: 'G',   label: 'G Shifts', match: s => s.startsWith('G') },
      { key: 'FS',  label: 'FS',       match: s => s.startsWith('FS') },
      { key: 'A',   label: 'A Shifts',  match: s => s.startsWith('A') && s !== 'APS' },
      { key: 'APS', label: 'APS',      match: s => s === 'APS' },
      { key: 'NIR', label: 'NIR',      match: s => s === 'NIR' },
      { key: 'BR',  label: 'BR',       match: s => s === 'BR' },
      { key: 'ROC', label: 'ROC',      match: s => s === 'ROC' },
      { key: 'CC',  label: 'CC',       match: s => s === 'CC' },
    ]
    const knownMatch = (s: string) => GROUPS.some(g => g.match(s))
    const result: { key: string; label: string; count: number }[] = GROUPS.map(g => ({ ...g, count: 0 }))
    let otherCount = 0
    for (const day of noProdDays) {
      const matched = new Set<string>()
      for (const st of day.shiftTypes) {
        const g = GROUPS.find(g => g.match(st))
        if (g) matched.add(g.key)
        else if (!knownMatch(st)) otherCount++
      }
      for (const key of matched) {
        const entry = result.find(r => r.key === key)
        if (entry) entry.count++
      }
    }
    const out = result.filter(r => r.count > 0)
    if (otherCount > 0) out.push({ key: 'other', label: 'Other', count: otherCount })
    return out
  }, [noProdDays])

  const hasData = yearStats.length > 0

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <h2 className="text-2xl font-bold text-gray-100">Audits</h2>
        <select
          value={selectedYear}
          onChange={e => { setSelectedYear(Number(e.target.value)); setReassignPopover(null) }}
          className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {!hasData && (
        <p className="text-gray-500 text-sm">
          No data found for {selectedYear}. Upload reports and a schedule to see audit results.
        </p>
      )}

      {hasData && (
        <div className="space-y-12">

          {/* ── Section 1: Production on non-working days ───────────────────── */}
          <section>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                Production on Non-Working Days
              </h3>
              <SectionBadge count={orphanedProduction.length} variant="warn" />
            </div>
            <p className="text-xs text-gray-600 mb-4">
              Cases recorded on unscheduled, V, H, or Postcall days that could not be attributed
              to a nearby working day via shared ticket number. Use Reassign to correct the service date in the source report.
            </p>

            {orphanedProduction.length === 0 ? (
              <EmptyCheck message={`No orphaned production found for ${selectedYear}`} />
            ) : (
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Day</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Scheduled As</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Cases</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Units</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {orphanedProduction.map(day => {
                        const isOpen = reassignPopover?.date === day.date
                        const targetIsNonWorking = reassignPopover?.input
                          ? reassignPopover.input.length === 10 && !workingDaySet.has(reassignPopover.input)
                          : false

                        return (
                          <Fragment key={day.date}>
                            <tr className={`border-b border-gray-800 ${isOpen ? 'bg-indigo-950/30' : 'hover:bg-gray-800/40'}`}>
                              <td onClick={() => goToDashboard(day.date)} className="px-4 py-3 text-gray-200 whitespace-nowrap cursor-pointer hover:text-indigo-400 transition-colors">{formatDateFull(day.date)}</td>
                              <td onClick={() => goToDashboard(day.date)} className="px-4 py-3 text-gray-500 whitespace-nowrap cursor-pointer hover:text-indigo-400 transition-colors">{getDow(day.date)}</td>
                              <td onClick={() => goToDashboard(day.date)} className="px-4 py-3 cursor-pointer group">
                                {day.shiftTypes.length === 0 ? (
                                  <span className="text-xs text-gray-600 italic group-hover:text-indigo-400 transition-colors">Unscheduled</span>
                                ) : (
                                  <div className="flex gap-1 flex-wrap">
                                    {day.shiftTypes.map(st => (
                                      <span key={st} className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${shiftBadgeClass(st)}`}>{st}</span>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-amber-400">{day.caseCount}</td>
                              <td className="px-4 py-3 text-right font-semibold text-amber-300">{day.totalUnits.toFixed(2)}</td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={() => setReassignPopover(isOpen ? null : { date: day.date, input: '' })}
                                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                                    isOpen
                                      ? 'bg-indigo-600 border-indigo-500 text-white'
                                      : 'border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500'
                                  }`}
                                >
                                  Reassign
                                </button>
                              </td>
                            </tr>

                            {/* Reassign sub-row */}
                            {isOpen && (
                              <tr className="border-b border-gray-800 bg-indigo-950/20">
                                <td colSpan={6} className="px-4 py-3">
                                  <div className="sticky left-0 w-fit">
                                    <p className="text-xs text-gray-400 mb-2">
                                      Reassign all line items from <span className="text-gray-200 font-medium">{formatDateFull(day.date)}</span> to:
                                    </p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <input
                                        ref={dateInputRef}
                                        type="date"
                                        value={reassignPopover!.input}
                                        onChange={e => setReassignPopover(p => p ? { ...p, input: e.target.value } : null)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleReassign() }}
                                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                      />
                                      {targetIsNonWorking && (
                                        <span className="text-xs text-amber-400 flex items-center gap-1">
                                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                          </svg>
                                          Target is not a scheduled working day
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-2.5">
                                      <button
                                        onClick={handleReassign}
                                        disabled={saving || !reassignPopover!.input}
                                        className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                                      >
                                        {saving ? 'Saving…' : 'Save'}
                                      </button>
                                      <button
                                        onClick={() => setReassignPopover(null)}
                                        className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-800/60 border-t border-gray-700">
                        <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-gray-500">
                          {orphanedProduction.length} day{orphanedProduction.length !== 1 ? 's' : ''}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-bold text-amber-400">
                          {orphanedProduction.reduce((s, d) => s + d.caseCount, 0)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-bold text-amber-300">
                          {orphanedProduction.reduce((s, d) => s + d.totalUnits, 0).toFixed(2)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ── Section 2: Scheduled working days with no production ─────────── */}
          <section>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                Scheduled Days with No Production
              </h3>
              <SectionBadge count={noProdDays.length} variant="neutral" />
            </div>
            <p className="text-xs text-gray-600 mb-3">
              Scheduled working shifts with no PCR cases recorded. V, H, and Postcall days are excluded.
            </p>
            {billingCutoff && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-gray-800/60 border border-gray-700/60 rounded-lg w-fit">
                <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs text-gray-500">
                  Showing days through{' '}
                  <span className="text-gray-300 font-medium">{formatDateFull(billingCutoff)}</span>
                  {' '}— days after this date lack uploaded billing data
                </span>
              </div>
            )}

            {/* Shift-type tally chips */}
            {noProdTally.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mb-4">
                {noProdTally.map(({ key, label, count }) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300"
                  >
                    <span className="text-gray-500 font-normal">{label}</span>
                    <span className="font-bold text-gray-100">{count}</span>
                  </span>
                ))}
              </div>
            )}

            {noProdDays.length === 0 ? (
              <EmptyCheck message={`All scheduled working days have production for ${selectedYear}`} />
            ) : (
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Day</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Shift</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {noProdDays.map(day => (
                        <tr key={day.date} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                          <td className="px-4 py-3 text-gray-200 whitespace-nowrap">{formatDateFull(day.date)}</td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{getDow(day.date)}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1 flex-wrap">
                              {day.shiftTypes.map(st => (
                                <span key={st} className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${shiftBadgeClass(st)}`}>{st}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                            {getMonthName(parseInt(day.date.slice(5, 7)))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-800/60 border-t border-gray-700">
                        <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-gray-500">
                          {noProdDays.length} day{noProdDays.length !== 1 ? 's' : ''}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </section>

        </div>
      )}
    </div>
  )
}
