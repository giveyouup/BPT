import { useState, useMemo, useEffect, useRef } from 'react'
import { useData } from '../context/DataContext'
import { computeCalendarYearStats } from '../utils/calculations'
import { formatCurrency } from '../utils/dateUtils'
import type { ExpenseEntry, AnnualExpenses } from '../types'

// ─── Recurring category definitions ───────────────────────────────────────────

type RecurringLeaf = { kind: 'leaf'; key: string; label: string; defaultAmount: number; isPersonal?: boolean }
type RecurringGroup = { kind: 'group'; label: string; isPersonal: true; children: RecurringLeaf[] }
type RecurringItem = RecurringLeaf | RecurringGroup

const RECURRING_ITEMS: RecurringItem[] = [
  { kind: 'leaf', key: 'operatingFee',       label: 'Operating Fee (7%)',    defaultAmount: 0 },
  { kind: 'leaf', key: 'developmentReserve', label: 'Development Fee (10%)', defaultAmount: 0 },
  { kind: 'leaf', key: 'operatingExpense',   label: 'Operating Expense',     defaultAmount: 0 },
  { kind: 'leaf', key: 'payrollTaxes',       label: 'Payroll Taxes',         defaultAmount: 0 },
  { kind: 'leaf', key: 'liabilityInsurance', label: 'Liability Insurance',   defaultAmount: 0 },
  {
    kind: 'group', label: 'Health Insurance', isPersonal: true, children: [
      { kind: 'leaf', key: 'healthDental',  label: 'Dental',  defaultAmount: 0, isPersonal: true },
      { kind: 'leaf', key: 'healthMedical', label: 'Medical', defaultAmount: 0, isPersonal: true },
      { kind: 'leaf', key: 'healthVision',  label: 'Vision',  defaultAmount: 0, isPersonal: true },
    ],
  },
]

const RECURRING_LEAVES: RecurringLeaf[] = RECURRING_ITEMS.flatMap(item =>
  item.kind === 'leaf' ? [item] : item.children
)

const BUSINESS_KEYS = new Set(RECURRING_LEAVES.filter(l => !l.isPersonal).map(l => l.key))
const PERSONAL_KEYS = new Set(RECURRING_LEAVES.filter(l => l.isPersonal).map(l => l.key))
const ACTIVE_KEYS   = new Set(RECURRING_LEAVES.map(l => l.key))

