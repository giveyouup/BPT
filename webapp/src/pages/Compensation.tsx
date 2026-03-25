import { useState, useMemo, useEffect, useRef } from 'react'
import { useData } from '../context/DataContext'
import { computeCalendarYearStats } from '../utils/calculations'
import { formatCurrency } from '../utils/dateUtils'
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
  { key: 'healthDental',  label: 'Dental',           subGroup: 'Health Insurance' },
  { key: 'healthMedical', label: 'Medical',          subGroup: 'Health Insurance' },
  { key: 'healthVision',  label: 'Vision',           subGroup: 'Health Insurance' },
  { key: 'licensesDues',  label: 'Licenses & Dues'  },
  { key: 'cme',           label: 'CME'              },
  { key: 'phoneInternet', label: 'Phone / Internet' },
]

const RETIREMENT_LEAVES: Leaf[] = [
  { key: 'profitSharing', label: 'Profit Sharing' },
  { key: 'cashBalance',   label: 'Cash Balance'   },
]

const BUSINESS_KEYS   = new Set(BUSINESS_LEAVES.map(l => l.key))
const BENEFITS_KEYS   = new Set(BENEFITS_LEAVES.map(l => l.key))
const RETIREMENT_KEYS = new Set(RETIREMENT_LEAVES.map(l => l.key))
const ACTIVE_KEYS     = new Set([...BUSINESS_KEYS, ...BENEFITS_KEYS, ...RETIREMENT_KEYS])
const ALL_LEAVES      = [...BUSINESS_LEAVES, ...BENEFITS_LEAVES, ...RETIREMENT_LEAVES]

