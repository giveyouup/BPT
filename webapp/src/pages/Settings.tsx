import { useState } from 'react'
import { useData } from '../context/DataContext'
import { computeFederalHolidays, getFederalHolidayLabels } from '../utils/shiftUtils'
import { formatDateFull, formatMonthYear } from '../utils/dateUtils'
import { parseStipendMapping } from '../utils/stipendMappingParser'
import type { StipendMapping, StipendRate } from '../types'

const inputCls = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-24'
const selectCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const PICKER_YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 3 + i)

// Returns "YYYY-MM-DD" for the last day of the given "YYYY-MM" string
function lastDayOfMonthStr(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 0) // day 0 of next month = last day of this month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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
        {MONTHS.map((name, i) => (
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
  const {
    settings: apiSettings,
    saveSettings: contextSaveSettings,
    stipendMappings: ctxMappings,
    saveStipendMapping,
    deleteStipendMapping,
  } = useData()

  const [settings, setSettings] = useState(apiSettings)
  const [saved, setSaved] = useState(false)
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
    await saveStipendMapping(mapping)
    setUploadRates(null); setUploadFilename(''); setUploadError(null)
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
    <div className="p-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-100 mb-6">Settings</h2>

      {/* Shift Hours */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Fixed-Hour Shift Defaults</h3>
        <p className="text-xs text-gray-600 mb-4">
          APS, BR, and NIR shifts use these hours regardless of case times. Override per day via the pencil icon.
        </p>
        <div className="grid grid-cols-3 gap-4">
          {(['APS', 'BR', 'NIR'] as const).map((key) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">{key} (hours)</label>
              <input
                type="number"
                step="0.5"
                value={settings.shiftHours[key]}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    shiftHours: { ...s.shiftHours, [key]: parseFloat(e.target.value) || 0 },
                  }))
                }
                className={inputCls}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Global defaults */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Global Defaults</h3>
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
        </div>
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
          <div className="flex gap-1">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setHolidayYear(y)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  y === holidayYear
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
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
            <h3 className="text-sm font-semibold text-gray-300">Stipend Rate Schedules</h3>
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
                  <span className="text-xs text-gray-600 mx-2">·</span>
                  <span className="text-xs text-gray-500 flex-1">{dateRange}</span>
                  {isCurrent && (
                    <span className="text-xs px-1.5 py-0.5 bg-indigo-900/40 text-indigo-400 rounded">current</span>
                  )}
                  <span className="text-xs text-gray-700 ml-2">{m.rates.length} rates</span>
                </button>

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
                            onChange={(v) => setStipendDraft({ ...draft, endDate: v ? lastDayOfMonthStr(v) : undefined })}
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

      <button
        onClick={handleSave}
        className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
      >
        {saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}
