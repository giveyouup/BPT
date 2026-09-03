import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import type { PcrCategoryMapping } from '../types'
import { randomId } from '../utils/dateUtils'
import { describeStipendGroupKey } from '../utils/calculations'
import { resolvePcrCategoryMapping } from '../utils/pcrCategoryMatching'
import { applyPcrStipendCarveoutsForAllStatements } from '../utils/pcrStipendCarveouts'

// StipendCalculator's own internal group keys (webapp/src/pages/StipendCalculator.tsx,
// classifyBase()/getStipendGroup()) -- a fixed, closed vocabulary, so a <select>
// is safe here (unlike the expense side, which also allows a free-form category).
const STIPEND_GROUP_OPTIONS: { value: string; hint: string }[] = [
  { value: 'mainOrCall', hint: 'G1/G2 call shifts' },
  { value: 'otherG', hint: 'other G-shifts (G3–G17)' },
  { value: 'APS', hint: 'Acute Pain Service' },
  { value: 'BR', hint: 'Board Runner' },
  { value: 'NIR', hint: '' },
  { value: 'ROC', hint: '' },
  { value: 'GI', hint: 'GI / Endo' },
  { value: 'FS', hint: 'FS-prefixed codes' },
  { value: 'alhambra', hint: '' },
  { value: 'other', hint: '' },
  { value: 'additional', hint: 'manual/day stipends' },
]

// AnnualExpenses' known leaf keys (webapp/src/pages/Compensation.tsx) -- offered
// as suggestions via <datalist>, but expense mappings also allow a free-form
// category name routed into AnnualExpenses' entries[] instead of a fixed leaf.
const EXPENSE_KEY_SUGGESTIONS = [
  'payrollTaxes', 'profitSharing', 'cashBalance', 'healthDental', 'healthMedical', 'healthVision',
  'healthBenicomp', 'developmentReserve', 'operatingFee', 'operatingExpense',
  'liabilityInsurance', 'licensesDues', 'cme', 'phoneInternet',
]

const inputCls = 'bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500'
const thCls = 'px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider'

