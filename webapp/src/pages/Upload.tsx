import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseXlsx, detectMonthYear } from '../utils/xlsxParser'
import { saveReport, getReport, getSettings, getSchedules, saveSchedule, deleteSchedule, getStipendMappings, saveStipendMapping, deleteStipendMapping } from '../utils/storage'
import { parseICS } from '../utils/icsParser'
import { parseStipendMapping } from '../utils/stipendMappingParser'
import { parseShiftSummary } from '../utils/shiftUtils'
import { formatMonthYear, formatDateFull } from '../utils/dateUtils'
import type { LineItem, ShiftEntry, Schedule, StipendMapping } from '../types'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function genId() { return `sched-${Date.now()}-${Math.random().toString(36).slice(2)}` }

// ─── PCR Upload ───────────────────────────────────────────────────────────────

function PcrUploadTab() {
  const navigate = useNavigate()
  const settings = getSettings()

  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<LineItem[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [unitValue, setUnitValue] = useState('32.00')
  const [paddingMins, setPaddingMins] = useState(String(settings.defaultPaddingMinutes))
  const [noTimeHours, setNoTimeHours] = useState(String(settings.defaultNoTimeHours))
  const [saving, setSaving] = useState(false)

  const handleFile = useCallback(async (f: File) => {
    setFile(f)
    setParseError(null)
    setParsed(null)
    const detected = detectMonthYear(f.name)
    if (detected) { setMonth(detected.month); setYear(detected.year) }
    try {
      const items = parseXlsx(await f.arrayBuffer())
      setParsed(items)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse file')
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const reportId = `${year}-${String(month).padStart(2, '0')}`
  const existing = getReport(reportId)

  const totalUnits = parsed ? parsed.reduce((s, li) => s + li.totalDistributableUnits, 0) : 0
  const uniqueTickets = parsed ? new Set(parsed.map((li) => li.ticketNum)).size : 0
  const serviceDates = parsed ? [...new Set(parsed.map((li) => li.serviceDate))].sort() : []

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const crossMonthCount = parsed
    ? parsed.filter((li) => !li.serviceDate.startsWith(monthPrefix)).length
    : 0

  const handleSave = async () => {
    if (!parsed) return
    setSaving(true)
    const report = {
      id: reportId,
      year,
      month,
      filename: file!.name,
      uploadDate: new Date().toISOString(),
      unitDollarValue: parseFloat(unitValue) || 32,
      paddingMinutes: parseInt(paddingMins) || 30,
      defaultNoTimeHours: parseFloat(noTimeHours) || 4,
      lineItems: parsed,
      workingDayOverrides: existing?.workingDayOverrides ?? {},
      dayStipends: existing?.dayStipends ?? {},
      stipends: existing?.stipends ?? [],
    }
    saveReport(report)
    setSaving(false)
    navigate(`/month/${reportId}`)
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors mb-6 ${
          dragging
            ? 'border-indigo-500 bg-indigo-500/5'
            : file
            ? 'border-emerald-600 bg-emerald-500/5'
            : 'border-gray-700 hover:border-indigo-600 hover:bg-gray-800/50'
        }`}
      >
        {file ? (
          <div>
            <div className="w-10 h-10 bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-200">{file.name}</p>
            <button onClick={() => { setFile(null); setParsed(null) }}
              className="text-xs text-gray-500 hover:text-gray-300 mt-1">Remove</button>
          </div>
        ) : (
          <div>
            <svg className="w-10 h-10 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gray-400 mb-1">Drop your .xlsx file here</p>
            <label className="cursor-pointer">
              <span className="text-xs text-indigo-400 font-medium hover:text-indigo-300">or click to browse</span>
              <input type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            </label>
          </div>
        )}
      </div>

      {parseError && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 mb-6 text-sm text-red-400">
          {parseError}
        </div>
      )}

      {parsed && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl px-4 py-4 mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Preview</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-xs text-gray-500">Line Items</p>
              <p className="text-lg font-bold text-gray-100">{parsed.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Unique Cases</p>
              <p className="text-lg font-bold text-gray-100">{uniqueTickets}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Units</p>
              <p className="text-lg font-bold text-indigo-400">{totalUnits.toFixed(2)}</p>
            </div>
          </div>
          {serviceDates.length > 0 && (
            <p className="text-xs text-gray-500">
              Service dates: {serviceDates[0]} → {serviceDates[serviceDates.length - 1]}
              {' '}({serviceDates.length} days)
            </p>
          )}
          {crossMonthCount > 0 && (
            <p className="text-xs text-amber-500 mt-1">
              {crossMonthCount} line item{crossMonthCount !== 1 ? 's' : ''} with service dates outside {MONTH_NAMES[month - 1]} {year}.
            </p>
          )}
        </div>
      )}

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Month</label>
            <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className={inputCls}>
              {MONTH_NAMES.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Year</label>
            <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value))} className={inputCls} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1.5">Dollar Value per Unit ($)</label>
          <input type="number" step="0.01" value={unitValue}
            onChange={(e) => setUnitValue(e.target.value)} placeholder="32.00" className={inputCls} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Hours Padding (minutes)</label>
            <input type="number" value={paddingMins} onChange={(e) => setPaddingMins(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Default Hours (no-time days)</label>
            <input type="number" step="0.5" value={noTimeHours} onChange={(e) => setNoTimeHours(e.target.value)} className={inputCls} />
          </div>
        </div>

        {existing && (
          <div className="bg-amber-900/20 border border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-400">
            A report for {formatMonthYear(year, month)} already exists. Saving will replace it
            (stipends and hour overrides will be preserved).
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!parsed || saving}
          className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : `Save ${formatMonthYear(year, month)} Report`}
        </button>
      </div>
    </div>
  )
}

// ─── Schedule Upload ──────────────────────────────────────────────────────────

interface ConflictEntry {
  date: string
  currentShifts: string[]
  newShifts: string[]
  accept: boolean
}

function ScheduleUploadTab() {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsedEvents, setParsedEvents] = useState<Array<{ date: string; summary: string }> | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [showRangeModal, setShowRangeModal] = useState(false)

  const [conflicts, setConflicts] = useState<ConflictEntry[]>([])
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [pendingEntries, setPendingEntries] = useState<ShiftEntry[]>([])

  const [saved, setSaved] = useState(false)

  const handleFile = useCallback(async (f: File) => {
    setFile(f)
    setParseError(null)
    setParsedEvents(null)
    setSaved(false)
    try {
      const text = await f.text()
      const events = parseICS(text)
      if (events.length === 0) {
        setParseError('No all-day events found in this ICS file.')
        return
      }
      setParsedEvents(events)
      // Default date range to span of events
      const dates = events.map((e) => e.date).sort()
      setRangeStart(dates[0])
      setRangeEnd(dates[dates.length - 1])
      setShowRangeModal(true)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse ICS file')
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const filteredEvents = parsedEvents?.filter(
    (e) => (!rangeStart || e.date >= rangeStart) && (!rangeEnd || e.date <= rangeEnd)
  ) ?? []

  const handleReviewImport = () => {
    setShowRangeModal(false)

    // Group multiple events per date into shiftTypes[]
    const byDate = new Map<string, string[]>()
    for (const e of filteredEvents) {
      if (!byDate.has(e.date)) byDate.set(e.date, [])
      byDate.get(e.date)!.push(...parseShiftSummary(e.summary))
    }
    const newEntries: ShiftEntry[] = [...byDate.entries()].map(([date, shiftTypes]) => ({ date, shiftTypes }))

    // Check for conflicts with existing schedules
    const existing = getSchedules()
    const existingMap = new Map<string, string[]>()
    const sortedExisting = [...existing].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
    for (const sched of sortedExisting) {
      for (const entry of sched.entries) {
        existingMap.set(entry.date, entry.shiftTypes)
      }
    }

    const detected: ConflictEntry[] = []
    for (const entry of newEntries) {
      const current = existingMap.get(entry.date)
      const currentSorted = current ? [...current].sort().join(',') : ''
      const newSorted = [...entry.shiftTypes].sort().join(',')
      if (current && currentSorted !== newSorted) {
        detected.push({
          date: entry.date,
          currentShifts: current,
          newShifts: entry.shiftTypes,
          accept: true,
        })
      }
    }

    setPendingEntries(newEntries)

    if (detected.length > 0) {
      setConflicts(detected)
      setShowConflictModal(true)
    } else {
      doSave(newEntries, [])
    }
  }

  const doSave = (entries: ShiftEntry[], rejectedDates: string[]) => {
    const finalEntries = entries.filter((e) => !rejectedDates.includes(e.date))
    const schedule: Schedule = {
      id: genId(),
      filename: file!.name,
      uploadDate: new Date().toISOString(),
      entries: finalEntries,
    }
    saveSchedule(schedule)
    setSaved(true)
    setShowConflictModal(false)
    setParsedEvents(null)
    setFile(null)
  }

  const handleApplyConflicts = () => {
    const rejected = conflicts.filter((c) => !c.accept).map((c) => c.date)
    doSave(pendingEntries, rejected)
  }

  const existingSchedules = getSchedules()

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors mb-6 ${
          dragging
            ? 'border-indigo-500 bg-indigo-500/5'
            : file && !saved
            ? 'border-emerald-600 bg-emerald-500/5'
            : 'border-gray-700 hover:border-indigo-600 hover:bg-gray-800/50'
        }`}
      >
        {file && !saved ? (
          <div>
            <div className="w-10 h-10 bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-200">{file.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{parsedEvents?.length ?? 0} events parsed</p>
            <button onClick={() => { setFile(null); setParsedEvents(null) }}
              className="text-xs text-gray-500 hover:text-gray-300 mt-1">Remove</button>
          </div>
        ) : (
          <div>
            <svg className="w-10 h-10 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-gray-400 mb-1">Drop your .ics schedule file here</p>
            <label className="cursor-pointer">
              <span className="text-xs text-indigo-400 font-medium hover:text-indigo-300">or click to browse</span>
              <input type="file" accept=".ics" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            </label>
          </div>
        )}
      </div>

      {saved && (
        <div className="bg-emerald-900/30 border border-emerald-800 rounded-lg px-4 py-3 mb-6 text-sm text-emerald-400">
          Schedule imported successfully.
        </div>
      )}

      {parseError && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 mb-6 text-sm text-red-400">
          {parseError}
        </div>
      )}

      {/* Existing schedules */}
      {existingSchedules.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300">Imported Schedules</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['File', 'Imported', 'Entries'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {[...existingSchedules].reverse().map((s) => (
                <tr key={s.id} className="border-b border-gray-800">
                  <td className="px-4 py-3 text-gray-300">{s.filename}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(s.uploadDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{s.entries.length}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        if (!confirm('Remove this schedule? Shift data will be lost.')) return
                        deleteSchedule(s.id)
                        setSaved((v) => !v) // force re-render
                      }}
                      className="text-gray-700 hover:text-red-400 text-xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Date range modal */}
      {showRangeModal && parsedEvents && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-base font-semibold text-gray-100 mb-1">Select Date Range</h3>
            <p className="text-xs text-gray-500 mb-4">
              {parsedEvents.length} events found. Choose which dates to import.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">From</label>
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">To</label>
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-5">
              {filteredEvents.length} events in selected range
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleReviewImport}
                disabled={filteredEvents.length === 0}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40"
              >
                Review Import
              </button>
              <button
                onClick={() => { setShowRangeModal(false); setFile(null); setParsedEvents(null) }}
                className="px-4 py-2 text-gray-400 hover:text-gray-200 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict resolution modal */}
      {showConflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
            <h3 className="text-base font-semibold text-gray-100 mb-1">Resolve Conflicts</h3>
            <p className="text-xs text-gray-500 mb-4">
              {conflicts.length} date{conflicts.length !== 1 ? 's' : ''} already have shift assignments.
              Choose which changes to apply.
            </p>
            <div className="flex-1 overflow-y-auto mb-4">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="border-b border-gray-800">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Current</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">New</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Accept</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((c, i) => (
                    <tr key={c.date} className="border-b border-gray-800">
                      <td className="px-3 py-2.5 text-gray-300">{formatDateFull(c.date)}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">{c.currentShifts.join(', ')}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs bg-indigo-900/40 text-indigo-400 px-2 py-0.5 rounded">{c.newShifts.join(', ')}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={c.accept}
                          onChange={(e) =>
                            setConflicts((prev) =>
                              prev.map((x, j) => j === i ? { ...x, accept: e.target.checked } : x)
                            )
                          }
                          className="accent-indigo-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 border-t border-gray-800 pt-4">
              <button
                onClick={() => setConflicts((prev) => prev.map((c) => ({ ...c, accept: true })))}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Accept all
              </button>
              <button
                onClick={() => setConflicts((prev) => prev.map((c) => ({ ...c, accept: false })))}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Reject all
              </button>
              <div className="flex-1" />
              <button
                onClick={() => { setShowConflictModal(false); setFile(null); setParsedEvents(null) }}
                className="px-4 py-2 text-gray-400 hover:text-gray-200 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyConflicts}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
              >
                Apply Selected Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Stipend Rates Upload ─────────────────────────────────────────────────────

function StipendRatesTab() {
  const today = new Date()
  const defaultEffective = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`

  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [rates, setRates] = useState<StipendMapping['rates'] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [effectiveDate, setEffectiveDate] = useState(defaultEffective)
  const [saved, setSaved] = useState(false)
  const [tick, setTick] = useState(0)

  const handleFile = useCallback(async (f: File) => {
    setFile(f); setRates(null); setParseError(null); setSaved(false)
    try {
      const parsed = parseStipendMapping(await f.arrayBuffer())
      if (parsed.length === 0) {
        setParseError('No valid shift→amount rows found. Expected 2-column spreadsheet (shift name, dollar amount).')
        return
      }
      setRates(parsed)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse file')
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) handleFile(f)
  }, [handleFile])

  const handleSave = () => {
    if (!rates || !file) return
    const mapping: StipendMapping = {
      id: genId(),
      name: file.name.replace(/\.[^.]+$/, ''),
      filename: file.name,
      uploadDate: new Date().toISOString(),
      effectiveDate,
      rates,
    }
    saveStipendMapping(mapping)
    setSaved(true); setFile(null); setRates(null)
  }

  const existingMappings = getStipendMappings()

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors mb-6 ${
          dragging ? 'border-indigo-500 bg-indigo-500/5'
          : file && !saved ? 'border-emerald-600 bg-emerald-500/5'
          : 'border-gray-700 hover:border-indigo-600 hover:bg-gray-800/50'
        }`}
      >
        {file && !saved ? (
          <div>
            <div className="w-10 h-10 bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-200">{file.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{rates?.length ?? 0} shift rates found</p>
            <button onClick={() => { setFile(null); setRates(null) }}
              className="text-xs text-gray-500 hover:text-gray-300 mt-1">Remove</button>
          </div>
        ) : (
          <div>
            <svg className="w-10 h-10 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-gray-400 mb-1">Drop your stipend rates .xlsx file here</p>
            <p className="text-xs text-gray-600 mb-2">2-column spreadsheet: shift name | dollar amount</p>
            <label className="cursor-pointer">
              <span className="text-xs text-indigo-400 font-medium hover:text-indigo-300">or click to browse</span>
              <input type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            </label>
          </div>
        )}
      </div>

      {saved && (
        <div className="bg-emerald-900/30 border border-emerald-800 rounded-lg px-4 py-3 mb-6 text-sm text-emerald-400">
          Stipend rates saved successfully.
        </div>
      )}

      {parseError && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 mb-6 text-sm text-red-400">
          {parseError}
        </div>
      )}

      {rates && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-4 mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Effective Date</p>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-600">Rates apply to all service dates on or after this date</p>
          </div>
          <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
            {rates.map((r) => (
              <div key={r.shiftType} className="flex justify-between text-xs py-1 px-2 rounded hover:bg-gray-800">
                <span className="font-mono text-gray-400">{r.shiftType}</span>
                <span className="text-emerald-400">${r.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <button
            onClick={handleSave}
            className="mt-4 w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            Save Stipend Rates
          </button>
        </div>
      )}

      {existingMappings.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300">Saved Stipend Rate Versions</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['File', 'Effective Date', 'Rates'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {[...existingMappings].reverse().map((m) => (
                <tr key={m.id} className="border-b border-gray-800">
                  <td className="px-4 py-3 text-gray-300">{m.filename}</td>
                  <td className="px-4 py-3 text-gray-300">{formatDateFull(m.effectiveDate)}</td>
                  <td className="px-4 py-3 text-gray-400">{m.rates.length}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { deleteStipendMapping(m.id); setTick((v) => v + 1) }}
                      className="text-gray-700 hover:text-red-400 text-xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="hidden">{tick}</span>
    </div>
  )
}

// ─── Main Upload page ─────────────────────────────────────────────────────────

export default function Upload() {
  const [tab, setTab] = useState<'pcr' | 'schedule' | 'stipend'>('pcr')

  const tabCls = (t: typeof tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? 'border-indigo-500 text-indigo-400'
        : 'border-transparent text-gray-500 hover:text-gray-300'
    }`

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-100 mb-6">Upload</h2>

      <div className="flex border-b border-gray-800 mb-6">
        <button className={tabCls('pcr')} onClick={() => setTab('pcr')}>PCR Report</button>
        <button className={tabCls('schedule')} onClick={() => setTab('schedule')}>Schedule</button>
        <button className={tabCls('stipend')} onClick={() => setTab('stipend')}>Stipend Rates</button>
      </div>

      {tab === 'pcr' && <PcrUploadTab />}
      {tab === 'schedule' && <ScheduleUploadTab />}
      {tab === 'stipend' && <StipendRatesTab />}
    </div>
  )
}
