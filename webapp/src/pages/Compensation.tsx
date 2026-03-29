import { useState, useMemo, useEffect, useRef } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useData } from '../context/DataContext'
import { computeCalendarYearStats, computeCashYearStats, computeCalendarMonthStats, getStipendForDay, getApplicableMapping } from '../utils/calculations'
import { formatCurrency, formatMonthYear, formatDateShort, randomId } from '../utils/dateUtils'
import { resolveShiftAlias } from '../utils/shiftUtils'
import type { ExpenseEntry, AnnualExpenses } from '../types'

// ─── Category definitions ──────────────────────────────────────────────────────

type Leaf = { key: string; label: string }
type BenefitsLeaf = Leaf & { subGroup?: string }

const BUSINESS_LEAVES: Leaf[] = [
  { key: 'operatingFee',       label: 'Operating Fee (7%)'    },
  { key: 'developmentReserve', label: 'Development Fee (10%)' },
  { key: 'operatingExpense',   label: 'Operating Expense'     },
  { key: 'payrollTaxes',       label: 'Payroll Taxes'         },
  { key: 'liabilityInsurance', label: 'Liability Insurance'   },
]

const BENEFITS_LEAVES: BenefitsLeaf[] = [
  { key: 'healthDental',   label: 'Dental',           subGroup: 'Health Insurance' },
  { key: 'healthMedical',  label: 'Medical',          subGroup: 'Health Insurance' },
  { key: 'healthVision',   label: 'Vision',           subGroup: 'Health Insurance' },
  { key: 'healthBenicomp', label: 'Benicomp',         subGroup: 'Health Insurance' },
  { key: 'licensesDues',  label: 'Licenses & Dues'  },
  { key: 'cme',           label: 'CME'              },
  { key: 'phoneInternet', label: 'Phone / Internet' },
]

const RETIREMENT_LEAVES: Leaf[] = [
  { key: 'profitSharing', label: 'Profit Sharing' },
  { key: 'cashBalance',   label: 'Cash Balance'   },
]

const BUSINESS_KEYS    = new Set(BUSINESS_LEAVES.map(l => l.key))
const BENEFITS_KEYS    = new Set(BENEFITS_LEAVES.map(l => l.key))
const RETIREMENT_KEYS  = new Set(RETIREMENT_LEAVES.map(l => l.key))
const HEALTHCARE_KEYS  = new Set(['healthDental', 'healthMedical', 'healthVision', 'healthBenicomp'])
const ACTIVE_KEYS      = new Set([...BUSINESS_KEYS, ...BENEFITS_KEYS, ...RETIREMENT_KEYS])
const ALL_LEAVES       = [...BUSINESS_LEAVES, ...BENEFITS_LEAVES, ...RETIREMENT_LEAVES]

type Section = 'business' | 'benefits' | 'retirement' | 'otherIncome'

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