function MappingSection({
  title, description, section, mappings, targetKeyInput, save, remove, reset,
  unmappedLabels, hiddenLabels, onHideLabel, onUnhideLabel,
}: {
  title: string
  description: string
  section: 'stipend' | 'expense'
  mappings: PcrCategoryMapping[]
  targetKeyInput: (value: string, onChange: (v: string) => void, onEnter: () => void, autoFocus?: boolean) => React.ReactNode
  save: (m: PcrCategoryMapping) => Promise<void>
  remove: (id: string) => Promise<void>
  reset?: () => Promise<void>
  unmappedLabels?: string[]
  hiddenLabels?: string[]
  onHideLabel?: (label: string) => void
  onUnhideLabel?: (label: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ label: '', targetKey: '' })
  const [newForm, setNewForm] = useState({ label: '', targetKey: '' })
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const newLabelRef = useRef<HTMLInputElement>(null)

  function fillFromUnmapped(label: string) {
    setEditingId(null)
    setNewForm((f) => ({ ...f, label }))
    newLabelRef.current?.focus()
  }

  async function handleReset() {
    if (!reset) return
    if (!confirmReset) { setConfirmReset(true); return }
    setSaving(true)
    try {
      await reset()
      setConfirmReset(false)
      setEditingId(null)
    } finally { setSaving(false) }
  }

  const sorted = useMemo(
    () => [...mappings].sort((a, b) => a.label.localeCompare(b.label)),
    [mappings],
  )

  function startEdit(m: PcrCategoryMapping) {
    setEditingId(m.id)
    setEditForm({ label: m.label, targetKey: m.targetKey })
  }

  async function saveEdit(id: string) {
    if (!editForm.label.trim() || !editForm.targetKey.trim()) return
    setSaving(true)
    try {
      await save({ id, section, label: editForm.label.trim(), targetKey: editForm.targetKey.trim() })
      setEditingId(null)
    } finally { setSaving(false) }
  }

  async function handleAdd() {
    if (!newForm.label.trim() || !newForm.targetKey.trim()) return
    setSaving(true)
    try {
      await save({ id: randomId(), section, label: newForm.label.trim(), targetKey: newForm.targetKey.trim() })
      setNewForm({ label: '', targetKey: '' })
    } finally { setSaving(false) }
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
        {reset && (
          confirmReset ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-400">Reset to defaults?</span>
              <button onClick={handleReset} disabled={saving} className="px-2.5 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-500 disabled:opacity-50">Yes, Reset</button>
              <button onClick={() => setConfirmReset(false)} className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-300">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="text-xs text-gray-600 hover:text-amber-400 transition-colors border border-gray-800 hover:border-amber-700 px-2.5 py-1 rounded-md">
              Reset to Defaults
            </button>
          )
        )}
      </div>
      <p className="text-xs text-gray-600 mb-3">{description}</p>

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden mb-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className={thCls}>PCR Label</th>
                <th className={thCls + ' w-56'}>Maps To</th>
                <th className={thCls + ' w-16'} />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-4 text-xs text-gray-600">No mappings configured yet.</td></tr>
              )}
              {sorted.map((m) => {
                const isEditing = editingId === m.id
                return (
                  <tr key={m.id} className={`border-b border-gray-800 last:border-0 ${isEditing ? 'bg-indigo-950/20' : 'hover:bg-gray-800/40'}`}>
                    {isEditing ? (
                      <>
                        <td className="px-4 py-2">
                          <input type="text" value={editForm.label} onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(m.id); if (e.key === 'Escape') setEditingId(null) }}
                            className={inputCls + ' w-full'} autoFocus />
                        </td>
                        <td className="px-4 py-2">
                          {targetKeyInput(editForm.targetKey, (v) => setEditForm((f) => ({ ...f, targetKey: v })), () => saveEdit(m.id))}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => saveEdit(m.id)} disabled={saving} className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50">Save</button>
                            <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-gray-300 text-xs cursor-pointer hover:text-indigo-400" onClick={() => startEdit(m)}>{m.label}</td>
                        <td className="px-4 py-2.5 text-gray-400 font-mono text-xs cursor-pointer hover:text-indigo-400" onClick={() => startEdit(m)}>{m.targetKey}</td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => remove(m.id)} className="text-gray-700 hover:text-red-400 transition-colors" title="Delete">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {((unmappedLabels && unmappedLabels.length > 0) || (hiddenLabels && hiddenLabels.length > 0)) && (
        <div className="mb-3">
          {unmappedLabels && unmappedLabels.length > 0 ? (
            <>
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">
                Unmapped PCR Labels — click to prefill below
              </p>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {unmappedLabels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-md text-[11px] font-mono border border-gray-700 text-gray-400 hover:border-indigo-600 transition-colors"
                  >
                    <button onClick={() => fillFromUnmapped(label)} className="hover:text-indigo-300">
                      {label}
                    </button>
                    {onHideLabel && (
                      <button
                        onClick={() => onHideLabel(label)}
                        className="text-gray-600 hover:text-red-400 leading-none px-0.5"
                        title="Dismiss this suggestion"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </>
          ) : null}

          {hiddenLabels && hiddenLabels.length > 0 && (
            <div>
              <button
                onClick={() => setShowHidden((v) => !v)}
                className="text-[10px] text-gray-600 hover:text-gray-400 underline underline-offset-2"
              >
                {showHidden ? 'Hide dismissed labels' : `Show ${hiddenLabels.length} dismissed`}
              </button>
              {showHidden && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {hiddenLabels.map((label) => (
                    <button
                      key={label}
                      onClick={() => onUnhideLabel?.(label)}
                      className="px-2 py-1 rounded-md text-[11px] font-mono border border-gray-800 text-gray-600 hover:text-emerald-400 hover:border-emerald-700 transition-colors"
                      title="Restore this suggestion"
                    >
                      {label} <span className="ml-0.5">↺</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={newLabelRef} type="text" placeholder="PCR label, e.g. SMCS Acute Pain" value={newForm.label}
            onChange={(e) => setNewForm((f) => ({ ...f, label: e.target.value }))}
            className={inputCls + ' flex-1 min-w-56'} />
          {targetKeyInput(newForm.targetKey, (v) => setNewForm((f) => ({ ...f, targetKey: v })), handleAdd)}
          <button onClick={handleAdd} disabled={saving || !newForm.label.trim() || !newForm.targetKey.trim()}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed font-medium">
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PcrCategoryMappingPage() {
  const navigate = useNavigate()
  const {
    pcrCategoryMappings, savePcrCategoryMapping, deletePcrCategoryMapping, resetPcrCategoryMappings, settings, saveSettings,
    pcrIncomeStatements, reports, schedules, saveReport, activePhysicianId,
    stipendMappings: stipendRateMappings,
  } = useData()

  const stipendMappings = pcrCategoryMappings.filter((m) => m.section === 'stipend')
  const expenseMappings = pcrCategoryMappings.filter((m) => m.section === 'expense')

  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState<string | null>(null)

  async function handleBackfillCarveouts() {
    setBackfilling(true)
    setBackfillResult(null)
    try {
      const updated = applyPcrStipendCarveoutsForAllStatements(
        pcrIncomeStatements, pcrCategoryMappings, reports, schedules, activePhysicianId, settings, stipendRateMappings,
      )
      await Promise.all(updated.map((r) => saveReport(r)))
      setBackfillResult(updated.length === 0
        ? 'Nothing to apply — no Fort Sutter / ROC / Alhambra amounts found (or already up to date).'
        : `Applied to ${updated.length} month${updated.length !== 1 ? 's' : ''}.`)
    } finally {
      setBackfilling(false)
    }
  }

  function findUnmappedLabels(section: 'stipend' | 'expense'): string[] {
    const set = new Set<string>()
    for (const stmt of pcrIncomeStatements) {
      for (const line of stmt.lines) {
        if (line.section !== section) continue
        if (!resolvePcrCategoryMapping(line.label, section, pcrCategoryMappings)) set.add(line.label)
      }
    }
    return [...set].sort()
  }

  const allUnmappedStipendLabels = useMemo(
    () => findUnmappedLabels('stipend'),
    [pcrIncomeStatements, pcrCategoryMappings],
  )
  const allUnmappedExpenseLabels = useMemo(
    () => findUnmappedLabels('expense'),
    [pcrIncomeStatements, pcrCategoryMappings],
  )

  // Unmapped labels the user has dismissed from the suggestion chips (e.g. section
  // headers or rows they've decided not to track) -- kept separately from actual
  // mappings so they stay hidden but can be brought back at any time.
  const hiddenStipendLabels = settings.hiddenPcrLabels?.stipend ?? []
  const hiddenExpenseLabels = settings.hiddenPcrLabels?.expense ?? []

  const unmappedStipendLabels = allUnmappedStipendLabels.filter((l) => !hiddenStipendLabels.includes(l))
  const unmappedExpenseLabels = allUnmappedExpenseLabels.filter((l) => !hiddenExpenseLabels.includes(l))
  // Only offer "restore" for labels still actually unmapped -- once mapped, a
  // stale hidden entry is dropped automatically rather than lingering forever.
  const visibleHiddenStipendLabels = hiddenStipendLabels.filter((l) => allUnmappedStipendLabels.includes(l))
  const visibleHiddenExpenseLabels = hiddenExpenseLabels.filter((l) => allUnmappedExpenseLabels.includes(l))

  function setHiddenLabels(section: 'stipend' | 'expense', labels: string[]) {
    const current = settings.hiddenPcrLabels ?? { stipend: [], expense: [] }
    saveSettings({ ...settings, hiddenPcrLabels: { ...current, [section]: labels } })
  }
  function hideLabel(section: 'stipend' | 'expense', label: string) {
    const current = section === 'stipend' ? hiddenStipendLabels : hiddenExpenseLabels
    if (current.includes(label)) return
    setHiddenLabels(section, [...current, label])
  }
  function unhideLabel(section: 'stipend' | 'expense', label: string) {
    const current = section === 'stipend' ? hiddenStipendLabels : hiddenExpenseLabels
    setHiddenLabels(section, current.filter((l) => l !== label))
  }

  // Standalone columns configured in Stipend Calculator's "Columns" popover (e.g. "G3
  // weekend broken out on its own") -- these need to be selectable here too, so a PCR
  // label can be assigned directly to one instead of falling into its catch-all bucket.
  const promotedStipendOptions = useMemo(
    () => [...(settings.promotedStipendCodes ?? [])]
      .map((key) => ({ value: key, label: describeStipendGroupKey(key) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [settings.promotedStipendCodes],
  )

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => navigate('/settings')} className="text-gray-600 hover:text-gray-300 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-2xl font-bold text-gray-100">PCR Category Mapping</h2>
      </div>
      <p className="text-xs text-gray-600 mb-6 ml-7">
        PCR income-statement labels are free text that can vary between months. Map each one to an internal
        category here so the PCR Audit (Audits page) and the Compensation page's expense sync can match them up.
        A label with no mapping shows up as "Unmapped" in those places rather than being silently ignored.
      </p>

      <div className="flex items-center gap-3 mb-6 px-3 py-2.5 bg-gray-800/60 border border-gray-700/60 rounded-lg">
        <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <p className="text-xs text-gray-400 flex-1">
          Fort Sutter and Alhambra are paid as a lump monthly PCR amount rather than a per-shift rate;
          ROC has both a per-shift rate and a variable lump sum on top, so only the excess over the
          rate-sheet amount is carried over. Either way it lands in the Dashboard's "Additional Stipend"
          entry automatically on upload. Use this after mapping one of those labels for the first time
          to backfill months already uploaded.
        </p>
        <button
          onClick={handleBackfillCarveouts}
          disabled={backfilling}
          className="px-3 py-1.5 text-xs bg-gray-700 text-gray-200 rounded-md hover:bg-gray-600 disabled:opacity-50 font-medium whitespace-nowrap"
        >
          {backfilling ? 'Applying…' : 'Backfill Now'}
        </button>
      </div>
      {backfillResult && (
        <p className="text-xs text-indigo-400 mb-4 -mt-4">{backfillResult}</p>
      )}

      <MappingSection
        title="Stipend Labels"
        description={'Maps a PCR stipend line (e.g. "SMCS Acute Pain") to one of the Stipend Calculator\'s own categories, so the PCR Audit can compare what was paid against what\'s owed. Any standalone column configured there (Stipend Calculator → Columns) also appears here.'}
        section="stipend"
        mappings={stipendMappings}
        save={savePcrCategoryMapping}
        remove={deletePcrCategoryMapping}
        reset={() => resetPcrCategoryMappings('stipend')}
        unmappedLabels={unmappedStipendLabels}
        hiddenLabels={visibleHiddenStipendLabels}
        onHideLabel={(label) => hideLabel('stipend', label)}
        onUnhideLabel={(label) => unhideLabel('stipend', label)}
        targetKeyInput={(value, onChange, onEnter, autoFocus) => {
          const isKnown = STIPEND_GROUP_OPTIONS.some((o) => o.value === value) || promotedStipendOptions.some((o) => o.value === value)
          return (
            <select value={value} onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onEnter() }}
              className={inputCls + ' w-52'} autoFocus={autoFocus}>
              <option value="">Choose a category…</option>
              {STIPEND_GROUP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.value}{o.hint ? ` — ${o.hint}` : ''}</option>
              ))}
              {promotedStipendOptions.length > 0 && (
                <optgroup label="Standalone Columns">
                  {promotedStipendOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </optgroup>
              )}
              {value && !isKnown && (
                <option value={value}>{describeStipendGroupKey(value)} (no longer a standalone column)</option>
              )}
            </select>
          )
        }}
      />

      <MappingSection
        title="Expense Labels"
        description={'Maps a PCR expense line (e.g. "Payroll Taxes") to a Compensation-page category, or type a new name to route it into that page\'s free-form entries instead.'}
        section="expense"
        mappings={expenseMappings}
        save={savePcrCategoryMapping}
        remove={deletePcrCategoryMapping}
        reset={() => resetPcrCategoryMappings('expense')}
        unmappedLabels={unmappedExpenseLabels}
        hiddenLabels={visibleHiddenExpenseLabels}
        onHideLabel={(label) => hideLabel('expense', label)}
        onUnhideLabel={(label) => unhideLabel('expense', label)}
        targetKeyInput={(value, onChange, onEnter, autoFocus) => (
          <>
            <input type="text" list="pcr-expense-key-options" placeholder="Category" value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onEnter() }}
              className={inputCls + ' w-52'} autoFocus={autoFocus} />
            <datalist id="pcr-expense-key-options">
              {EXPENSE_KEY_SUGGESTIONS.map((k) => <option key={k} value={k} />)}
            </datalist>
          </>
        )}
      />
    </div>
  )
}
