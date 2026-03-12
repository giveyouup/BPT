import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseXlsx, detectMonthYear } from '../utils/xlsxParser'
import { parseICS } from '../utils/icsParser'
import { parseStipendMapping } from '../utils/stipendMappingParser'
import { parseShiftSummary } from '../utils/shiftUtils'
import { formatMonthYear, formatDateFull } from '../utils/dateUtils'
import { useData } from '../context/DataContext'
import type { LineItem, ShiftEntry, Schedule, StipendMapping, StipendRate } from '../types'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function genId() { return `sched-${Date.now()}-${Math.random().toString(36).slice(2)}` }

// ─── Shared helpers ───────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const PICKER_YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 3 + i)
const SEL_CLS = 'bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500'

function lastDayOfMonthStr(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function stipendDateRange(m: StipendMapping, nextM: StipendMapping | null): string {
  const [y, mo] = m.effectiveDate.split('-').map(Number)
  const from = formatMonthYear(y, mo)
  if (m.endDate) {
    const [ey, emo] = m.endDate.split('-').map(Number)
    return `${from} – ${formatMonthYear(ey, emo)}`
  }
  if (!nextM) return `${from} – present`
  const [ny, nmo] = nextM.effectiveDate.split('-').map(Number)
  const endMo = nmo === 1 ? 12 : nmo - 1
  const endY = nmo === 1 ? ny - 1 : ny
  return `${from} – ${formatMonthYear(endY, endMo)}`
}

function MonthPicker({ value, onChange, placeholder = 'Select' }: {
  value: string
  onChange: (val: string) => void
  placeholder?: string
}) {
  const yr = value ? parseInt(value.slice(0, 4)) : ''
  const mo = value ? parseInt(value.slice(5, 7)) : ''
  const setYr = (y: string) => {
    if (!y) { onChange(''); return }
    onChange(`${y}-${String(mo || 1).padStart(2, '0')}`)
  }
  const setMo = (m: string) => {
    if (!m) { onChange(''); return }
    onChange(`${yr || new Date().getFullYear()}-${String(m).padStart(2, '0')}`)
  }
  return (
    <div className="flex items-center gap-1">
      <select value={mo} onChange={(e) => setMo(e.target.value)} className={SEL_CLS}>
        <option value="">{placeholder}</option>
        {MONTHS.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
      </select>
      <select value={yr} onChange={(e) => setYr(e.target.value)} className={SEL_CLS}>
        <option value="">{placeholder}</option>
        {PICKER_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

// ─── PCR Upload ───────────────────────────────────────────────────────────────

function PcrUploadTab() {
  const navigate = useNavigate()
  const { reports, settings, saveReport } = useData()

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
  const [showConflict, setShowConflict] = useState(false)

  const handleFile = useCallback(async (f: File) => {
    setFile(f)
    setParseError(null)
    setParsed(null)
    setShowConflict(false)
    const detected = detectMonthYear(f.name)
    if (detected) {
      setMonth(detected.month)
      setYear(detected.year)
      const existingId = `${detected.year}-${String(detected.month).padStart(2, '0')}`
      const existingReport = reports.find((r) => r.id === existingId)
      if (existingReport) setUnitValue(existingReport.unitDollarValue.toFixed(2))
    }
    try {
      const items = parseXlsx(await f.arrayBuffer())
      setParsed(items)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse file')
    }
  }, [reports])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const reportId = `${year}-${String(month).padStart(2, '0')}`
  const existing = reports.find((r) => r.id === reportId)

  const totalUnits = parsed ? parsed.reduce((s, li) => s + li.totalDistributableUnits, 0) : 0
  const uniqueTickets = parsed ? new Set(parsed.map((li) => li.ticketNum)).size : 0
  const serviceDates = parsed ? [...new Set(parsed.map((li) => li.serviceDate))].sort() : []

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const crossMonthCount = parsed
    ? parsed.filter((li) => !li.serviceDate.startsWith(monthPrefix)).length
    : 0

  const handleSave = async () => {
    if (!parsed) return
    if (existing && !showConflict) {
      setShowConflict(true)
      return
    }
    setSaving(true)
    setShowConflict(false)
    const report = {
      id: reportId,
      year,
      month,
      filename: file!.name,
      uploadDate: new Date().toISOString(),
      unitDollarValue: parseFloat(unitValue) || 32,
      paddingMinutes: parseInt(paddingMins) || 30,
      defaultNoTimeHours: parseFloat(noTimeHours) || 4,
      unitCorrection: existing?.unitCorrection,
      lineItems: parsed,
      workingDayOverrides: existing?.workingDayOverrides ?? {},
      dayStipends: existing?.dayStipends ?? {},
      stipends: existing?.stipends ?? [],
    }
    await saveReport(report)
    setSaving(false)
    navigate(`/month/${reportId}`)
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <div>
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg px-4 py-3 mb-5">
        <p className="text-xs font-semibold text-gray-400 mb-1">Expected format</p>
        <p className="text-xs text-gray-500">
          Excel (.xlsx) export from the PCR billing system. Each row represents one billing line item.
          Required columns: Incident ID, Service Date, Ticket #, CPT/ASA code, Modifier, Unit Value,
          Distribution Value, Start Time, End Time, and Total Time. Service dates are extracted automatically
          from the filename if present.
        </p>
      </div>
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

        {/* Conflict modal */}
        {showConflict && existing && parsed && (
          <div className="bg-gray-800 border border-amber-700/60 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-semibold text-amber-300">
                A report for {formatMonthYear(year, month)} already exists
              </p>
            </div>

            {/* Line item comparison */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div />
              <div className="text-center font-semibold text-gray-500 uppercase tracking-wider">Current</div>
              <div className="text-center font-semibold text-gray-500 uppercase tracking-wider">New</div>
              {(() => {
                const oldCases = new Set(existing.lineItems.map(li => li.ticketNum)).size
                const newCases = new Set(parsed.map(li => li.ticketNum)).size
                const oldUnits = existing.lineItems.reduce((s, li) => s + li.totalDistributableUnits, 0)
                const newUnits = parsed.reduce((s, li) => s + li.totalDistributableUnits, 0)
                const oldDates = existing.lineItems.map(li => li.serviceDate).sort()
                const newDates = parsed.map(li => li.serviceDate).sort()
                const oldRange = oldDates.length ? `${formatDateFull(oldDates[0])} – ${formatDateFull(oldDates[oldDates.length - 1])}` : '—'
                const newRange = newDates.length ? `${formatDateFull(newDates[0])} – ${formatDateFull(newDates[newDates.length - 1])}` : '—'
                const rows = [
                  { label: 'Cases', old: String(oldCases), new_: String(newCases), changed: oldCases !== newCases },
                  { label: 'Line items', old: String(existing.lineItems.length), new_: String(parsed.length), changed: existing.lineItems.length !== parsed.length },
                  { label: 'Total units', old: oldUnits.toFixed(2), new_: newUnits.toFixed(2), changed: Math.abs(oldUnits - newUnits) > 0.001 },
                  { label: 'Date range', old: oldRange, new_: newRange, changed: oldRange !== newRange },
                ]
                return rows.map(r => (
                  <>
                    <div key={`${r.label}-l`} className="text-gray-500 flex items-center">{r.label}</div>
                    <div key={`${r.label}-o`} className={`text-center ${r.changed ? 'text-gray-400' : 'text-gray-600'}`}>{r.old}</div>
                    <div key={`${r.label}-n`} className={`text-center font-medium ${r.changed ? 'text-amber-300' : 'text-gray-600'}`}>{r.new_}</div>
                  </>
                ))
              })()}
            </div>

            {/* Manual adjustments that will be preserved */}
            {(() => {
              const overrideCount = Object.keys(existing.workingDayOverrides ?? {}).length
              const stipendCount = Object.keys(existing.dayStipends ?? {}).length
              const hasCorrection = !!existing.unitCorrection
              const hasLegacyStipends = (existing.stipends ?? []).length > 0
              const items = [
                overrideCount > 0 && `${overrideCount} day hour override${overrideCount !== 1 ? 's' : ''}`,
                stipendCount > 0 && `${stipendCount} day stipend${stipendCount !== 1 ? 's' : ''}`,
                hasCorrection && `unit correction (${existing.unitCorrection! > 0 ? '+' : ''}${existing.unitCorrection})`,
                hasLegacyStipends && `${existing.stipends.length} additional stipend${existing.stipends.length !== 1 ? 's' : ''}`,
              ].filter(Boolean) as string[]
              if (items.length === 0) return null
              return (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Preserved from existing report</p>
                  {items.map(item => (
                    <div key={item} className="flex items-center gap-2 text-xs text-emerald-400">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* $/unit warning if form value differs from existing */}
            {Math.abs((parseFloat(unitValue) || 32) - existing.unitDollarValue) > 0.001 && (
              <div className="flex items-center gap-2 text-xs text-amber-500">
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                $/unit will change from ${existing.unitDollarValue.toFixed(2)} → ${(parseFloat(unitValue) || 32).toFixed(2)}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40">
                {saving ? 'Saving…' : 'Replace Line Items'}
              </button>
              <button onClick={() => setShowConflict(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!showConflict && (
          <button
            onClick={handleSave}
            disabled={!parsed || saving}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : `Save ${formatMonthYear(year, month)} Report`}
          </button>
        )}
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
  const { schedules, saveSchedule, deleteSchedule } = useData()
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
    const existingMap = new Map<string, string[]>()
    const sortedExisting = [...schedules].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
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

  const doSave = async (entries: ShiftEntry[], rejectedDates: string[]) => {
    const finalEntries = entries.filter((e) => !rejectedDates.includes(e.date))
    const schedule: Schedule = {
      id: genId(),
      filename: file!.name,
      uploadDate: new Date().toISOString(),
      entries: finalEntries,
    }
    await saveSchedule(schedule)
    setSaved(true)
    setShowConflictModal(false)
    setParsedEvents(null)
    setFile(null)
  }

  const handleApplyConflicts = async () => {
    const rejected = conflicts.filter((c) => !c.accept).map((c) => c.date)
    await doSave(pendingEntries, rejected)
  }

  const existingSchedules = schedules.filter((s) => s.id !== 'manual_shifts')

  return (
    <div>
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg px-4 py-3 mb-5">
        <p className="text-xs font-semibold text-gray-400 mb-1">Expected format</p>
        <p className="text-xs text-gray-500">
          iCalendar file (.ics) exported from your calendar application. Shift assignments must be
          all-day events. The event title should contain the shift type (e.g., G1, G2, G3, APS, GI, V, POSTCALL).
          Multiple events on the same day are combined into a single entry. You can select a date range
          after parsing to import only a subset of events.
        </p>
      </div>
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
                      onClick={async () => {
                        if (!confirm('Remove this schedule? Shift data will be lost.')) return
                        await deleteSchedule(s.id)
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
  const { stipendMappings: ctxMappings, saveStipendMapping, deleteStipendMapping } = useData()

  // Sort descending (newest first) for display
  const existingMappings = [...ctxMappings].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))

  // ── Upload state ──────────────────────────────────────────────────────────
  const today = new Date()
  const defaultUploadMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [rates, setRates] = useState<StipendMapping['rates'] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [uploadMonth, setUploadMonth] = useState(defaultUploadMonth)
  const [saved, setSaved] = useState(false)

  // ── Edit state ────────────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<StipendMapping | null>(null)

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

  const handleSave = async () => {
    if (!rates || !file) return
    const mapping: StipendMapping = {
      id: genId(),
      name: file.name.replace(/\.[^.]+$/, ''),
      filename: file.name,
      uploadDate: new Date().toISOString(),
      effectiveDate: uploadMonth + '-01',
      rates,
    }
    await saveStipendMapping(mapping)
    setSaved(true); setFile(null); setRates(null)
  }

  const expandMapping = (m: StipendMapping) => {
    setExpandedId(m.id)
    setDraft({ ...m, rates: m.rates.map((r) => ({ ...r })) })
  }

  const collapseMapping = () => { setExpandedId(null); setDraft(null) }

  const saveDraft = async () => {
    if (!draft) return
    await saveStipendMapping(draft)
    collapseMapping()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this stipend schedule? This cannot be undone.')) return
    await deleteStipendMapping(id)
    if (expandedId === id) collapseMapping()
  }

  const updateRate = (idx: number, field: keyof StipendRate, value: string | number) => {
    if (!draft) return
    setDraft({ ...draft, rates: draft.rates.map((r, i) => i === idx ? { ...r, [field]: value } : r) })
  }

  return (
    <div>
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg px-4 py-3 mb-5">
        <p className="text-xs font-semibold text-gray-400 mb-1">Expected format</p>
        <p className="text-xs text-gray-500">
          2-column Excel (.xlsx) spreadsheet. Column A: shift type key (e.g., G1_weekday, G1_weekend, APS, BR, NIR, GI).
          Column B: dollar amount per shift day. Set the effective month after upload to control which
          pay periods these rates apply to.
        </p>
      </div>

      {/* Drop zone */}
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
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Effective from</p>
            <MonthPicker value={uploadMonth} onChange={setUploadMonth} />
            <p className="text-xs text-gray-600">Rates apply from this month onward</p>
          </div>
          <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto mb-4">
            {rates.map((r) => (
              <div key={r.shiftType} className="flex justify-between text-xs py-1 px-2 rounded hover:bg-gray-800">
                <span className="font-mono text-gray-400">{r.shiftType}</span>
                <span className="text-emerald-400">${r.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <button
            onClick={handleSave}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            Save Stipend Rates
          </button>
        </div>
      )}

      {/* Saved rate schedules */}
      {existingMappings.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300">Saved Stipend Rate Schedules</h3>
          </div>
          <div className="divide-y divide-gray-800">
            {existingMappings.map((m, i) => {
              const isExpanded = expandedId === m.id
              const isCurrent = i === 0
              // nextM is the later-effective mapping (lower index in descending sort = earlier index = i-1)
              const nextM = existingMappings[i - 1] ?? null

              return (
                <div key={m.id}>
                  {/* Row header */}
                  <button
                    onClick={() => isExpanded ? collapseMapping() : expandMapping(m)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors text-left"
                  >
                    <svg
                      className={`w-3 h-3 text-gray-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-medium text-gray-200">{m.name || m.filename}</span>
                    <span className="text-xs text-gray-600 mx-1">·</span>
                    <span className="text-xs text-gray-500 flex-1">{stipendDateRange(m, nextM)}</span>
                    {isCurrent && (
                      <span className="text-xs px-1.5 py-0.5 bg-indigo-900/40 text-indigo-400 rounded">current</span>
                    )}
                    <span className="text-xs text-gray-700 ml-2">{m.rates.length} rates</span>
                  </button>

                  {/* Expanded editor */}
                  {isExpanded && draft?.id === m.id && (
                    <div className="border-t border-gray-800 p-4">
                      {/* Name + dates */}
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Name</label>
                          <input
                            type="text"
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            placeholder="e.g. 2025 Rates"
                            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Effective from</label>
                          <MonthPicker
                            value={draft.effectiveDate.slice(0, 7)}
                            onChange={(v) => setDraft({ ...draft, effectiveDate: v ? v + '-01' : draft.effectiveDate })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                            Till <span className="font-normal text-gray-600 normal-case">(blank = ongoing)</span>
                          </label>
                          <div className="flex items-center gap-2">
                            <MonthPicker
                              value={draft.endDate ? draft.endDate.slice(0, 7) : ''}
                              onChange={(v) => setDraft({ ...draft, endDate: v ? lastDayOfMonthStr(v) : undefined })}
                              placeholder="—"
                            />
                            {draft.endDate && (
                              <button
                                onClick={() => setDraft({ ...draft, endDate: undefined })}
                                className="text-gray-600 hover:text-gray-400"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Rates table */}
                      <table className="w-full text-sm mb-3">
                        <thead>
                          <tr className="border-b border-gray-800">
                            <th className="pb-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Shift Type</th>
                            <th className="pb-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider pl-4">Amount</th>
                            <th className="pb-2 w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {draft.rates.map((rate, ri) => (
                            <tr key={ri} className="border-b border-gray-800/50">
                              <td className="py-1.5 pr-4">
                                <input
                                  value={rate.shiftType}
                                  onChange={(e) => updateRate(ri, 'shiftType', e.target.value)}
                                  placeholder="e.g. G1_weekend"
                                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full"
                                />
                              </td>
                              <td className="py-1.5 pl-4 pr-4">
                                <div className="flex items-center gap-1">
                                  <span className="text-gray-500 text-xs">$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={rate.amount}
                                    onChange={(e) => updateRate(ri, 'amount', parseFloat(e.target.value) || 0)}
                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-28"
                                  />
                                </div>
                              </td>
                              <td className="py-1.5">
                                <button
                                  onClick={() => setDraft({ ...draft, rates: draft.rates.filter((_, j) => j !== ri) })}
                                  className="text-gray-700 hover:text-red-400 transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <button
                        onClick={() => setDraft({ ...draft, rates: [...draft.rates, { shiftType: '', amount: 0 }] })}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-medium mb-4"
                      >
                        + Add Rate
                      </button>

                      <div className="flex items-center gap-3 border-t border-gray-800 pt-4">
                        <button
                          onClick={saveDraft}
                          className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-500 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={collapseMapping}
                          className="px-4 py-1.5 text-gray-400 hover:text-gray-200 text-xs font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="ml-auto text-xs text-red-500 hover:text-red-400 font-medium"
                        >
                          Delete Schedule
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
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
    <div className="p-4 md:p-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-100 mb-6">Upload Data</h2>

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