type Section = 'business' | 'benefits' | 'retirement'
const SECTION_ENTRY_FIELD: Record<Section, keyof AnnualExpenses> = {
  business:   'entries',
  benefits:   'benefitsEntries',
  retirement: 'retirementEntries',
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

interface EntryFormProps {
  entries: ExpenseEntry[]
  form: { cat: string; amt: string; note: string }
  onFormChange: (field: 'cat' | 'amt' | 'note', val: string) => void
  onAdd: () => void
  datalistId: string
  suggestions: string[]
}

function EntryList({ entries, onDelete }: { entries: ExpenseEntry[]; onDelete: (id: string) => void }) {
  if (entries.length === 0) return null
  return (
    <div className="space-y-1.5 mb-3">
      {entries.map(entry => (
        <div key={entry.id} className="flex items-center gap-3 group">
          <span className="text-sm text-gray-400 flex-1">{entry.category}</span>
          {entry.note && <span className="text-xs text-gray-600 truncate max-w-[160px]">{entry.note}</span>}
          <span className="text-sm font-semibold text-gray-300 tabular-nums">{formatCurrency(entry.amount)}</span>
          <button
            onClick={() => onDelete(entry.id)}
            className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-400 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}

function AddEntryForm({ form, onFormChange, onAdd, datalistId, suggestions }: EntryFormProps) {
  return (
    <div className="flex flex-wrap items-end gap-2 pt-2">
      <div className="flex-1 min-w-[130px]">
        <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Category</label>
        <input
          list={datalistId}
          value={form.cat}
          onChange={e => onFormChange('cat', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onAdd() }}
          placeholder="Description"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <datalist id={datalistId}>
          {suggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      </div>
      <div className="w-28">
        <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Amount</label>
        <input
          type="number" step="1" value={form.amt} placeholder="0"
          onChange={e => onFormChange('amt', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onAdd() }}
          className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div className="flex-1 min-w-[90px]">
        <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Note</label>
        <input
          value={form.note}
          onChange={e => onFormChange('note', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onAdd() }}
          placeholder="optional"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <button
        onClick={onAdd}
        disabled={!form.cat.trim() || !form.amt}
        className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
      >
        Add
      </button>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

const EMPTY_FORM = { cat: '', amt: '', note: '' }

export default function Compensation() {
  const { reports, schedules, settings, stipendMappings, annualExpenses, saveAnnualExpenses, deleteAnnualExpenses } = useData()

  const now = new Date()
  const currentYear = now.getFullYear()

  const years = useMemo(() => {
    const s = new Set<number>([currentYear])
    for (const r of reports) s.add(r.year)
    for (const e of annualExpenses) s.add(e.year)
    return [...s].sort((a, b) => b - a)
  }, [reports, annualExpenses, currentYear])

  const [selectedYear, setSelectedYear] = useState<number>(years[0] ?? currentYear)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const draftInitializedForYear = useRef<number | null>(null)

  const [forms, setForms] = useState<Record<Section, typeof EMPTY_FORM>>({
    business: EMPTY_FORM, benefits: EMPTY_FORM, retirement: EMPTY_FORM,
  })

  const yearStats = useMemo(
    () => computeCalendarYearStats(selectedYear, reports, schedules, settings, stipendMappings),
    [selectedYear, reports, schedules, settings, stipendMappings]
  )

  const annualGross = useMemo(
    () => yearStats.reduce((s, m) => s + m.totalCompensation, 0),
    [yearStats]
  )

  const currentRecord = useMemo(
    () => annualExpenses.find(e => e.year === selectedYear),
    [annualExpenses, selectedYear]
  )

  useEffect(() => {
    if (selectedYear === draftInitializedForYear.current) return
    draftInitializedForYear.current = selectedYear
    setDraft(initDraft(currentRecord, annualGross))
  }, [selectedYear, currentRecord, annualGross])

  function getOrCreate(): AnnualExpenses {
    return currentRecord ?? {
      id: String(selectedYear), year: selectedYear,
      recurring: {}, entries: [], benefitsEntries: [], retirementEntries: [],
    }
  }

  function hasAnything(rec: AnnualExpenses): boolean {
    return (
      Object.values(rec.recurring ?? {}).some(v => v !== 0) ||
      (rec.entries?.length ?? 0) > 0 ||
      (rec.benefitsEntries?.length ?? 0) > 0 ||
      (rec.retirementEntries?.length ?? 0) > 0
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

  function updateForm(section: Section, field: 'cat' | 'amt' | 'note', val: string) {
    setForms(f => ({ ...f, [section]: { ...f[section], [field]: val } }))
  }

  async function handleAddEntry(section: Section) {
    const form = forms[section]
    const amt = parseFloat(form.amt)
    if (!form.cat.trim() || isNaN(amt) || amt === 0) return
    const record = getOrCreate()
    const entry: ExpenseEntry = {
      id: crypto.randomUUID(),
      category: form.cat.trim(),
      amount: amt,
      note: form.note.trim() || undefined,
    }
    const field = SECTION_ENTRY_FIELD[section]
    const existing = (record[field] as ExpenseEntry[] | undefined) ?? []
    await saveAnnualExpenses({ ...record, [field]: [...existing, entry] })
    setForms(f => ({ ...f, [section]: EMPTY_FORM }))
  }

  async function handleDeleteEntry(section: Section, entryId: string) {
    const record = getOrCreate()
    const field = SECTION_ENTRY_FIELD[section]
    const existing = (record[field] as ExpenseEntry[] | undefined) ?? []
    const updated = { ...record, [field]: existing.filter(e => e.id !== entryId) }
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

  const businessExpenses = recurringSum(BUSINESS_KEYS) + (currentRecord?.entries?.reduce((s, e) => s + e.amount, 0) ?? 0)
  const benefitsTotal    = recurringSum(BENEFITS_KEYS) + (currentRecord?.benefitsEntries?.reduce((s, e) => s + e.amount, 0) ?? 0)
  const retirementTotal  = recurringSum(RETIREMENT_KEYS) + (currentRecord?.retirementEntries?.reduce((s, e) => s + e.amount, 0) ?? 0)
  const netIncome        = annualGross - businessExpenses - benefitsTotal - retirementTotal
  const totalComp        = netIncome + benefitsTotal + retirementTotal
  const overheadPct      = annualGross > 0 ? businessExpenses / annualGross * 100 : 0

  // ── JSX ───────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-8 max-w-3xl">

      {/* Header */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-100">Compensation</h2>
        <div className="flex items-center gap-2 ml-2">
          {years.slice(0, 3).map(y => (
            <button key={y} onClick={() => setSelectedYear(y)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                y === selectedYear ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}>{y}</button>
          ))}
          {years.length > 3 && (
            <select
              value={years.slice(3).includes(selectedYear) ? selectedYear : ''}
              onChange={e => setSelectedYear(Number(e.target.value))}
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

      {/* Stat cards — row 1: P&L */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {([
          { label: 'Gross Revenue',     value: formatCurrency(annualGross),      color: 'text-emerald-400' },
          { label: 'Business Expenses', value: formatCurrency(businessExpenses), color: 'text-red-400' },
          { label: 'Net Income',        value: formatCurrency(netIncome),        color: netIncome >= 0 ? 'text-indigo-400' : 'text-red-400' },
          { label: 'Overhead',          value: formatPct(overheadPct),           color: 'text-amber-400' },
        ] as const).map(({ label, value, color }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Stat cards — row 2: personal comp */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {([
          { label: 'Benefits',           value: formatCurrency(benefitsTotal),   color: 'text-sky-400' },
          { label: 'Retirement',         value: formatCurrency(retirementTotal), color: 'text-teal-400' },
          { label: 'Total Compensation', value: formatCurrency(totalComp),       color: totalComp >= 0 ? 'text-violet-400' : 'text-red-400' },
        ] as const).map(({ label, value, color }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Expense form */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300">{selectedYear} Expenses</h3>
        </div>

        <div className="divide-y divide-gray-800">

          {/* ── Business Expenses ── */}
          <div className="px-5 py-4">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">Business Expenses</p>
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
            <EntryList
              entries={currentRecord?.entries ?? []}
              onDelete={id => handleDeleteEntry('business', id)}
            />
            <AddEntryForm
              entries={currentRecord?.entries ?? []}
              form={forms.business}
              onFormChange={(f, v) => updateForm('business', f, v)}
              onAdd={() => handleAddEntry('business')}
              datalistId="biz-categories"
              suggestions={['Accounting & Legal', 'Office & Subscriptions', 'Business Travel', 'Medical Equipment', 'Other']}
            />
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-800">
              <span className="text-sm text-gray-500">Business Expenses Total</span>
              <span className="text-sm font-bold text-red-400 tabular-nums">{formatCurrency(businessExpenses)}</span>
            </div>
          </div>

          {/* ── Benefits ── */}
          <div className="px-5 py-4">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">Benefits</p>

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

            <EntryList
              entries={currentRecord?.benefitsEntries ?? []}
              onDelete={id => handleDeleteEntry('benefits', id)}
            />
            <AddEntryForm
              entries={currentRecord?.benefitsEntries ?? []}
              form={forms.benefits}
              onFormChange={(f, v) => updateForm('benefits', f, v)}
              onAdd={() => handleAddEntry('benefits')}
              datalistId="ben-categories"
              suggestions={['Medical Licensing & DEA', 'Professional Dues', 'Conference Registration', 'Other']}
            />
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-gray-800">
              <span className="text-sm text-gray-500">Benefits Total</span>
              <span className="text-sm font-bold text-sky-400 tabular-nums">{formatCurrency(benefitsTotal)}</span>
            </div>
          </div>

          {/* ── Retirement Benefits ── */}
          <div className="px-5 py-4">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">Retirement Benefits</p>
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
            <EntryList
              entries={currentRecord?.retirementEntries ?? []}
              onDelete={id => handleDeleteEntry('retirement', id)}
            />
            <AddEntryForm
              entries={currentRecord?.retirementEntries ?? []}
              form={forms.retirement}
              onFormChange={(f, v) => updateForm('retirement', f, v)}
              onAdd={() => handleAddEntry('retirement')}
              datalistId="ret-categories"
              suggestions={['IRA Contribution', 'HSA Contribution', 'Other']}
            />
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
