import { useState, useRef } from 'react'
import { api, type MaintenanceResult } from '../api'
import { useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { computeFederalHolidays, getFederalHolidayLabels } from '../utils/shiftUtils'
import { formatDateFull, formatMonthYear, lastDayOfMonth, MONTH_ABBREVS, randomId } from '../utils/dateUtils'
import { parseStipendMapping } from '../utils/stipendMappingParser'
import type { StipendMapping, StipendRate } from '../types'

// ─── Stipend overlap helpers ──────────────────────────────────────────────────

function detectStipendOverlaps(candidate: StipendMapping, allMappings: StipendMapping[]): StipendMapping[] {
  const cStart = candidate.effectiveDate
  const cEnd = candidate.endDate ?? '9999-12-31'
  return allMappings.filter((m) => {
    if (m.id === candidate.id) return false
    const mEnd = m.endDate ?? '9999-12-31'
    return cStart <= mEnd && m.effectiveDate <= cEnd
  })
}

// Last day of the month BEFORE the given "YYYY-MM-DD" date
function prevMonthLastDay(yyyyMmDd: string): string {
  const [y, m] = yyyyMmDd.split('-').map(Number)
  const d = new Date(y, m - 1, 0) // day 0 of month m = last day of month m-1
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const inputCls = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-24'
const selectCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500'

const PICKER_YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 3 + i)

// value: "YYYY-MM" | "", onChange: (val: "YYYY-MM" | "") => void
function MonthPicker({ value, onChange, placeholder = 'Select' }: {
  value: string
  onChange: (val: string) => void
  placeholder?: string
}) {
  const year = value ? parseInt(value.slice(0, 4)) : ''
  const month = value ? parseInt(value.slice(5, 7)) : ''

  const setYear = (y: string) => {
    if (!y) { onChange(''); return }
    const m = month || 1
    onChange(`${y}-${String(m).padStart(2, '0')}`)
  }
  const setMonth = (m: string) => {
    if (!m) { onChange(''); return }
    const y = year || new Date().getFullYear()
    onChange(`${y}-${String(m).padStart(2, '0')}`)
  }

  return (
    <div className="flex items-center gap-1">
      <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls}>
        <option value="">{placeholder}</option>
        {MONTH_ABBREVS.map((name, i) => (
          <option key={i + 1} value={i + 1}>{name}</option>
        ))}
      </select>
      <select value={year} onChange={(e) => setYear(e.target.value)} className={selectCls}>
        <option value="">{placeholder}</option>
        {PICKER_YEARS.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const {
    settings: apiSettings,
    saveSettings: contextSaveSettings,
    stipendMappings: ctxMappings,
    saveStipendMapping,
    deleteStipendMapping,
    cptRanges,
    physicians,
    activePhysicianId,
    savePhysician,
    deletePhysician,
  } = useData()

  const [settings, setSettings] = useState(apiSettings)
  const [saved, setSaved] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)

  // ── Physicians ──────────────────────────────────────────────────────────────
  const [newPhysicianName, setNewPhysicianName] = useState('')
  const [editingPhysicianId, setEditingPhysicianId] = useState<string | null>(null)
  const [editingPhysicianName, setEditingPhysicianName] = useState('')
  const [physicianSaving, setPhysicianSaving] = useState(false)
  const [physicianError, setPhysicianError] = useState<string | null>(null)

  const doSavePhysician = (p: { id: string; name: string }, onDone?: () => void) => {
    setPhysicianSaving(true)
    setPhysicianError(null)
    let promise: Promise<void>
    try {
      promise = savePhysician(p)
    } catch (err) {
      setPhysicianError(String(err))
      setPhysicianSaving(false)
      return
    }
    promise
      .then(() => onDone?.())
      .catch((err) => setPhysicianError(String(err)))
      .finally(() => setPhysicianSaving(false))
  }

  // ── Fixed-shift add form ────────────────────────────────────────────────────
  const [newShiftName, setNewShiftName] = useState('')
  const [newShiftHours, setNewShiftHours] = useState('8')

  // ── Maintenance ────────────────────────────────────────────────────────────
  const [maintState, setMaintState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [maintResult, setMaintResult] = useState<MaintenanceResult | null>(null)
  const [maintError, setMaintError] = useState<string | null>(null)

  const runMaintenance = async () => {
    setMaintState('running')
    setMaintResult(null)
    setMaintError(null)
    try {
      const result = await api.db.maintenance()
      setMaintResult(result)
      setMaintState('done')
    } catch (err) {
      setMaintError(String(err))
      setMaintState('error')
    }
  }

  // ── Export / Import ────────────────────────────────────────────────────────
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importState, setImportState] = useState<'idle' | 'confirm' | 'importing' | 'done' | 'error'>('idle')
  const [importError, setImportError] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<unknown>(null)

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size === 0) {
      setImportError('The selected file is empty (0 bytes). Please choose a valid backup file.')
      setImportState('error')
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const raw = ev.target?.result
      if (!raw || typeof raw !== 'string' || raw.trim() === '') {
        setImportError('File could not be read or is empty.')
        setImportState('error')
        return
      }
      try {
        const data = JSON.parse(raw)
        if (!data.version || !Array.isArray(data.reports)) {
          setImportError('Invalid backup file — missing required fields.')
          setImportState('error')
          return
        }
        setPendingImport(data)
        setImportState('confirm')
      } catch (err) {
        setImportError(`Could not parse file as JSON: ${String(err)}`)
        setImportState('error')
      }
    }
    reader.onerror = () => {
      setImportError('FileReader error — could not read the file.')
      setImportState('error')
    }
    reader.readAsText(file)
  }

  async function confirmImport() {
    if (!pendingImport) return
    setImportState('importing')
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingImport),
      })
      if (!res.ok) {
        let errorMsg = `Server error ${res.status} ${res.statusText}`
        try {
          const err = await res.json()
          if (err.error) errorMsg = err.error
        } catch { /* response body wasn't JSON, keep the status message */ }
        throw new Error(errorMsg)
      }
      setImportState('done')
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      setImportError(String(err))
      setImportState('error')
    }
  }
  const hasUnsavedChanges = JSON.stringify(settings) !== JSON.stringify(apiSettings)
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear())
  const [customDateInput, setCustomDateInput] = useState('')

  const federalHolidays = getFederalHolidayLabels(holidayYear)
  const storedList: string[] | undefined = settings.holidays[holidayYear]
  // If no stored list for the year, all federal holidays are active by default
  const activeList: string[] = storedList ?? computeFederalHolidays(holidayYear)

  const isHolidayActive = (date: string) => activeList.includes(date)
  const customDates = activeList.filter(
    (d) => !federalHolidays.some((h) => h.date === d)
  )

  const setHolidayList = (newList: string[]) => {
    setSettings((s) => ({
      ...s,
      holidays: { ...s.holidays, [holidayYear]: [...new Set(newList)].sort() },
    }))
  }

  const toggleHoliday = (date: string) => {
    if (isHolidayActive(date)) {
      setHolidayList(activeList.filter((d) => d !== date))
    } else {
      setHolidayList([...activeList, date])
    }
  }

  const addCustomDate = () => {
    const trimmed = customDateInput.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return
    setHolidayList([...activeList, trimmed])
    setCustomDateInput('')
  }

  const removeCustomDate = (date: string) => {
    setHolidayList(activeList.filter((d) => d !== date))
  }

  const handleSave = async () => {
    await contextSaveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i)

  // ── Stipend schedules ────────────────────────────────────────────────────────
  const stipendMappings = [...ctxMappings].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
  const [expandedStipendId, setExpandedStipendId] = useState<string | null>(null)
  const [stipendDraft, setStipendDraft] = useState<StipendMapping | null>(null)
  const [overlapWarning, setOverlapWarning] = useState<{
    overlapping: StipendMapping[]
    candidate: StipendMapping
    source: 'edit' | 'upload'
  } | null>(null)

  const expandMapping = (m: StipendMapping) => {
    setExpandedStipendId(m.id)
    setStipendDraft({ ...m, rates: m.rates.map((r) => ({ ...r })) })
  }

  const collapseMapping = () => {
    setExpandedStipendId(null)
    setStipendDraft(null)
  }

  const saveStipend = async () => {
    if (!stipendDraft) return
    const overlapping = detectStipendOverlaps(stipendDraft, ctxMappings)
    if (overlapping.length > 0) {
      setOverlapWarning({ overlapping, candidate: stipendDraft, source: 'edit' })
      return
    }
    await saveStipendMapping(stipendDraft)
    collapseMapping()
  }

  const handleNewSchedule = async () => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const newM: StipendMapping = {
      id: `manual_${Date.now()}`,
      name: 'New Schedule',
      filename: 'Manual',
      uploadDate: new Date().toISOString(),
      effectiveDate: ym + '-01',
      rates: [],
    }
    await saveStipendMapping(newM)
    setExpandedStipendId(newM.id)
    setStipendDraft({ ...newM })
  }

  const handleDeleteStipend = async (id: string) => {
    if (!confirm('Delete this stipend schedule? This cannot be undone.')) return
    await deleteStipendMapping(id)
    if (expandedStipendId === id) collapseMapping()
  }

  const handleDuplicate = async (m: StipendMapping) => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const copy: StipendMapping = {
      id: `manual_${Date.now()}`,
      name: `Copy of ${m.name || m.filename}`,
      filename: 'Manual',
      uploadDate: now.toISOString(),
      effectiveDate: ym + '-01',
      rates: m.rates.map(r => ({ ...r })),
    }
    await saveStipendMapping(copy)
    setExpandedStipendId(copy.id)
    setStipendDraft({ ...copy })
  }

  const exportStipendCSV = (m: StipendMapping) => {
    const header = `"Schedule","${(m.name || m.filename).replace(/"/g, '""')}"`
    const effectiveLabel = m.effectiveDate.slice(0, 7)
    const endLabel = m.endDate ? m.endDate.slice(0, 7) : 'present'
    const dateRow = `"Effective","${effectiveLabel} – ${endLabel}"`
    const colHeader = '"Shift Type","Amount"'
    const rows = m.rates.map(r => `"${r.shiftType.replace(/"/g, '""')}","${r.amount.toFixed(2)}"`)
    const csv = [header, dateRow, colHeader, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(m.name || m.filename).replace(/[^a-z0-9]/gi, '_')}_stipend_rates.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const updateDraftRate = (idx: number, field: keyof StipendRate, value: string | number) => {
    if (!stipendDraft) return
    setStipendDraft({
      ...stipendDraft,
      rates: stipendDraft.rates.map((r, i) => i === idx ? { ...r, [field]: value } : r),
    })
  }

  const addDraftRate = () => {
    if (!stipendDraft) return
    setStipendDraft({ ...stipendDraft, rates: [...stipendDraft.rates, { shiftType: '', amount: 0 }] })
  }

  const removeDraftRate = (idx: number) => {
    if (!stipendDraft) return
    setStipendDraft({ ...stipendDraft, rates: stipendDraft.rates.filter((_, i) => i !== idx) })
  }

  // Upload from file
  const today = new Date()
  const defaultUploadMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [uploadRates, setUploadRates] = useState<StipendRate[] | null>(null)
  const [uploadFilename, setUploadFilename] = useState('')
  const [uploadMonth, setUploadMonth] = useState(defaultUploadMonth)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleUploadFile = async (f: File) => {
    setUploadError(null); setUploadRates(null); setUploadFilename(f.name)
    try {
      const parsed = parseStipendMapping(await f.arrayBuffer())
      if (parsed.length === 0) {
        setUploadError('No valid shift→amount rows found. Expected 2-column spreadsheet.')
        return
      }
      setUploadRates(parsed)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Failed to parse file')
    }
  }

  const handleUploadSave = async () => {
    if (!uploadRates) return
    const mapping: StipendMapping = {
      id: `upload_${Date.now()}`,
      name: uploadFilename.replace(/\.[^.]+$/, ''),
      filename: uploadFilename,
      uploadDate: new Date().toISOString(),
      effectiveDate: uploadMonth + '-01',
      rates: uploadRates,
    }
    const overlapping = detectStipendOverlaps(mapping, ctxMappings)
    if (overlapping.length > 0) {
      setOverlapWarning({ overlapping, candidate: mapping, source: 'upload' })
      return
    }
    await saveStipendMapping(mapping)
    setUploadRates(null); setUploadFilename(''); setUploadError(null)
  }

  const handleOverlapFixAndSave = async () => {
    if (!overlapWarning) return
    const { overlapping, candidate, source } = overlapWarning
    const fixDate = prevMonthLastDay(candidate.effectiveDate)
    // Close end dates of earlier-starting overlapping mappings
    for (const m of overlapping) {
      if (m.effectiveDate < candidate.effectiveDate) {
        await saveStipendMapping({ ...m, endDate: fixDate })
      }
    }
    await saveStipendMapping(candidate)
    setOverlapWarning(null)
    if (source === 'edit') collapseMapping()
    else { setUploadRates(null); setUploadFilename(''); setUploadError(null) }
  }

  const handleOverlapSaveAnyway = async () => {
    if (!overlapWarning) return
    const { candidate, source } = overlapWarning
    await saveStipendMapping(candidate)
    setOverlapWarning(null)
    if (source === 'edit') collapseMapping()
    else { setUploadRates(null); setUploadFilename(''); setUploadError(null) }
  }

  // Returns "Mon YYYY – Mon YYYY" or "Mon YYYY – present"
  const stipendDateRange = (m: StipendMapping, nextM: StipendMapping | null): string => {
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

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-100">Settings</h2>
        {hasUnsavedChanges && (
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            Save Settings
          </button>
        )}
      </div>

      {/* Physicians */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Physicians</h3>
        <div className="space-y-2 mb-4">
          {physicians.map((p) => (
            <div key={p.id} className="flex items-center gap-2 bg-gray-800/50 rounded-lg px-3 py-2">
              {editingPhysicianId === p.id ? (
                <>
                  <input
                    autoFocus
                    value={editingPhysicianName}
                    onChange={(e) => setEditingPhysicianName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        doSavePhysician({ id: p.id, name: editingPhysicianName.trim() || p.name }, () => setEditingPhysicianId(null))
                      } else if (e.key === 'Escape') {
                        setEditingPhysicianId(null)
                      }
                    }}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    disabled={physicianSaving}
                    onClick={() => doSavePhysician({ id: p.id, name: editingPhysicianName.trim() || p.name }, () => setEditingPhysicianId(null))}
                    className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors"
                  >Save</button>
                  <button onClick={() => setEditingPhysicianId(null)} className="text-xs px-2 py-1 text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
                </>
              ) : (
                <>
                  <span className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    {p.name[0].toUpperCase()}
                  </span>
                  <span className="flex-1 text-sm text-gray-200">{p.name}</span>
                  {p.id === activePhysicianId && (
                    <span className="text-[10px] text-indigo-400 font-medium px-1.5 py-0.5 bg-indigo-500/10 rounded">active</span>
                  )}
                  <button
                    onClick={() => { setEditingPhysicianId(p.id); setEditingPhysicianName(p.name) }}
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                    title="Rename"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  {physicians.length > 1 && (
                    <button
                      onClick={() => { if (confirm(`Delete ${p.name}? Their data will no longer be accessible.`)) deletePhysician(p.id) }}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newPhysicianName}
            onChange={(e) => setNewPhysicianName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newPhysicianName.trim()) {
                doSavePhysician({ id: randomId(), name: newPhysicianName.trim() }, () => setNewPhysicianName(''))
              }
            }}
            placeholder="New physician name"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-600"
          />
          <button
            disabled={!newPhysicianName.trim() || physicianSaving}
            onClick={() => doSavePhysician({ id: randomId(), name: newPhysicianName.trim() }, () => setNewPhysicianName(''))}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>
        {physicianError && (
          <p className="mt-2 text-xs text-red-400">{physicianError}</p>
        )}
      </section>

      {/* Defaults (collapsible) */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 mb-6">
        <button
          type="button"
          onClick={() => setDefaultsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-6 py-4 text-left"
        >
          <span className="text-sm font-semibold text-gray-300">Defaults</span>
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${defaultsOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {defaultsOpen && (
          <div className="px-6 pb-6 border-t border-gray-800 pt-5 space-y-6">
            {/* Fixed-shift hours */}
            <div>
              <h4 className="text-xs font-semibold text-gray-400 mb-1">Fixed-Hour Shifts</h4>
              <p className="text-xs text-gray-600 mb-3">
                Shifts listed here use a preset hour count instead of computing hours from case times. Override per day via the pencil icon.
              </p>
              {/* Table of primary shifts (exclude _weekend variant keys) */}
              {(() => {
                const primaryKeys = Object.keys(settings.shiftHours).filter(k => !k.toUpperCase().endsWith('_WEEKEND'))
                return (
                  <div className="space-y-2 mb-3">
                    {primaryKeys.map((key) => {
                      const weekendKey = Object.keys(settings.shiftHours).find(k => k.toUpperCase() === `${key.toUpperCase()}_WEEKEND`)
                      const hasWeekend = weekendKey !== undefined
                      return (
                        <div key={key} className="flex items-center gap-3 bg-gray-800/40 border border-gray-800 rounded-lg px-3 py-2.5">
                          {/* Shift name */}
                          <span className="w-20 text-sm font-mono font-medium text-gray-200 flex-shrink-0">{key}</span>
                          {/* Weekday hours */}
                          <div className="flex items-center gap-1.5">
                            <label className="text-xs text-gray-500 whitespace-nowrap">Weekday hrs</label>
                            <input
                              type="number" step="0.5" min="0"
                              value={settings.shiftHours[key]}
                              onChange={(e) => setSettings((s) => ({ ...s, shiftHours: { ...s.shiftHours, [key]: parseFloat(e.target.value) || 0 } }))}
                              className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                          {/* Weekend toggle + hours */}
                          <div className="flex items-center gap-1.5">
                            <input
                              type="checkbox" id={`we-${key}`}
                              checked={hasWeekend}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSettings((s) => ({ ...s, shiftHours: { ...s.shiftHours, [`${key}_weekend`]: s.shiftHours[key] } }))
                                } else {
                                  setSettings((s) => {
                                    const next = { ...s.shiftHours }
                                    if (weekendKey) delete next[weekendKey]
                                    return { ...s, shiftHours: next }
                                  })
                                }
                              }}
                              className="accent-indigo-500"
                            />
                            <label htmlFor={`we-${key}`} className="text-xs text-gray-500 whitespace-nowrap cursor-pointer">Wknd/Holiday hrs</label>
                            {hasWeekend && weekendKey && (
                              <input
                                type="number" step="0.5" min="0"
                                value={settings.shiftHours[weekendKey]}
                                onChange={(e) => setSettings((s) => ({ ...s, shiftHours: { ...s.shiftHours, [weekendKey]: parseFloat(e.target.value) || 0 } }))}
                                className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            )}
                          </div>
                          {/* Delete */}
                          <button
                            onClick={() => setSettings((s) => {
                              const next = { ...s.shiftHours }
                              delete next[key]
                              if (weekendKey) delete next[weekendKey]
                              return { ...s, shiftHours: next }
                            })}
                            className="ml-auto text-gray-700 hover:text-red-400 transition-colors flex-shrink-0"
                            title="Remove shift"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
              {/* Add new shift */}
              <div className="flex items-center gap-2">
                <input
                  type="text" placeholder="Shift name (e.g. TRAUMA)"
                  value={newShiftName}
                  onChange={(e) => setNewShiftName(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const name = newShiftName.trim()
                    if (!name || name.endsWith('_WEEKEND') || settings.shiftHours[name] !== undefined) return
                    setSettings((s) => ({ ...s, shiftHours: { ...s.shiftHours, [name]: parseFloat(newShiftHours) || 8 } }))
                    setNewShiftName(''); setNewShiftHours('8')
                  }}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <input
                  type="number" step="0.5" min="0" placeholder="hrs"
                  value={newShiftHours}
                  onChange={(e) => setNewShiftHours(e.target.value)}
                  className="w-16 bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={() => {
                    const name = newShiftName.trim()
                    if (!name || name.endsWith('_WEEKEND') || settings.shiftHours[name] !== undefined) return
                    setSettings((s) => ({ ...s, shiftHours: { ...s.shiftHours, [name]: parseFloat(newShiftHours) || 8 } }))
                    setNewShiftName(''); setNewShiftHours('8')
                  }}
                  disabled={!newShiftName.trim() || newShiftName.trim().toUpperCase().endsWith('_WEEKEND') || settings.shiftHours[newShiftName.trim()] !== undefined}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed font-medium whitespace-nowrap"
                >
                  Add Shift
                </button>
              </div>
            </div>

            {/* Global defaults */}
            <div>
              <h4 className="text-xs font-semibold text-gray-400 mb-3">Global Defaults</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">
                    Hours Padding (minutes)
                  </label>
                  <input
                    type="number"
                    value={settings.defaultPaddingMinutes}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, defaultPaddingMinutes: parseInt(e.target.value) || 0 }))
                    }
                    className={inputCls}
                  />
                  <p className="text-xs text-gray-600 mt-1">Added to timed days (new reports use this default)</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">
                    Default Hours (no-time days)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={settings.defaultNoTimeHours}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, defaultNoTimeHours: parseFloat(e.target.value) || 0 }))
                    }
                    className={inputCls}
                  />
                  <p className="text-xs text-gray-600 mt-1">For variable-shift days with no case times</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-1.5">
                    Clinical Day Start
                  </label>
                  <input
                    type="time"
                    value={settings.clinicalDayStart}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, clinicalDayStart: e.target.value || '06:30' }))
                    }
                    className={inputCls}
                  />
                  <p className="text-xs text-gray-600 mt-1">After-midnight cases before this time are attributed to the prior call date</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Federal Holidays */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-300">Federal Holidays</h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Used to classify G1/G2 call shifts as weekday vs. weekend/holiday.
            </p>
          </div>
          <select
            value={holidayYear}
            onChange={(e) => setHolidayYear(Number(e.target.value))}
            className={selectCls}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1 mb-4">
          {federalHolidays.map(({ date, label }) => (
            <label key={date} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-gray-800 cursor-pointer">
              <input
                type="checkbox"
                checked={isHolidayActive(date)}
                onChange={() => toggleHoliday(date)}
                className="accent-indigo-500"
              />
              <span className="text-sm text-gray-300 flex-1">{label}</span>
              <span className="text-xs text-gray-600">{formatDateFull(date)}</span>
            </label>
          ))}
        </div>

        {customDates.length > 0 && (
          <div className="border-t border-gray-800 pt-3 mb-3">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Custom Dates</p>
            <div className="space-y-1">
              {customDates.map((date) => (
                <div key={date} className="flex items-center gap-3 py-1.5 px-2">
                  <span className="text-sm text-gray-300 flex-1">{formatDateFull(date)}</span>
                  <button
                    onClick={() => removeCustomDate(date)}
                    className="text-gray-600 hover:text-red-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-gray-800 pt-3">
          <input
            type="text"
            placeholder="YYYY-MM-DD"
            value={customDateInput}
            onChange={(e) => setCustomDateInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addCustomDate() }}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-36"
          />
          <button
            onClick={addCustomDate}
            className="text-xs text-indigo-400 font-medium hover:text-indigo-300"
          >
            Add custom date
          </button>
        </div>
      </section>

      {/* Stipend Rate Schedules */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-gray-300">Stipend Rate Schedules</h3>
              <div className="relative group">
                <button
                  type="button"
                  className="w-4 h-4 rounded-full border border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-300 transition-colors flex items-center justify-center text-[10px] font-bold leading-none"
                  tabIndex={-1}
                >
                  i
                </button>
                <div className="absolute left-0 top-6 z-50 hidden group-hover:block w-72 bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-xl text-xs text-gray-300 space-y-2">
                  <p className="font-semibold text-gray-200 mb-1">Rate Key Format</p>
                  <p>Each row has a <span className="font-mono text-indigo-300">shiftType</span> key and a dollar amount. Keys are case-insensitive.</p>
                  <div className="space-y-1">
                    <p className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">Weekday / Weekend variants</p>
                    <p>Append <span className="font-mono text-amber-300">_weekday</span> or <span className="font-mono text-amber-300">_weekend</span> to a shift name to set day-type-specific rates (e.g. <span className="font-mono text-gray-400">G1_weekday</span>, <span className="font-mono text-gray-400">G1_weekend</span>). If only a plain key exists it applies to both.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">Call shifts (G1 / G2)</p>
                    <p>Always resolved using <span className="font-mono text-amber-300">_weekday</span> / <span className="font-mono text-amber-300">_weekend</span> suffix based on federal holiday calendar.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">GI / ENDO</p>
                    <p><span className="font-mono text-gray-400">ENDO</span> is an alias for <span className="font-mono text-gray-400">GI</span>. GI always uses the <span className="font-mono text-amber-300">_weekend</span> rate regardless of day.</p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">Fixed-hour shifts</p>
                    <p><span className="font-mono text-gray-400">APS</span>, <span className="font-mono text-gray-400">BR</span>, and <span className="font-mono text-gray-400">NIR</span> support plain or <span className="font-mono text-amber-300">_weekday</span>/<span className="font-mono text-amber-300">_weekend</span> variants.</p>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-0.5">
              Each schedule applies from its effective month until the next one begins.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer text-xs text-indigo-400 hover:text-indigo-300 font-medium border border-indigo-800 rounded-md px-3 py-1.5 hover:bg-indigo-900/30 transition-colors">
              Upload from file
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = '' }}
              />
            </label>
            <button
              onClick={handleNewSchedule}
              className="text-xs text-gray-400 hover:text-gray-200 font-medium border border-gray-700 rounded-md px-3 py-1.5 hover:bg-gray-800 transition-colors"
            >
              + New (blank)
            </button>
          </div>
        </div>

        {/* Upload preview */}
        {(uploadRates || uploadError) && (
          <div className={`rounded-lg border p-4 mb-4 ${uploadError ? 'border-red-800 bg-red-900/20' : 'border-emerald-800 bg-emerald-900/10'}`}>
            {uploadError ? (
              <div className="flex items-center justify-between">
                <p className="text-xs text-red-400">{uploadError}</p>
                <button onClick={() => setUploadError(null)} className="text-gray-600 hover:text-gray-400 ml-4">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : uploadRates && (
              <div>
                <div className="flex items-center gap-4 mb-3">
                  <p className="text-xs font-medium text-emerald-400">{uploadFilename} — {uploadRates.length} rates</p>
                  <div className="flex items-center gap-2 ml-auto">
                    <label className="text-xs text-gray-500">Effective from:</label>
                    <MonthPicker value={uploadMonth} onChange={setUploadMonth} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1 max-h-36 overflow-y-auto mb-3">
                  {uploadRates.map((r) => (
                    <div key={r.shiftType} className="flex justify-between text-xs py-1 px-2 rounded bg-gray-800/60">
                      <span className="font-mono text-gray-400">{r.shiftType}</span>
                      <span className="text-emerald-400">${r.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleUploadSave}
                    className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-500 transition-colors"
                  >
                    Save Schedule
                  </button>
                  <button
                    onClick={() => { setUploadRates(null); setUploadFilename('') }}
                    className="px-4 py-1.5 text-gray-400 hover:text-gray-200 text-xs font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {stipendMappings.length === 0 && !uploadRates && !uploadError && (
          <p className="text-xs text-gray-600">
            No stipend schedules yet. Upload a rates file or create one manually above.
          </p>
        )}

        <div className="space-y-2">
          {stipendMappings.map((m, i) => {
            const isExpanded = expandedStipendId === m.id
            const draft = stipendDraft?.id === m.id ? stipendDraft : null
            const nextM = stipendMappings[i - 1] ?? null // sorted descending, so prev index is "later" schedule
            const dateRange = stipendDateRange(m, nextM)
            const isCurrent = i === 0

            return (
              <div key={m.id} className="border border-gray-800 rounded-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center hover:bg-gray-800 transition-colors">
                  <button
                    onClick={() => isExpanded ? collapseMapping() : expandMapping(m)}
                    className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0"
                  >
                    <svg
                      className={`w-3 h-3 text-gray-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-medium text-gray-200 truncate">{m.name || m.filename}</span>
                    <span className="text-xs text-gray-600 mx-2 flex-shrink-0">·</span>
                    <span className="text-xs text-gray-500 flex-1 truncate">{dateRange}</span>
                    {isCurrent && (
                      <span className="text-xs px-1.5 py-0.5 bg-indigo-900/40 text-indigo-400 rounded flex-shrink-0">current</span>
                    )}
                    <span className="text-xs text-gray-700 ml-2 flex-shrink-0">{m.rates.length} rates</span>
                  </button>
                  {/* Per-schedule actions */}
                  <div className="flex items-center gap-0.5 pr-2 flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); handleDuplicate(m) }}
                      title="Duplicate schedule"
                      className="p-1.5 text-gray-600 hover:text-indigo-400 transition-colors rounded"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); exportStipendCSV(m) }}
                      title="Export as CSV"
                      className="p-1.5 text-gray-600 hover:text-emerald-400 transition-colors rounded"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Expanded edit form */}
                {isExpanded && draft && (
                  <div className="border-t border-gray-800 p-4">
                    {/* Name, Effective from, Till */}
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Name</label>
                        <input
                          type="text"
                          value={draft.name}
                          onChange={(e) => setStipendDraft({ ...draft, name: e.target.value })}
                          placeholder="e.g. 2025 Rates"
                          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Effective from</label>
                        <MonthPicker
                          value={draft.effectiveDate.slice(0, 7)}
                          onChange={(v) => setStipendDraft({ ...draft, effectiveDate: v ? v + '-01' : draft.effectiveDate })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                          Till
                          <span className="ml-1 font-normal text-gray-600 normal-case">(leave blank if ongoing)</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <MonthPicker
                            value={draft.endDate ? draft.endDate.slice(0, 7) : ''}
                            onChange={(v) => setStipendDraft({ ...draft, endDate: v ? lastDayOfMonth(...v.split('-').map(Number) as [number, number]) : undefined })}
                            placeholder="—"
                          />
                          {draft.endDate && (
                            <button
                              onClick={() => setStipendDraft({ ...draft, endDate: undefined })}
                              className="text-gray-600 hover:text-gray-400 flex-shrink-0"
                              title="Clear end date"
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
                                onChange={(e) => updateDraftRate(ri, 'shiftType', e.target.value)}
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
                                  onChange={(e) => updateDraftRate(ri, 'amount', parseFloat(e.target.value) || 0)}
                                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-28"
                                />
                              </div>
                            </td>
                            <td className="py-1.5">
                              <button
                                onClick={() => removeDraftRate(ri)}
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
                      onClick={addDraftRate}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium mb-4"
                    >
                      + Add Rate
                    </button>

                    {/* Actions */}
                    <div className="flex items-center gap-3 border-t border-gray-800 pt-4">
                      <button
                        onClick={saveStipend}
                        className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-500 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={collapseMapping}
                        className="px-4 py-1.5 text-gray-400 hover:text-gray-200 text-xs font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDeleteStipend(m.id)}
                        className="ml-auto text-xs text-red-500 hover:text-red-400 font-medium transition-colors"
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
      </section>

      {/* Code Reference */}
      <section className="mb-6">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Code Reference</h3>
        <button
          onClick={() => navigate('/settings/cpt-ranges')}
          className="flex items-center justify-between w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors group"
        >
          <div className="text-left">
            <p className="text-sm font-medium text-gray-200">CPT Code Ranges</p>
            <p className="text-xs text-gray-600 mt-0.5">{cptRanges.length} ranges configured</p>
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </section>

      {/* ── Backup & Restore ───────────────────────────────────────────── */}
      <section className="mb-6">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Backup & Restore</h3>
        <p className="text-xs text-gray-600 mb-4">
          Export all data — reports, schedules, settings, stipend mappings, and CPT ranges — into a single JSON file.
          Importing will <span className="text-amber-400">replace all existing data</span>.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Export */}
          <a
            href="/api/export"
            download
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg hover:bg-gray-700 hover:border-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Backup
          </a>

          {/* Import trigger */}
          {importState === 'idle' || importState === 'error' ? (
            <button
              onClick={() => { setImportState('idle'); setImportError(null); importInputRef.current?.click() }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg hover:bg-gray-700 hover:border-gray-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
              </svg>
              Import Backup
            </button>
          ) : null}

          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        </div>

        {/* Error */}
        {importState === 'error' && importError && (
          <p className="mt-3 text-xs text-red-400">{importError}</p>
        )}

        {/* Confirm */}
        {importState === 'confirm' && (
          <div className="mt-3 flex items-center gap-3 p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-amber-300 flex-1">This will replace all existing data. Are you sure?</span>
            <button onClick={confirmImport} className="px-3 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-500 font-medium">Yes, Import</button>
            <button onClick={() => { setImportState('idle'); setPendingImport(null) }} className="px-3 py-1 text-xs text-gray-500 hover:text-gray-300">Cancel</button>
          </div>
        )}

        {/* Importing / Done */}
        {importState === 'importing' && (
          <p className="mt-3 text-xs text-gray-400">Importing…</p>
        )}
        {importState === 'done' && (
          <p className="mt-3 text-xs text-emerald-400">Import successful — reloading…</p>
        )}

        {/* ── Maintenance ─────────────────────────────────────────────── */}
        <div className="border-t border-gray-800 mt-5 pt-5">
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1">Database Maintenance</p>
          <p className="text-xs text-gray-600 mb-3">
            Checkpoints the WAL file and runs VACUUM to compact the database.
            A backup copy (<span className="font-mono">bpt.db.bak</span>) is created automatically before every import.
          </p>
          <button
            onClick={runMaintenance}
            disabled={maintState === 'running'}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg hover:bg-gray-700 hover:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {maintState === 'running' ? (
              <>
                <svg className="w-4 h-4 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Running…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Run Maintenance
              </>
            )}
          </button>

          {maintState === 'error' && maintError && (
            <p className="mt-2 text-xs text-red-400">{maintError}</p>
          )}
          {maintState === 'done' && maintResult && (
            <>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                {
                  label: 'Checkpoint blocked',
                  value: maintResult.walBusy ? 'Yes — active reader' : 'No',
                  ok: !maintResult.walBusy,
                },
                {
                  label: 'WAL remaining',
                  value: `${maintResult.walPagesRemaining} pages`,
                  ok: maintResult.walPagesRemaining === 0,
                },
                {
                  label: 'Size before',
                  value: `${(maintResult.dbSizeBefore / 1024 / 1024).toFixed(2)} MB`,
                  ok: true,
                },
                {
                  label: 'Size after',
                  value: `${(maintResult.dbSizeAfter / 1024 / 1024).toFixed(2)} MB`,
                  ok: maintResult.dbSizeAfter <= maintResult.dbSizeBefore,
                },
              ].map(({ label, value, ok }) => (
                <div key={label} className="bg-gray-800/60 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                  <p className={`text-sm font-medium ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>{value}</p>
                </div>
              ))}
            </div>
            {maintResult.walBusy && (
              <p className="mt-2 text-xs text-amber-400">
                WAL could not be fully truncated — a read transaction was active. Try again in a moment.
              </p>
            )}
            </>
          )}
          {maintState === 'done' && maintResult && (
            <p className="mt-2 text-xs text-gray-600">
              {maintResult.backupExists
                ? 'A pre-import backup (bpt.db.bak) exists in the data directory.'
                : 'No backup file found — run an import first to create one.'}
            </p>
          )}
        </div>
      </section>

      {/* ── Stipend overlap warning modal ───────────────────────────────── */}
      {overlapWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-amber-700/50 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="text-sm font-semibold text-gray-100 mb-1">Overlapping Stipend Schedules</h3>
                <p className="text-xs text-gray-500">
                  <span className="font-medium text-amber-300">{overlapWarning.candidate.name || overlapWarning.candidate.filename}</span>
                  {' '}(effective {formatMonthYear(...overlapWarning.candidate.effectiveDate.split('-').slice(0,2).map(Number) as [number,number])})
                  {' '}overlaps with the following existing schedule{overlapWarning.overlapping.length !== 1 ? 's' : ''}:
                </p>
              </div>
            </div>

            <div className="space-y-2 mb-5">
              {overlapWarning.overlapping.map((m) => {
                const canFix = m.effectiveDate < overlapWarning.candidate.effectiveDate
                const fixDate = prevMonthLastDay(overlapWarning.candidate.effectiveDate)
                const [fy, fm] = fixDate.split('-').map(Number)
                return (
                  <div key={m.id} className="bg-gray-800 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-200">{m.name || m.filename}</span>
                      {canFix ? (
                        <span className="text-xs text-emerald-400 font-medium">Auto-fixable</span>
                      ) : (
                        <span className="text-xs text-amber-400">Manual fix needed</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      Effective {formatMonthYear(...m.effectiveDate.split('-').slice(0,2).map(Number) as [number,number])}
                      {m.endDate ? ` – ${formatMonthYear(...m.endDate.split('-').slice(0,2).map(Number) as [number,number])}` : ' – present'}
                    </p>
                    {canFix && (
                      <p className="text-xs text-emerald-500 mt-1">
                        → End date will be set to {formatMonthYear(fy, fm)}
                      </p>
                    )}
                    {!canFix && (
                      <p className="text-xs text-amber-500/80 mt-1">
                        → Starts after the new schedule — adjust dates manually after saving
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleOverlapFixAndSave}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded-lg font-medium transition-colors"
              >
                Fix &amp; Save
              </button>
              <button
                onClick={handleOverlapSaveAnyway}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg font-medium transition-colors"
              >
                Save Anyway
              </button>
              <button
                onClick={() => setOverlapWarning(null)}
                className="ml-auto text-sm text-gray-500 hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spacer so sticky bar doesn't overlap content */}
      {hasUnsavedChanges && <div className="h-16" />}

      {/* Sticky unsaved-changes bar */}
      {(hasUnsavedChanges || saved) && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-6 py-3 bg-gray-900 border-t border-gray-700 shadow-2xl">
          <span className="text-sm text-gray-400">
            {saved ? (
              <span className="text-emerald-400 font-medium">✓ Settings saved</span>
            ) : (
              'You have unsaved changes'
            )}
          </span>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      )}
      <div className="mt-12 pt-6 border-t border-gray-800 text-center">
        <span className="text-xs text-gray-600">v1.0.2</span>
      </div>
    </div>
  )
}