const BUSINESS_ITEMS = RECURRING_ITEMS.filter(item => item.kind === 'leaf' && !item.isPersonal) as RecurringLeaf[]
const PERSONAL_GROUP = RECURRING_ITEMS.find((item): item is RecurringGroup => item.kind === 'group' && !!item.isPersonal)!

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`
}

function AmountInput({
  value, onChange, onBlur,
}: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div className="relative w-36">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-600">$</span>
      <input
        type="number"
        step="1"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="0"
        className="w-full bg-gray-800 border border-gray-700 rounded pl-5 pr-2 py-1.5 text-sm text-right text-gray-200 placeholder-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

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

  // Draft: key -> string value for controlled inputs
  const [draft, setDraft] = useState<Record<string, string>>({})
  const draftInitializedForYear = useRef<number | null>(null)

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

  // Initialize draft when year changes
  useEffect(() => {
    if (selectedYear === draftInitializedForYear.current) return
    draftInitializedForYear.current = selectedYear
    const rec = currentRecord
    const savedFee = rec?.recurring?.['operatingFee']
    const operatingFeeAmt = savedFee !== undefined ? savedFee : Math.round(annualGross * 0.07)
    const savedDev = rec?.recurring?.['developmentReserve']
    const devAmt = savedDev !== undefined ? savedDev : Math.round((annualGross - operatingFeeAmt) * 0.10)

    const newDraft: Record<string, string> = {}
    for (const leaf of RECURRING_LEAVES) {
      const saved = rec?.recurring?.[leaf.key]
      if (saved !== undefined) {
        newDraft[leaf.key] = String(saved)
      } else if (leaf.key === 'operatingFee') {
        newDraft[leaf.key] = annualGross > 0 ? String(operatingFeeAmt) : ''
      } else if (leaf.key === 'developmentReserve') {
        newDraft[leaf.key] = annualGross > 0 ? String(devAmt) : ''
      } else {
        newDraft[leaf.key] = ''
      }
    }
    setDraft(newDraft)
  }, [selectedYear, currentRecord, annualGross])

  // Free-form entry state
  const [newCategory, setNewCategory] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newNote, setNewNote] = useState('')

  function getOrCreateRecord(): AnnualExpenses {
    const id = String(selectedYear)
    return currentRecord ?? { id, year: selectedYear, recurring: {}, entries: [] }
  }

  async function handleBlur(key: string) {
    const amount = parseFloat(draft[key] ?? '') || 0
    const record = getOrCreateRecord()
    const merged = { ...(record.recurring ?? {}), [key]: amount }
    const updatedRecurring = Object.fromEntries(Object.entries(merged).filter(([k]) => ACTIVE_KEYS.has(k)))
    const updated = { ...record, recurring: updatedRecurring }
    const hasAnything = Object.values(updatedRecurring).some(v => v !== 0) || updated.entries.length > 0
    if (!hasAnything && currentRecord) {
      await deleteAnnualExpenses(updated.id)
    } else if (hasAnything) {
      await saveAnnualExpenses(updated)
    }
  }

  async function handleAddEntry() {
    const amt = parseFloat(newAmount)
    if (!newCategory.trim() || isNaN(amt) || amt === 0) return
    const record = getOrCreateRecord()
    const entry: ExpenseEntry = {
      id: crypto.randomUUID(),
      category: newCategory.trim(),
      amount: amt,
      note: newNote.trim() || undefined,
    }
    await saveAnnualExpenses({ ...record, entries: [...record.entries, entry] })
    setNewCategory(''); setNewAmount(''); setNewNote('')
  }

  async function handleDeleteEntry(entryId: string) {
    const record = getOrCreateRecord()
    const updated = { ...record, entries: record.entries.filter(e => e.id !== entryId) }
    const hasAnything = Object.values(updated.recurring ?? {}).some(v => v !== 0) || updated.entries.length > 0
    if (!hasAnything) await deleteAnnualExpenses(updated.id)
    else await saveAnnualExpenses(updated)
  }

  // Derived totals from saved record
  function recurringSum(keys: Set<string>): number {
    if (!currentRecord?.recurring) return 0
    return Object.entries(currentRecord.recurring)
      .filter(([k]) => keys.has(k))
      .reduce((s, [, v]) => s + v, 0)
  }

  const businessExpenses  = recurringSum(BUSINESS_KEYS) + (currentRecord?.entries.reduce((s, e) => s + e.amount, 0) ?? 0)
  const personalDeductions = recurringSum(PERSONAL_KEYS)
  const netIncome         = annualGross - businessExpenses
  const totalComp         = netIncome + personalDeductions
  const overheadPct       = annualGross > 0 ? businessExpenses / annualGross * 100 : 0

  // ── JSX ─────────────────────────────────────────────────────────────────────

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

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        {([
          { label: 'Gross Revenue',      value: formatCurrency(annualGross),        color: 'text-emerald-400' },
          { label: 'Business Expenses',  value: formatCurrency(businessExpenses),   color: 'text-red-400' },
          { label: 'Net Income',         value: formatCurrency(netIncome),          color: netIncome >= 0 ? 'text-indigo-400' : 'text-red-400' },
          { label: 'Overhead',           value: formatPct(overheadPct),             color: 'text-amber-400' },
          { label: 'Total Compensation', value: formatCurrency(totalComp),          color: totalComp >= 0 ? 'text-violet-400' : 'text-red-400' },
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

        <div className="px-5 py-4 space-y-6">

          {/* Business expenses */}
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">Business Expenses</p>
            <div className="space-y-2">
              {BUSINESS_ITEMS.map(item => (
                <div key={item.key} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-400">{item.label}</span>
                  <AmountInput
                    value={draft[item.key] ?? ''}
                    onChange={v => setDraft(d => ({ ...d, [item.key]: v }))}
                    onBlur={() => handleBlur(item.key)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Additional free-form entries */}
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">Additional</p>
            {currentRecord && currentRecord.entries.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {currentRecord.entries.map(entry => (
                  <div key={entry.id} className="flex items-center gap-3 group">
                    <span className="text-sm text-gray-400 flex-1">{entry.category}</span>
                    {entry.note && <span className="text-xs text-gray-600 truncate max-w-[160px]">{entry.note}</span>}
                    <span className="text-sm font-semibold text-red-400 tabular-nums">{formatCurrency(entry.amount)}</span>
                    <button
                      onClick={() => handleDeleteEntry(entry.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-400 transition-all"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[130px]">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Category</label>
                <input
                  list="expense-categories"
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddEntry() }}
                  placeholder="Description"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <datalist id="expense-categories">
                  {['CME & Education', 'Medical Licensing & DEA', 'Professional Dues', 'Medical Equipment', 'Business Travel', 'Accounting & Legal', 'Office & Subscriptions', 'Other'].map(s => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="w-28">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Amount</label>
                <input
                  type="number" step="1"
                  value={newAmount}
                  onChange={e => setNewAmount(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddEntry() }}
                  placeholder="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="flex-1 min-w-[90px]">
                <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Note</label>
                <input
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddEntry() }}
                  placeholder="optional"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <button
                onClick={handleAddEntry}
                disabled={!newCategory.trim() || !newAmount}
                className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Add
              </button>
            </div>
          </div>

          {/* Business subtotal */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-800">
            <span className="text-sm text-gray-500">Business Expenses Total</span>
            <span className="text-sm font-bold text-red-400 tabular-nums">{formatCurrency(businessExpenses)}</span>
          </div>

          {/* Personal deductions */}
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-3">Personal Deductions</p>
            <div className="space-y-2">
              {PERSONAL_GROUP.children.map(child => (
                <div key={child.key} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-400">Health Insurance — {child.label}</span>
                  <AmountInput
                    value={draft[child.key] ?? ''}
                    onChange={v => setDraft(d => ({ ...d, [child.key]: v }))}
                    onBlur={() => handleBlur(child.key)}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-gray-800">
              <span className="text-sm text-gray-500">Personal Deductions Total</span>
              <span className="text-sm font-bold text-violet-400 tabular-nums">{formatCurrency(personalDeductions)}</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
