import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useData } from '../context/DataContext'
import { computeCalendarYearStats, computeCashYearStats, computeCalendarMonthStats, getStipendForDay, getApplicableMapping } from '../utils/calculations'
import { formatCurrency, formatMonthYear, formatDateShort, randomId } from '../utils/dateUtils'
import { resolveShiftAlias } from '../utils/shiftUtils'
import {
  CASH_COMP_LEAVES, BUSINESS_LEAVES, BENEFITS_LEAVES, RETIREMENT_LEAVES, ALL_LEAVES, LEAF_LABELS,
  CASH_COMP_KEYS, BUSINESS_KEYS, BENEFITS_KEYS, RETIREMENT_KEYS, KNOWN_RECURRING_KEYS,
} from '../utils/expenseCategories'
import { buildPcrSyncPreview as buildPcrSyncPreviewShared, applyPcrSyncChanges } from '../utils/pcrExpenseSync'
import type { PcrSyncPreview } from '../utils/pcrExpenseSync'
import type { ExpenseEntry, AnnualExpenses } from '../types'

// ─── Category definitions ──────────────────────────────────────────────────────

const HEALTHCARE_KEYS  = new Set(['healthDental', 'healthMedical', 'healthVision', 'healthBenicomp'])

type Section = 'cashComp' | 'business' | 'benefits' | 'retirement' | 'otherIncome'

const SECTION_FIELD: Record<Section, 'cashCompEntries' | 'entries' | 'benefitsEntries' | 'retirementEntries' | 'otherIncomeEntries'> = {
  cashComp: 'cashCompEntries',
  business: 'entries',
  benefits: 'benefitsEntries',
  retirement: 'retirementEntries',
  otherIncome: 'otherIncomeEntries',
}