function EntryList({ entries, onDelete }: { entries: ExpenseEntry[]; onDelete: (id: string) => void }) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  if (entries.length === 0) return null
  return (
    <div className="space-y-1.5 mb-3">
      {entries.map(entry => (
        <div key={entry.id} className="flex items-center gap-3">
          <span className="text-sm text-gray-400 flex-1">{entry.category}</span>
          {entry.note && <span className="text-xs text-gray-600 truncate max-w-[160px]">{entry.note}</span>}
          <span className="text-sm font-semibold text-gray-300 tabular-nums">{formatCurrency(entry.amount)}</span>
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
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Compensation() {
  const { reports, schedules, settings, stipendMappings, annualExpenses, saveAnnualExpenses, deleteAnnualExpenses, saveSettings } = useData()

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
  const draftKey = useRef<string>('')
  const [pieDrill, setPieDrill] = useState<'benefits' | 'retirement' | null>(null)
  const [grossBreakdownOpen, setGrossBreakdownOpen] = useState(true)

  const [bizCat, setBizCat] = useState(''); const [bizAmt, setBizAmt] = useState(''); const [bizNote, setBizNote] = useState('')
  const [benCat, setBenCat] = useState(''); const [benAmt, setBenAmt] = useState(''); const [benNote, setBenNote] = useState('')
  const [retCat, setRetCat] = useState(''); const [retAmt, setRetAmt] = useState(''); const [retNote, setRetNote] = useState('')
  const [otherCat, setOtherCat] = useState(''); const [otherAmt, setOtherAmt] = useState(''); const [otherNote, setOtherNote] = useState('')

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

        if (day.additionalStipend > 0) {
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
    const updatedRecurring = Object.fromEntries(Object.entries(merged).filter(([k]) => ACTIVE_KEYS.has(k)))
    const updated = { ...record, recurring: updatedRecurring }
    if (!hasAnything(updated) && currentRecord) {
      await deleteAnnualExpenses(updated.id)
    } else if (hasAnything(updated)) {
      await saveAnnualExpenses(updated)
    }
  }

  async function handleAddBiz() {
    const amt = parseFloat(bizAmt)
    if (!bizCat.trim() || isNaN(amt) || amt === 0) return
    const record = getOrCreate()
    const entry: ExpenseEntry = { id: randomId(), category: bizCat.trim(), amount: amt, note: bizNote.trim() || undefined }
    await saveAnnualExpenses({ ...record, entries: [...(record.entries ?? []), entry] })
    setBizCat(''); setBizAmt(''); setBizNote('')
  }

  async function handleAddBen() {
    const amt = parseFloat(benAmt)
    if (!benCat.trim() || isNaN(amt) || amt === 0) return
    const record = getOrCreate()
    const entry: ExpenseEntry = { id: randomId(), category: benCat.trim(), amount: amt, note: benNote.trim() || undefined }
    await saveAnnualExpenses({ ...record, benefitsEntries: [...(record.benefitsEntries ?? []), entry] })
    setBenCat(''); setBenAmt(''); setBenNote('')
  }

  async function handleAddRet() {
    const amt = parseFloat(retAmt)
    if (!retCat.trim() || isNaN(amt) || amt === 0) return
    const record = getOrCreate()
    const entry: ExpenseEntry = { id: randomId(), category: retCat.trim(), amount: amt, note: retNote.trim() || undefined }
    await saveAnnualExpenses({ ...record, retirementEntries: [...(record.retirementEntries ?? []), entry] })
    setRetCat(''); setRetAmt(''); setRetNote('')
  }

  async function handleAddOther() {
    const amt = parseFloat(otherAmt)
    if (!otherCat.trim() || isNaN(amt) || amt === 0) return
    const record = getOrCreate()
    const entry: ExpenseEntry = { id: randomId(), category: otherCat.trim(), amount: amt, note: otherNote.trim() || undefined }
    await saveAnnualExpenses({ ...record, otherIncomeEntries: [...(record.otherIncomeEntries ?? []), entry] })
    setOtherCat(''); setOtherAmt(''); setOtherNote('')
  }

  async function handleDeleteEntry(section: Section, entryId: string) {
    const record = getOrCreate()
    let updated: AnnualExpenses
    if (section === 'business') {
      updated = { ...record, entries: (record.entries ?? []).filter(e => e.id !== entryId) }
    } else if (section === 'benefits') {
      updated = { ...record, benefitsEntries: (record.benefitsEntries ?? []).filter(e => e.id !== entryId) }
    } else if (section === 'retirement') {
      updated = { ...record, retirementEntries: (record.retirementEntries ?? []).filter(e => e.id !== entryId) }
    } else {
      updated = { ...record, otherIncomeEntries: (record.otherIncomeEntries ?? []).filter(e => e.id !== entryId) }
    }
    if (!hasAnything(updated)) await deleteAnnualExpenses(updated.id)
    else await saveAnnualExpenses(updated)
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
  const netIncome            = annualGross - businessExpenses - benefitsTotal - retirementTotal
  const totalComp            = netIncome + otherIncome + benefitsTotal + retirementTotal
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

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
        {/* Total Gross Revenue — clinical + other income */}
        {(() => {
          const unitPay    = cashView ? cashStats.totalUnitPay : accrualUnitPay
          const stipends   = annualGross - unitPay
          const totalGross = annualGross + otherIncome
          const unitPct    = totalGross > 0 ? Math.max(0, Math.min(100, unitPay    / totalGross * 100)) : 0
          const stipPct    = totalGross > 0 ? Math.max(0, Math.min(100, stipends   / totalGross * 100)) : 0
          const adminPct   = totalGross > 0 ? Math.max(0, Math.min(100, otherIncome / totalGross * 100)) : 0
          return (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Total Gross Revenue</p>
              <p className="text-lg font-bold text-emerald-400">{formatCurrency(totalGross)}</p>
              {totalGross > 0 && (
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

{/* Gross Revenue Breakdown */}
      {annualGross > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl mb-6 overflow-hidden">
          <button
            onClick={() => setGrossBreakdownOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Gross Revenue Breakdown</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cashView ? 'bg-emerald-900/50 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                {cashView ? 'Cash' : 'Accrual'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-emerald-400">{formatCurrency(annualGross)}</span>
              <svg className={`w-4 h-4 text-gray-500 transition-transform ${grossBreakdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
          {grossBreakdownOpen && (
            <div className="px-5 pb-5 pt-1 space-y-4 border-t border-gray-800/60">
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

{/* Other Income */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-gray-300">Other Income</span>
            <span className="text-[11px] text-gray-600 ml-2">Administrative &amp; committee</span>
          </div>
          {otherIncome > 0 && (
            <span className="text-sm font-bold text-emerald-400 tabular-nums">{formatCurrency(otherIncome)}</span>
          )}
        </div>
        <div className="pl-4 pr-5 py-4 border-l-4 border-emerald-800">
          <EntryList entries={currentRecord?.otherIncomeEntries ?? []} onDelete={id => handleDeleteEntry('otherIncome', id)} />
          <div className="flex flex-wrap items-end gap-2 pt-2">
            <div className="flex-1 min-w-[130px]">
              <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Source</label>
              <input
                list="other-cats"
                value={otherCat} onChange={e => setOtherCat(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddOther() }}
                placeholder="Description"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <datalist id="other-cats">{['QA Committee','Credentials Committee','Department Chief','Medical Directorship','Teaching / Education','Other'].map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div className="w-28">
              <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Amount</label>
              <input type="number" step="1" value={otherAmt} onChange={e => setOtherAmt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddOther() }} placeholder="0" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <div className="flex-1 min-w-[90px]">
              <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Note</label>
              <input value={otherNote} onChange={e => setOtherNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddOther() }} placeholder="optional" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <button onClick={handleAddOther} disabled={!otherCat.trim() || !otherAmt} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">Add</button>
          </div>
        </div>
      </div>

{/* Pie chart — Total Compensation breakdown */}
      {totalComp > 0 && (() => {
        const freeformBen = (currentRecord?.benefitsEntries ?? []).reduce((s, e) => s + e.amount, 0)
        const freeformRet = (currentRecord?.retirementEntries ?? []).reduce((s, e) => s + e.amount, 0)

        type Drill = 'benefits' | 'retirement' | null
        const topSlices = [
          { label: otherIncome > 0 ? 'Net + Admin Income' : 'Net Income', value: Math.max(netIncome + otherIncome, 0), hex: '#818cf8', drill: null as Drill },
          { label: 'Benefits',   value: Math.max(benefitsTotal, 0),   hex: '#fb923c', drill: 'benefits'   as Drill },
          { label: 'Retirement', value: Math.max(retirementTotal, 0), hex: '#4ade80', drill: 'retirement' as Drill },
        ].filter(d => d.value > 0)

        const benefitsSlices = [
          { label: 'Health Insurance',  value: (rec.healthDental ?? 0) + (rec.healthMedical ?? 0) + (rec.healthVision ?? 0), hex: '#38bdf8' },
          { label: 'Benicomp',          value: rec.healthBenicomp ?? 0,  hex: '#f472b6' },
          { label: 'Licenses & Dues',   value: rec.licensesDues ?? 0,    hex: '#a78bfa' },
          { label: 'CME',               value: rec.cme ?? 0,             hex: '#facc15' },
          { label: 'Phone / Internet',  value: rec.phoneInternet ?? 0,   hex: '#f87171' },
          { label: 'Other',             value: freeformBen,               hex: '#94a3b8' },
        ].filter(d => d.value > 0)

        const retirementSlices = [
          { label: 'Profit Sharing',  value: rec.profitSharing ?? 0,  hex: '#4ade80' },
          { label: 'Cash Balance',    value: rec.cashBalance ?? 0,    hex: '#fb923c' },
          { label: 'Other',           value: freeformRet,              hex: '#94a3b8' },
        ].filter(d => d.value > 0)

        const activeSlices = pieDrill === 'benefits' ? benefitsSlices
          : pieDrill === 'retirement' ? retirementSlices
          : topSlices
        const total = activeSlices.reduce((s, d) => s + d.value, 0)
        const drillLabel: Record<NonNullable<Drill>, string> = { benefits: 'Benefits', retirement: 'Retirement' }
        const totalLabel = pieDrill ? drillLabel[pieDrill] : 'Total Compensation'
        const totalColor = pieDrill === 'benefits' ? 'text-sky-400' : pieDrill === 'retirement' ? 'text-teal-400' : 'text-violet-400'

        return (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
            <div className="flex items-center gap-3 mb-4">
              {pieDrill && (
                <button onClick={() => setPieDrill(null)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Overview
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
                      data={activeSlices}
                      dataKey="value"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      strokeWidth={0}
                      onClick={(entry: { drill?: Drill }) => { if (entry.drill) setPieDrill(entry.drill) }}
                      style={{ cursor: pieDrill ? 'default' : 'pointer' }}
                    >
                      {activeSlices.map(d => <Cell key={d.label} fill={d.hex} />)}
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
                  {activeSlices.map(({ label, value, hex }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                      <span className="text-xs text-gray-400 flex-1 truncate">{label}</span>
                      <span className="text-xs font-semibold text-gray-300 tabular-nums">{formatCurrency(value)}</span>
                      <span className="text-xs text-gray-600 tabular-nums w-9 text-right">{total > 0 ? (value / total * 100).toFixed(1) : '0.0'}%</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-gray-800 flex items-center gap-2">
                  <span className="w-2 h-2 flex-shrink-0" />
                  <span className="text-xs text-gray-500 flex-1">{totalLabel}</span>
                  <span className={`text-xs font-bold tabular-nums ${totalColor}`}>{formatCurrency(pieDrill ? total : totalComp)}</span>
                  <span className="text-xs text-gray-600 w-9 text-right">100%</span>
                </div>
                {!pieDrill && benefitsTotal + retirementTotal > 0 && (
                  <p className="text-xs text-gray-700 mt-2">Click Benefits or Retirement to drill down</p>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Expense form */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300">{selectedYear} Expenses</h3>
        </div>

        <div>

          {/* ── Business Expenses ── */}
          <div className="pl-4 pr-5 py-4 border-l-4 border-red-700">
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
            <EntryList entries={currentRecord?.entries ?? []} onDelete={id => handleDeleteEntry('business', id)} />
            <div className="flex flex-wrap items-end gap-2 pt-2">
              <div className="flex-1 min-w-[130px]">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Category</label>
                <input list="biz-cats" value={bizCat} onChange={e => setBizCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddBiz() }} placeholder="Description" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <datalist id="biz-cats">{['Accounting & Legal','Office & Subscriptions','Business Travel','Medical Equipment','Other'].map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="w-28">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Amount</label>
                <input type="number" step="1" value={bizAmt} onChange={e => setBizAmt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddBiz() }} placeholder="0" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div className="flex-1 min-w-[90px]">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Note</label>
                <input value={bizNote} onChange={e => setBizNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddBiz() }} placeholder="optional" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <button onClick={handleAddBiz} disabled={!bizCat.trim() || !bizAmt} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">Add</button>
            </div>
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

            <EntryList entries={currentRecord?.benefitsEntries ?? []} onDelete={id => handleDeleteEntry('benefits', id)} />
            <div className="flex flex-wrap items-end gap-2 pt-2">
              <div className="flex-1 min-w-[130px]">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Category</label>
                <input list="ben-cats" value={benCat} onChange={e => setBenCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddBen() }} placeholder="Description" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <datalist id="ben-cats">{['Medical Licensing & DEA','Professional Dues','Conference Registration','Other'].map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="w-28">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Amount</label>
                <input type="number" step="1" value={benAmt} onChange={e => setBenAmt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddBen() }} placeholder="0" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div className="flex-1 min-w-[90px]">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Note</label>
                <input value={benNote} onChange={e => setBenNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddBen() }} placeholder="optional" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <button onClick={handleAddBen} disabled={!benCat.trim() || !benAmt} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">Add</button>
            </div>
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
            <EntryList entries={currentRecord?.retirementEntries ?? []} onDelete={id => handleDeleteEntry('retirement', id)} />
            <div className="flex flex-wrap items-end gap-2 pt-2">
              <div className="flex-1 min-w-[130px]">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Category</label>
                <input list="ret-cats" value={retCat} onChange={e => setRetCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddRet() }} placeholder="Description" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <datalist id="ret-cats">{['IRA Contribution','HSA Contribution','Other'].map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="w-28">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Amount</label>
                <input type="number" step="1" value={retAmt} onChange={e => setRetAmt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddRet() }} placeholder="0" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div className="flex-1 min-w-[90px]">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Note</label>
                <input value={retNote} onChange={e => setRetNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddRet() }} placeholder="optional" className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <button onClick={handleAddRet} disabled={!retCat.trim() || !retAmt} className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">Add</button>
            </div>
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-800">
              <span className="text-sm text-gray-500">Retirement Total</span>
              <span className="text-sm font-bold text-teal-400 tabular-nums">{formatCurrency(retirementTotal)}</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