function initDraft(rec: AnnualExpenses | undefined, annualGross: number): Record<string, string> {
  const draft: Record<string, string> = {}
  const savedFee = rec?.recurring?.['operatingFee']
  const operatingFeeAmt = savedFee !== undefined ? savedFee : Math.round(annualGross * 0.07)
  const savedDev = rec?.recurring?.['developmentReserve']
  const devAmt = savedDev !== undefined ? savedDev : Math.round((annualGross - operatingFeeAmt) * 0.10)
  for (const leaf of ALL_LEAVES) {
    const saved = rec?.recurring?.[leaf.key]
    if (saved !== undefined) {
      draft[leaf.key] = String(saved)
    } else if (leaf.key === 'operatingFee') {
      draft[leaf.key] = annualGross > 0 ? String(operatingFeeAmt) : ''
    } else if (leaf.key === 'developmentReserve') {
      draft[leaf.key] = annualGross > 0 ? String(devAmt) : ''
    } else {
      draft[leaf.key] = ''
    }
  }
  draft['carryforwardIn']  = rec?.recurring?.['carryforwardIn']  !== undefined ? String(rec.recurring['carryforwardIn'])  : ''
  draft['yearEndBalance']  = rec?.recurring?.['yearEndBalance']  !== undefined ? String(rec.recurring['yearEndBalance'])  : ''
  return draft
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function AmountInput({ value, onChange, onBlur }: {
  value: string; onChange: (v: string) => void; onBlur: () => void
}) {
  return (
    <div className="relative w-36">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-600">$</span>
      <input
        type="number" step="1" value={value} placeholder="0"
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full bg-gray-800 border border-gray-700 rounded pl-5 pr-2 py-1.5 text-sm text-right text-gray-200 placeholder-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  )
}

// Replaces the old always-visible "Category / Amount / Note" add-form with a
// collapsed "+ Add category" trigger, and makes every entry's amount (new or
// existing) an editable AmountInput instead of static text -- matching how
// every fixed-leaf row on this page already behaves, so a custom category
// never requires delete-and-re-add just to correct its amount. A category
// name alone is enough to add a row; the amount defaults to $0 and can be
// filled in (here, or later) same as any other row.
function EditableEntryList({
  entries, onAdd, onUpdateAmount, onDelete, datalistId, datalistOptions,
}: {
  entries: ExpenseEntry[]
  onAdd: (category: string, amount: number, note?: string) => void | Promise<void>
  onUpdateAmount: (id: string, amount: number) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  datalistId: string
  datalistOptions: string[]
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newAmt, setNewAmt] = useState('')
  const [newNote, setNewNote] = useState('')
  const newCatRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (adding) newCatRef.current?.focus() }, [adding])

  const amountDraftFor = (entry: ExpenseEntry) => amountDrafts[entry.id] ?? String(entry.amount)

  async function commitAmount(entry: ExpenseEntry) {
    const raw = amountDrafts[entry.id]
    if (raw === undefined) return
    const parsed = parseFloat(raw)
    const next = isNaN(parsed) ? 0 : parsed
    setAmountDrafts(d => { const n = { ...d }; delete n[entry.id]; return n })
    if (next !== entry.amount) await onUpdateAmount(entry.id, next)
  }

  function cancelAdd() {
    setNewCat(''); setNewAmt(''); setNewNote(''); setAdding(false)
  }

  async function submitAdd() {
    if (!newCat.trim()) return
    const parsed = parseFloat(newAmt)
    await onAdd(newCat.trim(), isNaN(parsed) ? 0 : parsed, newNote.trim() || undefined)
    setNewCat(''); setNewAmt(''); setNewNote(''); setAdding(false)
  }

  const onFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submitAdd()
    if (e.key === 'Escape') cancelAdd()
  }

  return (
    <div className="mb-3">
      {entries.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {entries.map(entry => (
            <div key={entry.id} className="flex items-center gap-3">
              <span className="text-sm text-gray-400 flex-1">{entry.category}</span>
              {entry.note && <span className="text-xs text-gray-600 truncate max-w-[160px]">{entry.note}</span>}
              <AmountInput
                value={amountDraftFor(entry)}
                onChange={v => setAmountDrafts(d => ({ ...d, [entry.id]: v }))}
                onBlur={() => commitAmount(entry)}
              />
              <div className="relative">
                <button
                  onClick={() => setConfirmId(entry.id)}
                  className="text-gray-600 hover:text-red-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                {confirmId === entry.id && (
                  <div className="absolute right-0 top-6 z-20 bg-gray-950 border border-gray-700 rounded-lg shadow-xl p-3 w-44">
                    <p className="text-xs text-gray-300 mb-2">Delete this entry?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { onDelete(entry.id); setConfirmId(null) }}
                        className="flex-1 px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded transition-colors font-medium"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="flex-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="flex-1 min-w-[130px]">
            <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Category</label>
            <input
              ref={newCatRef} list={datalistId} value={newCat}
              onChange={e => setNewCat(e.target.value)}
              onKeyDown={onFormKeyDown}
              placeholder="Description"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <datalist id={datalistId}>{datalistOptions.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="w-28">
            <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Amount</label>
            <input
              type="number" step="1" value={newAmt} onChange={e => setNewAmt(e.target.value)} onKeyDown={onFormKeyDown}
              placeholder="0 (optional)"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex-1 min-w-[90px]">
            <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Note</label>
            <input
              value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={onFormKeyDown}
              placeholder="optional"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <button onClick={submitAdd} disabled={!newCat.trim()} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">Add</button>
          <button onClick={cancelAdd} className="px-3 py-1.5 text-gray-500 hover:text-gray-300 text-sm transition-colors">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add category
        </button>
      )}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Compensation() {
  const {
    reports, schedules, settings, stipendMappings, annualExpenses, saveAnnualExpenses, deleteAnnualExpenses, saveSettings,
    pcrIncomeStatements, pcrCategoryMappings,
  } = useData()
  const navigate = useNavigate()

  const now = new Date()
  const currentYear = now.getFullYear()

  const years = useMemo(() => {
    const s = new Set<number>([currentYear])
    for (const r of reports) s.add(r.year)
    for (const e of annualExpenses) s.add(e.year)
    return [...s].sort((a, b) => b - a)
  }, [reports, annualExpenses, currentYear])

  const [selectedYear, setSelectedYear] = useState<number>(years[0] ?? currentYear)
  const [cashView, setCashView] = useState(true)
  const [editingCutoff, setEditingCutoff] = useState(false)
  const [cutoffInput, setCutoffInput] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [pcrSyncPreview, setPcrSyncPreview] = useState<PcrSyncPreview | null>(null)
  const [pcrSyncing, setPcrSyncing] = useState(false)
  const draftKey = useRef<string>('')
  const [pieDrill, setPieDrill] = useState<'benefits' | 'retirement' | 'netIncome' | 'cashReimbursements' | null>(null)
  // All page sections collapsed by default (pieChart excepted); keyed by section id.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ pieChart: true, expenses: true })
  const toggleSection = (key: string) => setOpenSections(o => ({ ...o, [key]: !o[key] }))


  const yearStats = useMemo(
    () => computeCalendarYearStats(selectedYear, reports, schedules, settings, stipendMappings),
    [selectedYear, reports, schedules, settings, stipendMappings]
  )

  const cashStats = useMemo(
    () => computeCashYearStats(selectedYear, reports, schedules, settings, stipendMappings),
    [selectedYear, reports, schedules, settings, stipendMappings]
  )

  const accrualGross = useMemo(
    () => yearStats.reduce((s, m) => s + m.totalCompensation, 0),
    [yearStats]
  )

  const accrualUnitPay = useMemo(
    () => yearStats.reduce((s, m) => s + m.unitCompensation, 0),
    [yearStats]
  )

  const annualGross = cashView ? cashStats.totalCompensation : accrualGross

  const prevDecWorkingDays = useMemo(
    () => cashView
      ? (computeCalendarMonthStats(selectedYear - 1, 12, reports, schedules, settings, stipendMappings)?.workingDays ?? [])
      : [],
    [cashView, selectedYear, reports, schedules, settings, stipendMappings]
  )

  const stipendBreakdown = useMemo(() => {
    const HOSP_CATS = [
      { label: 'NIR',        pattern: /^NIR$/i },
      { label: 'BR',         pattern: /^BR$/i },
      { label: 'G1/G2 Call', pattern: /^G[12]$/i },
      { label: 'Other G',    pattern: /^G[3-9]$|^G\d{2,}$/i },
      { label: 'APS',        pattern: /^APS$/i },
      { label: 'ROC',        pattern: /^ROC$/i },
      { label: 'GI',         pattern: /^(GI|ENDO)$/i },
    ]
    const ASC_CATS = [
      { label: 'FS',       pattern: /^FS\d*$/i },
      { label: 'Alhambra', pattern: /^A\d+$/i },
    ]
    const ASC_SHIFT = /^(FS\d*|A\d+)$/i

    const hospTotals: Record<string, number> = Object.fromEntries(HOSP_CATS.map(c => [c.label, 0]))
    const ascTotals:  Record<string, number> = Object.fromEntries(ASC_CATS.map(c => [c.label, 0]))
    let hospOther = 0, hospAdditional = 0, ascAdditional = 0

    function processMonth(year: number, month: number, days: typeof yearStats[0]['workingDays']) {
      const mapping = getApplicableMapping(year, month, stipendMappings)
      for (const day of days) {
        const dayIsAsc = day.shiftTypes.some(r => ASC_SHIFT.test(resolveShiftAlias(r.toUpperCase())))

        for (const raw of day.shiftTypes) {
          const canonical = resolveShiftAlias(raw.toUpperCase())
          const amt = getStipendForDay([raw], day.isCallWeekend, mapping)
          if (amt === 0) continue

          let matched = false
          for (const c of ASC_CATS) {
            if (c.pattern.test(canonical)) { ascTotals[c.label] += amt; matched = true; break }
          }
          if (!matched) {
            for (const c of HOSP_CATS) {
              if (c.pattern.test(canonical)) { hospTotals[c.label] += amt; matched = true; break }
            }
            if (!matched) hospOther += amt
          }
        }

        if (day.additionalStipend !== 0) {
          if (dayIsAsc) {
            // Attribute to the specific ASC category if unambiguous, else "Additional"
            const ascCatsOnDay = ASC_CATS.filter(c =>
              day.shiftTypes.some(r => c.pattern.test(resolveShiftAlias(r.toUpperCase())))
            )
            if (ascCatsOnDay.length === 1) {
              ascTotals[ascCatsOnDay[0].label] += day.additionalStipend
            } else {
              ascAdditional += day.additionalStipend
            }
          } else {
            // Attribute to the specific hospital category if unambiguous, else "Additional"
            const hospCatsOnDay = HOSP_CATS.filter(c =>
              day.shiftTypes.some(r => c.pattern.test(resolveShiftAlias(r.toUpperCase())))
            )
            if (hospCatsOnDay.length === 1) {
              hospTotals[hospCatsOnDay[0].label] += day.additionalStipend
            } else {
              hospAdditional += day.additionalStipend
            }
          }
        }
      }
    }

    if (cashView) {
      processMonth(selectedYear - 1, 12, prevDecWorkingDays)
      for (const ms of yearStats) {
        if (ms.month <= 11) processMonth(ms.year, ms.month, ms.workingDays)
      }
    } else {
      for (const ms of yearStats) {
        processMonth(ms.year, ms.month, ms.workingDays)
      }
    }

    const hospital = [
      ...HOSP_CATS.map(c => ({ label: c.label, amount: hospTotals[c.label] })).filter(r => r.amount > 0),
      ...(hospOther      > 0 ? [{ label: 'Other',      amount: hospOther      }] : []),
      ...(hospAdditional > 0 ? [{ label: 'Additional', amount: hospAdditional }] : []),
    ]
    const asc = [
      ...ASC_CATS.map(c => ({ label: c.label, amount: ascTotals[c.label] })).filter(r => r.amount > 0),
      ...(ascAdditional  > 0 ? [{ label: 'Additional', amount: ascAdditional  }] : []),
    ]
    return { hospital, asc }
  }, [cashView, selectedYear, yearStats, prevDecWorkingDays, stipendMappings])

  const currentRecord = useMemo(
    () => annualExpenses.find(e => e.year === selectedYear),
    [annualExpenses, selectedYear]
  )

  const prevYearRecord = useMemo(
    () => annualExpenses.find(e => e.year === selectedYear - 1),
    [annualExpenses, selectedYear]
  )

  useEffect(() => {
    // Re-initialize the draft when:
    //   (a) the year changes, OR
    //   (b) gross data first becomes available for a year that had no saved record
    // Do NOT re-initialize when currentRecord changes (e.g. user saves an entry mid-edit).
    const hasData = annualGross > 0 || !!currentRecord
    const key = `${selectedYear}:${hasData}`
    if (key === draftKey.current) return
    // Don't downgrade from a richer key — keeps draft stable if data briefly disappears
    if (!hasData && draftKey.current === `${selectedYear}:true`) return
    draftKey.current = key
    setDraft(initDraft(currentRecord, annualGross))
  }, [selectedYear, currentRecord, annualGross])

  async function saveCutoff() {
    const trimmed = cutoffInput.trim()
    const updated = { ...settings, cashCutoffs: { ...(settings.cashCutoffs ?? {}) } }
    if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      updated.cashCutoffs![selectedYear] = trimmed
    } else {
      delete updated.cashCutoffs![selectedYear]
    }
    await saveSettings(updated)
    setEditingCutoff(false)
  }

  function getOrCreate(): AnnualExpenses {
    return currentRecord ?? {
      id: String(selectedYear), year: selectedYear,
      recurring: {}, entries: [], benefitsEntries: [], retirementEntries: [], otherIncomeEntries: [],
    }
  }

  function hasAnything(rec: AnnualExpenses): boolean {
    return (
      Object.values(rec.recurring ?? {}).some(v => v !== 0) ||
      (rec.cashCompEntries?.length ?? 0) > 0 ||
      (rec.entries?.length ?? 0) > 0 ||
      (rec.benefitsEntries?.length ?? 0) > 0 ||
      (rec.retirementEntries?.length ?? 0) > 0 ||
      (rec.otherIncomeEntries?.length ?? 0) > 0
    )
  }

  async function handleBlur(key: string) {
    const amount = parseFloat(draft[key] ?? '') || 0
    const record = getOrCreate()
    const merged = { ...(record.recurring ?? {}), [key]: amount }
    const updatedRecurring = Object.fromEntries(Object.entries(merged).filter(([k]) => KNOWN_RECURRING_KEYS.has(k)))
    const updated = { ...record, recurring: updatedRecurring }
    if (!hasAnything(updated) && currentRecord) {
      await deleteAnnualExpenses(updated.id)
    } else if (hasAnything(updated)) {
      await saveAnnualExpenses(updated)
    }
  }

  async function handleAddEntry(section: Section, category: string, amount: number, note?: string) {
    if (!category.trim()) return
    const record = getOrCreate()
    const field = SECTION_FIELD[section]
    const entry: ExpenseEntry = { id: randomId(), category: category.trim(), amount: amount || 0, note: note?.trim() || undefined }
    await saveAnnualExpenses({ ...record, [field]: [...(record[field] ?? []), entry] })
  }

  async function handleUpdateEntryAmount(section: Section, entryId: string, amount: number) {
    const record = getOrCreate()
    const field = SECTION_FIELD[section]
    const updated = { ...record, [field]: (record[field] ?? []).map(e => e.id === entryId ? { ...e, amount } : e) }
    await saveAnnualExpenses(updated)
  }

  async function handleDeleteEntry(section: Section, entryId: string) {
    const record = getOrCreate()
    const field = SECTION_FIELD[section]
    const updated = { ...record, [field]: (record[field] ?? []).filter(e => e.id !== entryId) }
    if (!hasAnything(updated)) await deleteAnnualExpenses(updated.id)
    else await saveAnnualExpenses(updated)
  }

  // ── Sync from PCR ────────────────────────────────────────────────────────────
  // Core resolution/apply logic lives in utils/pcrExpenseSync.ts, shared with
  // Upload.tsx's automatic "safe" sync (see applySafePcrSync there) so the
  // manual review flow here and the automatic first-time-population path can
  // never disagree about what a PCR label resolves to.

  function buildPcrSyncPreview(): PcrSyncPreview {
    return buildPcrSyncPreviewShared(
      selectedYear, pcrIncomeStatements, pcrCategoryMappings, annualExpenses, currentRecord,
      settings.hiddenPcrLabels?.expense ?? [], settings.dismissedUnmappedCategories ?? [],
      settings.hiddenPcrLabels?.otherIncome ?? [],
    )
  }

  async function applyPcrSync() {
    if (!pcrSyncPreview) return
    setPcrSyncing(true)
    try {
      const updated = applyPcrSyncChanges(getOrCreate(), pcrSyncPreview.changes)
      await saveAnnualExpenses(updated)
      setDraft(d => {
        const next = { ...d }
        for (const change of pcrSyncPreview.changes) {
          if (change.section === 'expense' && KNOWN_RECURRING_KEYS.has(change.key)) next[change.key] = String(change.proposed)
        }
        return next
      })
      setPcrSyncPreview(null)
    } finally {
      setPcrSyncing(false)
    }
  }

  // Reuses the same dismiss list the PCR Category Mapping / Income Statement
  // pages already use for genuinely-unmapped labels -- a "needs a home"
  // label already has a mapping, but the underlying ask ("stop nagging me
  // about this one") is the same, so it shares the list.
  async function dismissNeedsHomeLabel(pcrLabel: string) {
    const current = settings.hiddenPcrLabels ?? { stipend: [], expense: [] }
    if ((current.expense ?? []).includes(pcrLabel)) return
    await saveSettings({ ...settings, hiddenPcrLabels: { ...current, expense: [...(current.expense ?? []), pcrLabel] } })
  }

  // Mirror image of dismissNeedsHomeLabel -- this one starts from a category
  // with no mapping at all, for a category that's deliberately hand-managed
  // and was never meant to sync from the PCR.
  async function dismissUnmappedCategory(category: string) {
    const current = settings.dismissedUnmappedCategories ?? []
    if (current.includes(category)) return
    await saveSettings({ ...settings, dismissedUnmappedCategories: [...current, category] })
  }

  // ── Derived totals ────────────────────────────────────────────────────────────

  function recurringSum(keys: Set<string>): number {
    if (!currentRecord?.recurring) return 0
    return Object.entries(currentRecord.recurring)
      .filter(([k]) => keys.has(k))
      .reduce((s, [, v]) => s + v, 0)
  }

  const businessExpenses     = recurringSum(BUSINESS_KEYS) + (currentRecord?.entries?.reduce((s, e) => s + e.amount, 0) ?? 0)
  const benefitsTotal        = recurringSum(BENEFITS_KEYS) + (currentRecord?.benefitsEntries?.reduce((s, e) => s + e.amount, 0) ?? 0)
  const healthcareTotal      = recurringSum(HEALTHCARE_KEYS)
  const retirementTotal      = recurringSum(RETIREMENT_KEYS) + (currentRecord?.retirementEntries?.reduce((s, e) => s + e.amount, 0) ?? 0)
  const otherIncome          = (currentRecord?.otherIncomeEntries ?? []).reduce((s, e) => s + e.amount, 0)
  const carryforwardIn       = currentRecord?.recurring?.['carryforwardIn']  ?? 0
  const yearEndBalance       = currentRecord?.recurring?.['yearEndBalance']  ?? 0
  const totalGrossRevenue    = annualGross + otherIncome + carryforwardIn - yearEndBalance
  const clinicalNet          = annualGross - businessExpenses - benefitsTotal - retirementTotal
  const netCompensation      = clinicalNet + otherIncome + carryforwardIn - yearEndBalance
  const totalComp            = netCompensation + benefitsTotal + retirementTotal
  // Cash Compensation is computed directly from what's actually been paid --
  // Physician Salary (the PCR's own "MD Salaries" line) plus Cash
  // Reimbursements (Benicomp/CME/Business Meetings/Phone-Internet, plus any
  // free-form entries) -- rather than being a pure leftover. The PCR's MD
  // Salaries line is a periodic draw that lags the physician's true earned
  // pay (true-up'd whenever the PCR closes out), so the gap between what's
  // been paid so far and netCompensation (the true total -- unchanged from
  // before) is surfaced explicitly as "Outstanding Salary Balance" instead
  // of being silently absorbed. It can go negative (more drawn than earned
  // so far this year).
  const physicianSalary        = currentRecord?.recurring?.['salary'] ?? 0
  const cashReimbursements     = recurringSum(CASH_COMP_KEYS) - physicianSalary + (currentRecord?.cashCompEntries?.reduce((s, e) => s + e.amount, 0) ?? 0)
  const cashCompPaid           = physicianSalary + cashReimbursements
  const outstandingSalaryBalance = netCompensation - cashCompPaid
  const overheadPct          = annualGross > 0 ? businessExpenses / annualGross * 100 : 0
  const effectiveOverheadPct = (annualGross + otherIncome) > 0 ? businessExpenses / (annualGross + otherIncome) * 100 : 0
  const totalHours       = cashView
    ? cashStats.totalHours
    : yearStats.reduce((s, m) => s + m.totalHours, 0)
  const effectiveHourly  = totalHours > 0 ? totalComp / totalHours : 0

  const rec = currentRecord?.recurring ?? {}

  // ── JSX ───────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-8 max-w-3xl">

      {/* Header */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-100">Compensation</h2>
        <div className="flex items-center gap-2 ml-2">
          {years.slice(0, 3).map(y => (
            <button key={y} onClick={() => { setSelectedYear(y); setEditingCutoff(false) }}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                y === selectedYear ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}>{y}</button>
          ))}
          {years.length > 3 && (
            <select
              value={years.slice(3).includes(selectedYear) ? selectedYear : ''}
              onChange={e => { setSelectedYear(Number(e.target.value)); setEditingCutoff(false) }}
              className={`bg-gray-900 border rounded-md px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                years.slice(3).includes(selectedYear) ? 'border-indigo-600 text-white' : 'border-gray-700 text-gray-400'
              }`}
            >
              {!years.slice(3).includes(selectedYear) && <option value="" disabled>More…</option>}
              {years.slice(3).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Accrual / Cash toggle */}
      <div className="flex items-center gap-1 mb-4 p-0.5 bg-gray-900 border border-gray-800 rounded-lg w-fit">
        <button
          onClick={() => setCashView(false)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${!cashView ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
        >Accrual</button>
        <button
          onClick={() => setCashView(true)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${cashView ? 'bg-emerald-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
        >Cash</button>
      </div>

      {/* Basis info bar */}
      {!cashView ? (
        <div className="flex items-start gap-2 mb-5 px-3 py-2.5 rounded-lg bg-gray-800/50 border border-gray-700/50">
          <svg className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[11px] text-gray-500 leading-snug">
            Figures are <span className="text-gray-400">accrual-based</span> and tied to PCR billing periods, which may not align with calendar year cash payouts.
          </p>
        </div>
      ) : (
        <div className="mb-5 px-3 py-2.5 rounded-lg bg-emerald-950/40 border border-emerald-900/50 space-y-2">
          {/* Unit pay row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">Unit pay</span>
            {editingCutoff ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500">through</span>
                <input
                  type="date"
                  value={cutoffInput}
                  onChange={e => setCutoffInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveCutoff(); if (e.key === 'Escape') setEditingCutoff(false) }}
                  className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button onClick={saveCutoff} className="text-xs text-emerald-400 hover:text-emerald-300 font-medium">Save</button>
                <button onClick={() => setEditingCutoff(false)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                {settings.cashCutoffs?.[selectedYear] && (
                  <button
                    onClick={async () => {
                      const updated = { ...settings, cashCutoffs: { ...(settings.cashCutoffs ?? {}) } }
                      delete updated.cashCutoffs![selectedYear]
                      await saveSettings(updated)
                      setEditingCutoff(false)
                    }}
                    className="text-xs text-red-500 hover:text-red-400"
                  >Clear</button>
                )}
              </div>
            ) : (() => {
              const hasCustomCutoff = !!settings.cashCutoffs?.[selectedYear]
              const endYear = cashStats.unitPayEnd.slice(0, 4)
              const displayRange = `${formatDateShort(cashStats.unitPayStart)} – ${formatDateShort(cashStats.unitPayEnd)}, ${endYear}`
              return (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-emerald-300/80">{displayRange}</span>
                  {!hasCustomCutoff && (
                    <span className="text-[10px] text-gray-600">(standard)</span>
                  )}
                  <button
                    onClick={() => { setCutoffInput(settings.cashCutoffs?.[selectedYear] ?? ''); setEditingCutoff(true) }}
                    className="text-[10px] text-gray-500 hover:text-gray-300 underline underline-offset-2"
                  >edit</button>
                </div>
              )
            })()}
          </div>
          {/* Stipend row */}
          <div className="flex items-center gap-x-3">
            <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">Stipends</span>
            <span className="text-[11px] text-emerald-300/80">
              {formatMonthYear(selectedYear - 1, 12)} – {formatMonthYear(selectedYear, 11)}
            </span>
          </div>
        </div>
      )}

{/* Pie chart — Total Compensation breakdown */}
      {totalComp > 0 && (() => {
        const freeformBen = (currentRecord?.benefitsEntries ?? []).reduce((s, e) => s + e.amount, 0)
        const freeformRet = (currentRecord?.retirementEntries ?? []).reduce((s, e) => s + e.amount, 0)

        type Drill = 'benefits' | 'retirement' | 'netIncome' | 'cashReimbursements' | null
        interface PieSlice { label: string; value: number; hex: string; drill?: Drill }

        const freeformCash = (currentRecord?.cashCompEntries ?? []).reduce((s, e) => s + e.amount, 0)
        // Benicomp/CME/Business Meetings/Phone-Internet, broken out
        // individually -- one more level down from Cash Compensation's own
        // "Cash Reimbursements" slice.
        const cashReimbursementsSlices: PieSlice[] = [
          { label: 'Benicomp',          value: rec.healthBenicomp ?? 0,   hex: '#f472b6' },
          { label: 'CME',               value: rec.cme ?? 0,              hex: '#facc15' },
          { label: 'Business Meetings', value: rec.businessMeetings ?? 0, hex: '#a78bfa' },
          { label: 'Phone / Internet',  value: rec.phoneInternet ?? 0,    hex: '#f87171' },
          { label: 'Other',             value: freeformCash,              hex: '#94a3b8' },
        ].filter(d => d.value > 0)

        const topSlices: PieSlice[] = [
          { label: 'Cash Compensation', value: Math.max(netCompensation, 0), hex: '#818cf8', drill: 'netIncome' as Drill },
          { label: 'Benefits',   value: Math.max(benefitsTotal, 0),   hex: '#fb923c', drill: 'benefits'   as Drill },
          { label: 'Retirement', value: Math.max(retirementTotal, 0), hex: '#4ade80', drill: 'retirement' as Drill },
        ].filter(d => d.value > 0)

        // Splits "Cash Compensation" into what's actually been paid out --
        // Physician Salary (the PCR's own "MD Salaries" line) and Cash
        // Reimbursements (drills one level further into
        // cashReimbursementsSlices) -- plus the gap against the true total,
        // "Outstanding Salary Balance": the PCR's MD Salaries line is a
        // periodic draw that lags the physician's true earned pay, so this
        // can be negative (more drawn than earned so far) rather than
        // silently absorbed. Kept even when non-positive (unlike every other
        // slice here) so a real negative balance is never hidden.
        const netIncomeSlices: PieSlice[] = [
          { label: 'Physician Salary',   value: physicianSalary,          hex: '#818cf8' },
          { label: 'Cash Reimbursements', value: cashReimbursements,      hex: '#f472b6', drill: 'cashReimbursements' as Drill },
          { label: 'Outstanding Salary Balance', value: outstandingSalaryBalance, hex: '#fbbf24' },
        ].filter(d => d.value !== 0)

        // Benicomp/CME/Phone-Internet are deliberately excluded here -- they're
        // cash reimbursements now folded into Net Income (see benefitsTotal
        // above), so they're no longer part of what this Benefits total means.
        const benefitsSlices: PieSlice[] = [
          { label: 'Health Insurance',  value: (rec.healthDental ?? 0) + (rec.healthMedical ?? 0) + (rec.healthVision ?? 0), hex: '#38bdf8' },
          { label: 'Licenses & Dues',   value: rec.licensesDues ?? 0,    hex: '#a78bfa' },
          { label: 'Other',             value: freeformBen,               hex: '#94a3b8' },
        ].filter(d => d.value > 0)

        const retirementSlices: PieSlice[] = [
          { label: 'Profit Sharing',  value: rec.profitSharing ?? 0,  hex: '#4ade80' },
          { label: 'Cash Balance',    value: rec.cashBalance ?? 0,    hex: '#fb923c' },
          { label: 'Other',           value: freeformRet,              hex: '#94a3b8' },
        ].filter(d => d.value > 0)

        const activeSlices = pieDrill === 'benefits' ? benefitsSlices
          : pieDrill === 'retirement' ? retirementSlices
          : pieDrill === 'netIncome' ? netIncomeSlices
          : pieDrill === 'cashReimbursements' ? cashReimbursementsSlices
          : topSlices
        const total = activeSlices.reduce((s, d) => s + d.value, 0)
        // A pie wedge can't be negative (Outstanding Salary Balance can be)
        // -- floor just the drawn geometry so the circle still renders
        // sensibly, while the legend/total below keep the real signed value.
        const wedgeData = activeSlices.map(d => ({ ...d, value: Math.max(d.value, 0) }))
        const drillLabel: Record<NonNullable<Drill>, string> = {
          benefits: 'Benefits', retirement: 'Retirement', netIncome: 'Cash Compensation', cashReimbursements: 'Cash Reimbursements',
        }
        // Drilling into a slice nested under another drill (currently just
        // Cash Reimbursements, under Cash Compensation) should step back up
        // one level rather than all the way to the top -- everything else
        // still goes straight back to Overview, same as before.
        const parentDrill: Record<NonNullable<Drill>, Drill> = {
          benefits: null, retirement: null, netIncome: null, cashReimbursements: 'netIncome',
        }
        const totalLabel = pieDrill ? drillLabel[pieDrill] : 'Total Compensation'
        const totalColor = pieDrill === 'benefits' ? 'text-sky-400'
          : pieDrill === 'retirement' ? 'text-teal-400'
          : pieDrill === 'netIncome' ? 'text-indigo-400'
          : pieDrill === 'cashReimbursements' ? 'text-pink-400'
          : 'text-violet-400'

        return (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
            <button
              onClick={() => toggleSection('pieChart')}
              className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-gray-800/50 transition-colors"
            >
              <span className="text-sm font-semibold text-gray-300">Total Compensation Breakdown</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-violet-400">{formatCurrency(totalComp)}</span>
                <svg className={`w-4 h-4 text-gray-500 transition-transform ${openSections.pieChart ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {openSections.pieChart && (
            <div className="px-5 pb-5 pt-1 border-t border-gray-800/60">
            <div className="flex items-center gap-3 mb-4">
              {pieDrill && (
                <button onClick={() => setPieDrill(parentDrill[pieDrill])} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  {parentDrill[pieDrill] ? drillLabel[parentDrill[pieDrill]!] : 'Overview'}
                </button>
              )}
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                {pieDrill ? `${drillLabel[pieDrill]} Breakdown` : 'Total Compensation Breakdown'}
              </p>
            </div>
            <div className="flex flex-col md:flex-row items-center md:items-start gap-4 md:gap-6">
              <div className="w-full md:w-[180px] md:flex-shrink-0">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={wedgeData}
                      dataKey="value"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      strokeWidth={0}
                      onClick={(entry: { drill?: Drill }) => { if (entry.drill) setPieDrill(entry.drill) }}
                    >
                      {wedgeData.map(d => <Cell key={d.label} fill={d.hex} style={{ cursor: d.drill ? 'pointer' : 'default' }} />)}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: '12px' }}
                      itemStyle={{ color: '#d1d5db' }}
                      labelStyle={{ color: '#9ca3af' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full md:flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mb-3">
                  {activeSlices.map(({ label, value, hex, drill }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => { if (drill) setPieDrill(drill) }}
                      className={`flex items-center gap-2 text-left rounded px-1 -mx-1 py-0.5 transition-colors ${drill ? 'hover:bg-gray-800/60 cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                      <span className="text-xs text-gray-400 flex-1 truncate">{label}</span>
                      <span className={`text-xs font-semibold tabular-nums ${value < 0 ? 'text-red-400' : 'text-gray-300'}`}>{formatCurrency(value)}</span>
                      <span className="text-xs text-gray-600 tabular-nums w-9 text-right">{total > 0 ? (value / total * 100).toFixed(1) : '0.0'}%</span>
                    </button>
                  ))}
                </div>
                <div className="pt-2 border-t border-gray-800 flex items-center gap-2">
                  <span className="w-2 h-2 flex-shrink-0" />
                  <span className="text-xs text-gray-500 flex-1">{totalLabel}</span>
                  <span className={`text-xs font-bold tabular-nums ${totalColor}`}>{formatCurrency(pieDrill ? total : totalComp)}</span>
                  <span className="text-xs text-gray-600 w-9 text-right">100%</span>
                </div>
                {activeSlices.some(s => s.drill) && (
                  <p className="text-xs text-gray-700 mt-2">Click a slice or label to drill down</p>
                )}
              </div>
            </div>
            </div>
            )}
          </div>
        )
      })()}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
        {/* Total Gross Revenue — clinical + other income + reconciliation */}
        {(() => {
          const unitPay    = cashView ? cashStats.totalUnitPay : accrualUnitPay
          const stipends   = annualGross - unitPay
          const clinicalPlusOther = annualGross + otherIncome
          const unitPct    = clinicalPlusOther > 0 ? Math.max(0, Math.min(100, unitPay     / clinicalPlusOther * 100)) : 0
          const stipPct    = clinicalPlusOther > 0 ? Math.max(0, Math.min(100, stipends    / clinicalPlusOther * 100)) : 0
          const adminPct   = clinicalPlusOther > 0 ? Math.max(0, Math.min(100, otherIncome / clinicalPlusOther * 100)) : 0
          const netRecon   = carryforwardIn - yearEndBalance
          return (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Total Gross Revenue</p>
              <p className="text-lg font-bold text-emerald-400">{formatCurrency(totalGrossRevenue)}</p>
              {clinicalPlusOther > 0 && (
                <div className="relative mt-2.5 group/bar">
                  <div className="flex h-1.5 rounded-full overflow-hidden cursor-default">
                    <div className="bg-indigo-500"  style={{ width: `${unitPct}%`  }} />
                    <div className="bg-emerald-600" style={{ width: `${stipPct}%`  }} />
                    <div className="flex-1 bg-amber-500" />
                  </div>
                  <div className="absolute bottom-full left-0 mb-2 hidden group-hover/bar:block z-20 bg-gray-950 border border-gray-700 rounded-lg shadow-xl p-2.5 w-36 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                      <span className="text-[11px] text-gray-400 flex-1">Fees</span>
                      <span className="text-[11px] text-gray-300 tabular-nums">{unitPct.toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-600 flex-shrink-0" />
                      <span className="text-[11px] text-gray-400 flex-1">Stipends</span>
                      <span className="text-[11px] text-gray-300 tabular-nums">{stipPct.toFixed(0)}%</span>
                    </div>
                    {otherIncome > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                        <span className="text-[11px] text-gray-400 flex-1">Admin</span>
                        <span className="text-[11px] text-gray-300 tabular-nums">{adminPct.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {netRecon !== 0 && (
                <p className={`text-[10px] mt-1.5 tabular-nums ${netRecon > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {netRecon > 0 ? '+' : ''}{formatCurrency(netRecon)} reconciliation
                </p>
              )}
            </div>
          )
        })()}
        {/* Gross Clinical Revenue */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Gross Clinical Revenue</p>
          <p className="text-lg font-bold text-emerald-400">{formatCurrency(annualGross)}</p>
          {annualGross > 0 && (() => {
            const unitPay = cashView ? cashStats.totalUnitPay : accrualUnitPay
            const unitPct = Math.max(0, Math.min(100, unitPay / annualGross * 100))
            const stipPct = 100 - unitPct
            return (
              <div className="relative mt-2.5 group/bar">
                <div className="flex h-1.5 rounded-full overflow-hidden cursor-default">
                  <div className="bg-indigo-500" style={{ width: `${unitPct}%` }} />
                  <div className="flex-1 bg-emerald-600" />
                </div>
                <div className="absolute bottom-full left-0 mb-2 hidden group-hover/bar:block z-20 bg-gray-950 border border-gray-700 rounded-lg shadow-xl p-2.5 w-32 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                    <span className="text-[11px] text-gray-400 flex-1">Fees</span>
                    <span className="text-[11px] text-gray-300 tabular-nums">{unitPct.toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 flex-shrink-0" />
                    <span className="text-[11px] text-gray-400 flex-1">Stipends</span>
                    <span className="text-[11px] text-gray-300 tabular-nums">{stipPct.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Overhead</p>
          <p className="text-lg font-bold text-amber-400">{formatPct(overheadPct)}</p>
          {otherIncome > 0 && (
            <p className="text-[10px] text-gray-600 mt-1">{formatPct(effectiveOverheadPct)} effective w/ admin</p>
          )}
        </div>
        <div className="relative bg-gray-900 border border-gray-800 rounded-xl p-4 group">
          <p className="text-xs text-gray-500 mb-1">Business Expenses</p>
          <p className="text-lg font-bold text-red-400">{formatCurrency(businessExpenses)}</p>
          {businessExpenses > 0 && (
            <div className="absolute left-0 top-full mt-1.5 z-10 hidden group-hover:block w-52 bg-gray-950 border border-gray-700 rounded-xl shadow-xl p-3 space-y-1.5">
              {[
                { label: 'Operating Fee',  value: rec.operatingFee       ?? 0 },
                { label: 'Operating Exp',  value: rec.operatingExpense   ?? 0 },
                { label: 'Liability Ins.', value: rec.liabilityInsurance ?? 0 },
                { label: 'Payroll Taxes',  value: rec.payrollTaxes       ?? 0 },
              ].filter(r => r.value > 0).map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">{label}</span>
                  <span className="text-xs font-medium text-red-400 tabular-nums">{formatCurrency(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1">Effective Hourly Rate</p>
          <p className="text-lg font-bold text-violet-400">{effectiveHourly > 0 ? formatCurrency(effectiveHourly) : '—'}</p>
          {totalHours > 0 && (
            <p className="text-xs text-gray-600 mt-1">{totalHours.toFixed(0)} hrs</p>
          )}
        </div>
      </div>

{/* Revenues: Clinical + Non-clinical, visually paired under one parent */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
        <button
          onClick={() => toggleSection('revenues')}
          className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-gray-800/50 transition-colors"
        >
          <span className="text-sm font-semibold text-gray-300">Revenues</span>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-emerald-400">{formatCurrency(annualGross + otherIncome)}</span>
            <svg className={`w-4 h-4 text-gray-500 transition-transform ${openSections.revenues ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        {openSections.revenues && (
        <div className="border-t border-gray-800/60">

      {/* Clinical Revenues Breakdown */}
      {annualGross > 0 && (
        <div className="pl-4 pr-5 py-4 border-l-4 border-emerald-700">
          <button
            onClick={() => toggleSection('grossBreakdown')}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Clinical Revenues Breakdown</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cashView ? 'bg-emerald-900/50 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                {cashView ? 'Cash' : 'Accrual'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-emerald-400">{formatCurrency(annualGross)}</span>
              <svg className={`w-4 h-4 text-gray-500 transition-transform ${openSections.grossBreakdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
          {openSections.grossBreakdown && (
            <div className="pt-4 space-y-4">
              {/* Professional Fees */}
              <div className="pt-3">
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Professional Fees</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Unit-Based Pay</span>
                  <span className="text-sm font-semibold text-gray-200 tabular-nums">
                    {formatCurrency(cashView ? cashStats.totalUnitPay : accrualUnitPay)}
                  </span>
                </div>
              </div>
              <div className="border-t border-gray-800" />
              {/* Hospital Stipends */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Hospital Stipends</p>
                {stipendBreakdown.hospital.length === 0 ? (
                  <p className="text-sm text-gray-600 italic">No hospital stipend data</p>
                ) : (
                  <div className="space-y-1.5">
                    {stipendBreakdown.hospital.map(({ label, amount }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">{label}</span>
                        <span className="text-sm font-medium text-gray-300 tabular-nums">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                    <div className="pt-1.5 border-t border-gray-800 flex items-center justify-between">
                      <span className="text-sm text-gray-500">Total Hospital Stipends</span>
                      <span className="text-sm font-semibold text-gray-200 tabular-nums">
                        {formatCurrency(stipendBreakdown.hospital.reduce((s, c) => s + c.amount, 0))}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t border-gray-800" />
              {/* ASC Stipends */}
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">ASC Stipends</p>
                {stipendBreakdown.asc.length === 0 ? (
                  <p className="text-sm text-gray-600 italic">No ASC stipend data</p>
                ) : (
                  <div className="space-y-1.5">
                    {stipendBreakdown.asc.map(({ label, amount }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">{label}</span>
                        <span className="text-sm font-medium text-gray-300 tabular-nums">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                    <div className="pt-1.5 border-t border-gray-800 flex items-center justify-between">
                      <span className="text-sm text-gray-500">Total ASC Stipends</span>
                      <span className="text-sm font-semibold text-gray-200 tabular-nums">
                        {formatCurrency(stipendBreakdown.asc.reduce((s, c) => s + c.amount, 0))}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {/* Grand total */}
              {(stipendBreakdown.hospital.length > 0 || stipendBreakdown.asc.length > 0) && (
                <div className="border-t border-gray-700 pt-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-400">Total Stipends</span>
                  <span className="text-sm font-bold text-emerald-400 tabular-nums">
                    {formatCurrency(
                      [...stipendBreakdown.hospital, ...stipendBreakdown.asc].reduce((s, c) => s + c.amount, 0)
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {annualGross > 0 && <div className="border-t border-gray-800" />}

      {/* Non-clinical Revenues */}
      <div className="pl-4 pr-5 py-4 border-l-4 border-teal-700">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-sm font-semibold text-gray-300">Non-clinical Revenues</span>
            <span className="text-[11px] text-gray-600 ml-2">Administrative &amp; committee</span>
          </div>
          {otherIncome > 0 && (
            <span className="text-sm font-bold text-emerald-400 tabular-nums">{formatCurrency(otherIncome)}</span>
          )}
        </div>
          <EditableEntryList
            entries={currentRecord?.otherIncomeEntries ?? []}
            onAdd={(category, amount, note) => handleAddEntry('otherIncome', category, amount, note)}
            onUpdateAmount={(id, amount) => handleUpdateEntryAmount('otherIncome', id, amount)}
            onDelete={id => handleDeleteEntry('otherIncome', id)}
            datalistId="other-cats"
            datalistOptions={['QA Committee', 'Credentials Committee', 'Department Chief', 'Medical Directorship', 'Teaching / Education', 'Other']}
          />
      </div>

        </div>
        )}
      </div>

{/* Practice Reconciliation */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
        <button
          onClick={() => toggleSection('practiceRecon')}
          className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-gray-800/50 transition-colors"
        >
          <div>
            <span className="text-sm font-semibold text-gray-300">Practice Reconciliation</span>
            <span className="text-[11px] text-gray-600 ml-2">Year-end settlement adjustments</span>
          </div>
          <div className="flex items-center gap-3">
            {(carryforwardIn !== 0 || yearEndBalance !== 0) && (
              <span className={`text-sm font-bold tabular-nums ${carryforwardIn - yearEndBalance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {carryforwardIn - yearEndBalance >= 0 ? '+' : ''}{formatCurrency(carryforwardIn - yearEndBalance)}
              </span>
            )}
            <svg className={`w-4 h-4 text-gray-500 transition-transform ${openSections.practiceRecon ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        {openSections.practiceRecon && (
        <div className="pl-4 pr-5 py-4 border-t border-gray-800 border-l-4 border-sky-800 space-y-4">
          {/* Carryforward In */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-gray-400">Prior Year Carryforward</p>
              <p className="text-[11px] text-gray-600">Received from {selectedYear - 1} balance · positive = owed to you</p>
              {(() => {
                const suggested = prevYearRecord?.recurring?.['yearEndBalance']
                const currentVal = parseFloat(draft['carryforwardIn'] ?? '') || 0
                if (suggested != null && suggested !== 0 && currentVal === 0) {
                  return (
                    <button
                      onClick={() => {
                        setDraft(d => ({ ...d, carryforwardIn: String(suggested) }))
                        setTimeout(() => handleBlur('carryforwardIn'), 0)
                      }}
                      className="text-[11px] text-sky-500 hover:text-sky-400 mt-0.5"
                    >
                      Pre-fill from {selectedYear - 1} year-end: {formatCurrency(suggested)}
                    </button>
                  )
                }
                return null
              })()}
            </div>
            <AmountInput
              value={draft['carryforwardIn'] ?? ''}
              onChange={v => setDraft(d => ({ ...d, carryforwardIn: v }))}
              onBlur={() => handleBlur('carryforwardIn')}
            />
          </div>
          <div className="border-t border-gray-800" />
          {/* Year-End Balance */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-gray-400">Year-End Balance</p>
              <p className="text-[11px] text-gray-600">Deferred to {selectedYear + 1} · positive = practice owes you</p>
            </div>
            <AmountInput
              value={draft['yearEndBalance'] ?? ''}
              onChange={v => setDraft(d => ({ ...d, yearEndBalance: v }))}
              onBlur={() => handleBlur('yearEndBalance')}
            />
          </div>
        </div>
        )}
      </div>

      {/* Expense form */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <button onClick={() => toggleSection('expenses')} className="flex items-center gap-2 min-w-0 text-left">
            <svg className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${openSections.expenses ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-300 truncate">PCR Breakdown</h3>
            <span className="text-[11px] text-gray-600 flex-shrink-0 hidden sm:inline">{selectedYear}</span>
          </button>
          <button
            onClick={() => { setPcrSyncPreview(buildPcrSyncPreview()); setOpenSections(o => ({ ...o, expenses: true })) }}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium border border-indigo-800 rounded-md px-3 py-1.5 hover:bg-indigo-900/30 transition-colors flex-shrink-0"
          >
            Sync from PCR
          </button>
        </div>

        {openSections.expenses && (
        <div className="border-t border-gray-800">
          <p className="px-5 pt-3 text-[11px] text-gray-500 leading-snug">
            Cash Compensation, Business Expenses, Benefits, and Retirement Benefits — editable by hand or synced
            from the PCR income statement. Together these four sections should sum to Total Gross Revenue above,
            and they drive every other total on this page (Total Compensation, Overhead, and the pie chart above).
          </p>

        {pcrSyncPreview && (
          <div className="px-5 py-4 border-b border-gray-800 bg-gray-800/40 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-amber-300">PCR Expense Sync — {selectedYear}</p>
              <button onClick={() => setPcrSyncPreview(null)} className="text-gray-600 hover:text-gray-400 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {pcrSyncPreview.changes.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {pcrIncomeStatements.some(s => s.year === selectedYear)
                  ? 'Already up to date with the PCR.'
                  : `No PCR income-statement data found for ${selectedYear}.`}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div />
                  <div className="text-center font-semibold text-gray-500 uppercase tracking-wider">Current</div>
                  <div className="text-center font-semibold text-gray-500 uppercase tracking-wider">From PCR</div>
                  {pcrSyncPreview.changes.map(c => (
                    <Fragment key={`${c.section}:${c.key}`}>
                      <div className="text-gray-400 flex items-center gap-1.5">
                        {c.label}
                        {c.section === 'otherIncome' && (
                          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Other Income</span>
                        )}
                      </div>
                      <div className="text-center text-gray-500 tabular-nums">{formatCurrency(c.current)}</div>
                      <div className="text-center font-medium text-amber-300 tabular-nums">{formatCurrency(c.proposed)}</div>
                    </Fragment>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={applyPcrSync}
                    disabled={pcrSyncing}
                    className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
                  >
                    {pcrSyncing ? 'Applying…' : `Apply ${pcrSyncPreview.changes.length} change${pcrSyncPreview.changes.length !== 1 ? 's' : ''}`}
                  </button>
                  <button onClick={() => setPcrSyncPreview(null)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                    Cancel
                  </button>
                </div>
              </>
            )}

            {pcrSyncPreview.unmappedLabels.length > 0 && (
              <div className="pt-2 border-t border-gray-800">
                <p className="text-xs text-gray-400">
                  <span className="text-gray-300 font-medium">
                    {pcrSyncPreview.unmappedLabels.length} unmapped PCR label{pcrSyncPreview.unmappedLabels.length !== 1 ? 's' : ''}
                  </span>
                  {' '}excluded — configure a mapping in{' '}
                  <button
                    onClick={() => navigate('/settings/pcr-category-mapping')}
                    className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >
                    PCR Category Mapping
                  </button>.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {pcrSyncPreview.unmappedLabels.map(l => (
                    <span key={l} className="px-1.5 py-0.5 rounded bg-gray-900 border border-gray-700 text-gray-500 font-mono text-[10px]">
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {pcrSyncPreview.needsHomeLabels.length > 0 && (
              <div className="pt-2 border-t border-gray-800">
                <p className="text-xs text-gray-400">
                  <span className="text-gray-300 font-medium">
                    {pcrSyncPreview.needsHomeLabels.length} categor{pcrSyncPreview.needsHomeLabels.length !== 1 ? 'ies need' : 'y needs'} a home
                  </span>
                  {' '}— mapped, but never added anywhere yet. Add it once via any section's "Add" form below (Cash Compensation,
                  Business Expenses, Benefits, or Retirement) and it'll sync automatically from then on.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {pcrSyncPreview.needsHomeLabels.map(({ pcrLabel, category }) => (
                    <span key={pcrLabel} className="flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded bg-gray-900 border border-gray-700 text-gray-500 font-mono text-[10px]">
                      {category}
                      <span className="text-gray-700 font-sans">({pcrLabel})</span>
                      <button
                        onClick={() => dismissNeedsHomeLabel(pcrLabel)}
                        className="text-gray-700 hover:text-red-400 transition-colors leading-none"
                        title="Dismiss this reminder"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {pcrSyncPreview.categoriesWithoutMapping.length > 0 && (
              <div className="pt-2 border-t border-gray-800">
                <p className="text-xs text-gray-400">
                  <span className="text-gray-300 font-medium">
                    {pcrSyncPreview.categoriesWithoutMapping.length} categor{pcrSyncPreview.categoriesWithoutMapping.length !== 1 ? 'ies have' : 'y has'} no PCR mapping
                  </span>
                  {' '}— created below, but nothing currently maps a PCR label to {pcrSyncPreview.categoriesWithoutMapping.length !== 1 ? 'them' : 'it'}. Set one up in{' '}
                  <button
                    onClick={() => navigate('/settings/pcr-category-mapping')}
                    className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >
                    PCR Category Mapping
                  </button>
                  {' '}if it should sync automatically, or dismiss if it's meant to stay hand-managed.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {pcrSyncPreview.categoriesWithoutMapping.map((category) => (
                    <span key={category} className="flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded bg-gray-900 border border-gray-700 text-gray-500 font-mono text-[10px]">
                      {category}
                      <button
                        onClick={() => dismissUnmappedCategory(category)}
                        className="text-gray-700 hover:text-red-400 transition-colors leading-none"
                        title="Dismiss this reminder"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div>

          {/* ── Cash Compensation ── */}
          <div className="pl-4 pr-5 py-4 border-l-4 border-indigo-700">
            <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-400 mb-3">Cash Compensation</span>

            {/* Physician Salary */}
            <div className="space-y-2 mb-4">
              {CASH_COMP_LEAVES.filter(l => !l.subGroup).map(leaf => (
                <div key={leaf.key} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-400">{leaf.label}</span>
                  <AmountInput
                    value={draft[leaf.key] ?? ''}
                    onChange={v => setDraft(d => ({ ...d, [leaf.key]: v }))}
                    onBlur={() => handleBlur(leaf.key)}
                  />
                </div>
              ))}
            </div>

            {/* Cash Reimbursements sub-group */}
            <div className="mb-3">
              <p className="text-xs text-gray-600 mb-2">Cash Reimbursements</p>
              <div className="space-y-2 pl-3 border-l border-gray-800 mb-3">
                {CASH_COMP_LEAVES.filter(l => l.subGroup).map(leaf => (
                  <div key={leaf.key} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-400">{leaf.label}</span>
                    <AmountInput
                      value={draft[leaf.key] ?? ''}
                      onChange={v => setDraft(d => ({ ...d, [leaf.key]: v }))}
                      onBlur={() => handleBlur(leaf.key)}
                    />
                  </div>
                ))}
                <EditableEntryList
                  entries={currentRecord?.cashCompEntries ?? []}
                  onAdd={(category, amount, note) => handleAddEntry('cashComp', category, amount, note)}
                  onUpdateAmount={(id, amount) => handleUpdateEntryAmount('cashComp', id, amount)}
                  onDelete={id => handleDeleteEntry('cashComp', id)}
                  datalistId="cash-cats"
                  datalistOptions={['Auto Allowance', 'Uniform Allowance', 'Other']}
                />
              </div>
            </div>

            {/* Computed: gap between what's been paid (Salary + Cash
                Reimbursements) and the true Cash Compensation total for the
                year -- can be negative if more has been drawn as salary than
                earned so far. Not editable; it's a plug, not an entry. */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-800">
              <div>
                <span className="text-sm text-gray-400">Outstanding Salary Balance</span>
                <p className="text-[11px] text-gray-600">True-up owed once the PCR closes out for the year</p>
              </div>
              <span className={`text-sm font-semibold tabular-nums ${outstandingSalaryBalance < 0 ? 'text-red-400' : 'text-gray-200'}`}>
                {formatCurrency(outstandingSalaryBalance)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-800">
              <span className="text-sm text-gray-500">Cash Compensation Total</span>
              <span className="text-sm font-bold text-indigo-400 tabular-nums">{formatCurrency(netCompensation)}</span>
            </div>
          </div>

          {/* ── Business Expenses ── */}
          <div className="pl-4 pr-5 py-4 border-t border-gray-800 border-l-4 border-red-700">
            <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-950 text-red-400 mb-3">Business Expenses</span>
            <div className="space-y-2 mb-4">
              {BUSINESS_LEAVES.map(leaf => (
                <div key={leaf.key} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-400">{leaf.label}</span>
                  <AmountInput
                    value={draft[leaf.key] ?? ''}
                    onChange={v => setDraft(d => ({ ...d, [leaf.key]: v }))}
                    onBlur={() => handleBlur(leaf.key)}
                  />
                </div>
              ))}
            </div>
            <EditableEntryList
              entries={currentRecord?.entries ?? []}
              onAdd={(category, amount, note) => handleAddEntry('business', category, amount, note)}
              onUpdateAmount={(id, amount) => handleUpdateEntryAmount('business', id, amount)}
              onDelete={id => handleDeleteEntry('business', id)}
              datalistId="biz-cats"
              datalistOptions={['Accounting & Legal', 'Office & Subscriptions', 'Business Travel', 'Medical Equipment', 'Other']}
            />
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-800">
              <span className="text-sm text-gray-500">Business Expenses Total</span>
              <span className="text-sm font-bold text-red-400 tabular-nums">{formatCurrency(businessExpenses)}</span>
            </div>
          </div>

          {/* ── Benefits ── */}
          <div className="pl-4 pr-5 py-4 border-t border-gray-800 border-l-4 border-orange-700">
            <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-orange-950 text-orange-400 mb-3">Benefits</span>

            {/* Health Insurance sub-group */}
            <div className="mb-3">
              <p className="text-xs text-gray-600 mb-2">Health Insurance</p>
              <div className="space-y-2 pl-3 border-l border-gray-800">
                {BENEFITS_LEAVES.filter(l => l.subGroup).map(leaf => (
                  <div key={leaf.key} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-400">{leaf.label}</span>
                    <AmountInput
                      value={draft[leaf.key] ?? ''}
                      onChange={v => setDraft(d => ({ ...d, [leaf.key]: v }))}
                      onBlur={() => handleBlur(leaf.key)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Other benefits */}
            <div className="space-y-2 mb-4">
              {BENEFITS_LEAVES.filter(l => !l.subGroup).map(leaf => (
                <div key={leaf.key} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-400">{leaf.label}</span>
                  <AmountInput
                    value={draft[leaf.key] ?? ''}
                    onChange={v => setDraft(d => ({ ...d, [leaf.key]: v }))}
                    onBlur={() => handleBlur(leaf.key)}
                  />
                </div>
              ))}
            </div>

            <EditableEntryList
              entries={currentRecord?.benefitsEntries ?? []}
              onAdd={(category, amount, note) => handleAddEntry('benefits', category, amount, note)}
              onUpdateAmount={(id, amount) => handleUpdateEntryAmount('benefits', id, amount)}
              onDelete={id => handleDeleteEntry('benefits', id)}
              datalistId="ben-cats"
              datalistOptions={['Medical Licensing & DEA', 'Professional Dues', 'Conference Registration', 'Other']}
            />
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-800">
              <span className="text-sm text-gray-500">Benefits Total</span>
              <span className="text-sm font-bold text-sky-400 tabular-nums">{formatCurrency(benefitsTotal)}</span>
            </div>
          </div>

          {/* ── Retirement Benefits ── */}
          <div className="pl-4 pr-5 py-4 border-t border-gray-800 border-l-4 border-green-700">
            <span className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-950 text-green-400 mb-3">Retirement Benefits</span>
            <div className="space-y-2 mb-4">
              {RETIREMENT_LEAVES.map(leaf => (
                <div key={leaf.key} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-400">{leaf.label}</span>
                  <AmountInput
                    value={draft[leaf.key] ?? ''}
                    onChange={v => setDraft(d => ({ ...d, [leaf.key]: v }))}
                    onBlur={() => handleBlur(leaf.key)}
                  />
                </div>
              ))}
            </div>
            <EditableEntryList
              entries={currentRecord?.retirementEntries ?? []}
              onAdd={(category, amount, note) => handleAddEntry('retirement', category, amount, note)}
              onUpdateAmount={(id, amount) => handleUpdateEntryAmount('retirement', id, amount)}
              onDelete={id => handleDeleteEntry('retirement', id)}
              datalistId="ret-cats"
              datalistOptions={['IRA Contribution', 'HSA Contribution', 'Other']}
            />
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-800">
              <span className="text-sm text-gray-500">Retirement Total</span>
              <span className="text-sm font-bold text-teal-400 tabular-nums">{formatCurrency(retirementTotal)}</span>
            </div>
          </div>

        </div>
        </div>
        )}
      </div>
    </div>
  )
}
