import { useState, useMemo, useEffect, useRef } from 'react'
import { useData } from '../context/DataContext'
import { computeCalendarYearStats } from '../utils/calculations'
import { getMonthName, formatCurrency } from '../utils/dateUtils'
import type { ExpenseEntry, MonthlyExpenses } from '../types'

// ─── Recurring category definitions ───────────────────────────────────────────

type RecurringLeaf = { kind: 'leaf'; key: string; label: string; default: number }
type RecurringGroup = { kind: 'group'; label: string; isPersonal?: boolean; children: RecurringLeaf[] }
type RecurringItem = RecurringLeaf | RecurringGroup

const RECURRING_ITEMS: RecurringItem[] = [
  { kind: 'leaf', key: 'operatingExpense',   label: 'Operating Expense',    default: 600 },
  { kind: 'leaf', key: 'developmentReserve', label: 'Development Reserve',  default: 0 },
  { kind: 'leaf', key: 'operatingFee',       label: 'Operating Fee',        default: 0 },
  { kind: 'leaf', key: 'payrollTaxes',       label: 'Payroll Taxes',        default: 0 },
  { kind: 'leaf', key: 'liabilityInsurance', label: 'Liability Insurance',  default: 0 },
  {
    kind: 'group', label: 'Health Insurance', isPersonal: true, children: [
      { kind: 'leaf', key: 'healthDental',  label: 'Dental',  default: 0 },
      { kind: 'leaf', key: 'healthMedical', label: 'Medical', default: 0 },
      { kind: 'leaf', key: 'healthVision',  label: 'Vision',  default: 0 },
    ],
  },
]

// Flat list of all leaf keys and their defaults
const RECURRING_LEAVES: RecurringLeaf[] = RECURRING_ITEMS.flatMap(item =>
  item.kind === 'leaf' ? [item] : item.children
)

const BUSINESS_RECURRING_KEYS = new Set(
  RECURRING_ITEMS.flatMap(item =>
    item.kind === 'leaf' ? [item.key]
    : item.isPersonal ? []
    : item.children.map(c => c.key)
  )
)

const PERSONAL_RECURRING_KEYS = new Set(
  RECURRING_ITEMS.flatMap(item =>
    item.kind === 'group' && item.isPersonal ? item.children.map(c => c.key) : []
  )
)

const BUSINESS_RECURRING_ITEMS = RECURRING_ITEMS.filter(item =>
  item.kind === 'leaf' || !item.isPersonal
)
const PERSONAL_RECURRING_ITEMS = RECURRING_ITEMS.filter(item =>
  item.kind === 'group' && item.isPersonal
)

function initDraft(rec: MonthlyExpenses | undefined): Record<string, string> {
  const draft: Record<string, string> = {}
  for (const leaf of RECURRING_LEAVES) {
    const saved = rec?.recurring?.[leaf.key]
    draft[leaf.key] = saved ? String(saved) : (leaf.default ? String(leaf.default) : '')
  }
  return draft
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`
}

// ─── Amount input ──────────────────────────────────────────────────────────────

function AmountInput({
  value, onChange, onBlur,
}: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <div className="relative w-28">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-600">$</span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="0"
        className="w-full bg-gray-900 border border-gray-700 rounded pl-5 pr-2 py-1 text-xs text-right text-gray-200 placeholder-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Compensation() {
  const { reports, schedules, settings, stipendMappings, monthlyExpenses, saveMonthlyExpenses, deleteMonthlyExpenses } = useData()

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const years = useMemo(() => {
    const s = new Set<number>([currentYear])
    for (const r of reports) s.add(r.year)
    for (const e of monthlyExpenses) s.add(e.year)
    return [...s].sort((a, b) => b - a)
  }, [reports, monthlyExpenses, currentYear])

  const [selectedYear, setSelectedYear] = useState<number>(years[0] ?? currentYear)
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null)
  const [recurringDraft, setRecurringDraft] = useState<Record<string, string>>({})
  const draftInitializedForMonth = useRef<number | null>(null)

  // Free-form entry state
  const [newCategory, setNewCategory] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newNote, setNewNote] = useState('')

  const yearStats = useMemo(
    () => computeCalendarYearStats(selectedYear, reports, schedules, settings, stipendMappings),
    [selectedYear, reports, schedules, settings, stipendMappings]
  )

  const grossByMonth = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of yearStats) m.set(s.month, s.totalCompensation)
    return m
  }, [yearStats])

  const expensesByMonth = useMemo(() => {
    const m = new Map<number, MonthlyExpenses>()
    for (const e of monthlyExpenses) {
      if (e.year === selectedYear) m.set(e.month, e)
    }
    return m
  }, [monthlyExpenses, selectedYear])

  // Initialize recurring draft only when the expanded month changes
  useEffect(() => {
    if (expandedMonth === draftInitializedForMonth.current) return
    draftInitializedForMonth.current = expandedMonth
    if (expandedMonth === null) { setRecurringDraft({}); return }
    setRecurringDraft(initDraft(expensesByMonth.get(expandedMonth)))
  }, [expandedMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const monthsToShow = selectedYear === currentYear
    ? Array.from({ length: currentMonth }, (_, i) => i + 1)
    : Array.from({ length: 12 }, (_, i) => i + 1)

  function getOrCreateRecord(month: number): MonthlyExpenses {
    const id = `${selectedYear}-${String(month).padStart(2, '0')}`
    return expensesByMonth.get(month) ?? { id, year: selectedYear, month, recurring: {}, entries: [] }
  }

  const ACTIVE_RECURRING_KEYS = new Set(RECURRING_LEAVES.map(l => l.key))

  function businessRecurringTotal(rec: MonthlyExpenses | undefined): number {
    if (!rec?.recurring) return 0
    return Object.entries(rec.recurring)
      .filter(([k]) => BUSINESS_RECURRING_KEYS.has(k))
      .reduce((s, [, v]) => s + v, 0)
  }

  function personalDeductionsTotal(rec: MonthlyExpenses | undefined): number {
    if (!rec?.recurring) return 0
    return Object.entries(rec.recurring)
      .filter(([k]) => PERSONAL_RECURRING_KEYS.has(k))
      .reduce((s, [, v]) => s + v, 0)
  }

  function entriesTotal(rec: MonthlyExpenses | undefined): number {
    return rec?.entries.reduce((s, e) => s + e.amount, 0) ?? 0
  }

  function businessMonthTotal(month: number): number {
    const rec = expensesByMonth.get(month)
    return businessRecurringTotal(rec) + entriesTotal(rec)
  }

  function personalMonthTotal(month: number): number {
    const rec = expensesByMonth.get(month)
    return personalDeductionsTotal(rec)
  }

  // Year totals
  const yearGross = monthsToShow.reduce((s, m) => s + (grossByMonth.get(m) ?? 0), 0)
  const yearBusinessExpenses = monthsToShow.reduce((s, m) => s + businessMonthTotal(m), 0)
  const yearPersonalDeductions = monthsToShow.reduce((s, m) => s + personalMonthTotal(m), 0)
  const yearNet = yearGross - yearBusinessExpenses
  const yearTotalComp = yearNet + yearPersonalDeductions
  const yearOverheadPct = yearGross > 0 ? yearBusinessExpenses / yearGross * 100 : 0

  // Save recurring field on blur
  async function handleRecurringBlur(month: number, key: string) {
    const amount = parseFloat(recurringDraft[key] ?? '') || 0
    const record = getOrCreateRecord(month)
    // Merge new value and strip any legacy keys no longer in the active set
    const merged = { ...(record.recurring ?? {}), [key]: amount }
    const updatedRecurring = Object.fromEntries(Object.entries(merged).filter(([k]) => ACTIVE_RECURRING_KEYS.has(k)))
    const updated = { ...record, recurring: updatedRecurring }
    const hasAnything = Object.values(updatedRecurring).some(v => v !== 0) || updated.entries.length > 0
    if (!hasAnything && expensesByMonth.has(month)) {
      await deleteMonthlyExpenses(updated.id)
    } else if (hasAnything) {
      await saveMonthlyExpenses(updated)
    }
  }

  async function handleAddEntry(month: number) {
    const amt = parseFloat(newAmount)
    if (!newCategory.trim() || isNaN(amt) || amt === 0) return
    const record = getOrCreateRecord(month)
    const entry: ExpenseEntry = {
      id: crypto.randomUUID(),
      category: newCategory.trim(),
      amount: amt,
      note: newNote.trim() || undefined,
    }
    await saveMonthlyExpenses({ ...record, entries: [...record.entries, entry] })
    setNewCategory(''); setNewAmount(''); setNewNote('')
  }

  async function handleDeleteEntry(month: number, entryId: string) {
    const record = getOrCreateRecord(month)
    const updated = { ...record, entries: record.entries.filter(e => e.id !== entryId) }
    const hasAnything = Object.values(updated.recurring ?? {}).some(v => v !== 0) || updated.entries.length > 0
    if (!hasAnything) await deleteMonthlyExpenses(updated.id)
    else await saveMonthlyExpenses(updated)
  }

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-100">Compensation</h2>
        <select
          value={selectedYear}
          onChange={e => { setSelectedYear(Number(e.target.value)); setExpandedMonth(null) }}
          className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Year summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        {([
          { label: 'Gross Revenue',      value: formatCurrency(yearGross),         color: 'text-emerald-400' },
          { label: 'Business Expenses',  value: formatCurrency(yearBusinessExpenses), color: 'text-red-400' },
          { label: 'Net Income',         value: formatCurrency(yearNet),           color: yearNet >= 0 ? 'text-indigo-400' : 'text-red-400' },
          { label: 'Overhead',           value: formatPct(yearOverheadPct),        color: 'text-amber-400' },
          { label: 'Total Compensation', value: formatCurrency(yearTotalComp),     color: yearTotalComp >= 0 ? 'text-violet-400' : 'text-red-400' },
        ] as const).map(({ label, value, color }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Monthly table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300">Monthly Breakdown</h3>
        </div>

        <div className="divide-y divide-gray-800">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-5 py-2 bg-gray-800/30">
            <span className="w-3.5" />
            <span className="text-xs text-gray-600 uppercase tracking-wider w-10">Month</span>
            <div className="flex-1 grid grid-cols-3 gap-2 text-right">
              <span className="text-xs text-gray-600 uppercase tracking-wider">Gross</span>
              <span className="text-xs text-gray-600 uppercase tracking-wider">Expenses</span>
              <span className="text-xs text-gray-600 uppercase tracking-wider">Net</span>
            </div>
            <span className="text-xs text-gray-600 uppercase tracking-wider w-12 text-right">OH%</span>
          </div>

          {monthsToShow.map(month => {
            const gross = grossByMonth.get(month) ?? 0
            const rec = expensesByMonth.get(month)
            const bizTotal = businessMonthTotal(month)
            const personalTotal = personalMonthTotal(month)
            const net = gross - bizTotal
            const overheadPct = gross > 0 ? bizTotal / gross * 100 : null
            const isExpanded = expandedMonth === month
            const hasData = gross > 0 || bizTotal > 0 || personalTotal > 0

            return (
              <div key={month}>
                {/* Month summary row */}
                <div
                  className={`flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors ${
                    isExpanded ? 'bg-indigo-950/20' : hasData ? 'hover:bg-gray-800/40' : 'opacity-40 hover:opacity-60'
                  }`}
                  onClick={() => setExpandedMonth(isExpanded ? null : month)}
                >
                  <svg className={`w-3.5 h-3.5 text-gray-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-sm font-medium text-gray-300 w-10">{getMonthName(month).slice(0, 3)}</span>
                  <div className="flex-1 grid grid-cols-3 gap-2 text-right text-sm">
                    <span className={gross > 0 ? 'text-emerald-400' : 'text-gray-700'}>{gross > 0 ? formatCurrency(gross) : '—'}</span>
                    <span className={bizTotal > 0 ? 'text-red-400' : 'text-gray-700'}>{bizTotal > 0 ? formatCurrency(bizTotal) : '—'}</span>
                    <span className={hasData ? (net >= 0 ? 'text-indigo-400' : 'text-red-400') : 'text-gray-700'}>{hasData ? formatCurrency(net) : '—'}</span>
                  </div>
                  {overheadPct !== null
                    ? <span className="text-xs text-amber-500 w-12 text-right">{formatPct(overheadPct)}</span>
                    : <span className="w-12" />}
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="bg-gray-950 border-t border-gray-800 px-5 py-4 space-y-5">

                    {/* ── Business Expenses ── */}
                    <div>
                      <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Business Expenses</p>
                      <div className="space-y-0.5">
                        {BUSINESS_RECURRING_ITEMS.map(item => {
                          if (item.kind === 'leaf') {
                            return (
                              <div key={item.key} className="flex items-center gap-3 py-1">
                                <span className="text-xs text-gray-400 flex-1">{item.label}</span>
                                <AmountInput
                                  value={recurringDraft[item.key] ?? ''}
                                  onChange={v => setRecurringDraft(d => ({ ...d, [item.key]: v }))}
                                  onBlur={() => handleRecurringBlur(month, item.key)}
                                />
                              </div>
                            )
                          }
                          // Group (non-personal)
                          const groupTotal = item.children.reduce((s, c) => {
                            const v = parseFloat(recurringDraft[c.key] ?? '') || 0
                            return s + v
                          }, 0)
                          return (
                            <div key={item.label}>
                              <div className="flex items-center gap-3 py-1">
                                <span className="text-xs font-medium text-gray-400 flex-1">{item.label}</span>
                                {groupTotal !== 0
                                  ? <span className="text-xs text-gray-500 w-28 text-right tabular-nums">{formatCurrency(groupTotal)}</span>
                                  : <span className="w-28" />}
                              </div>
                              {item.children.map(child => (
                                <div key={child.key} className="flex items-center gap-3 py-1 pl-4">
                                  <span className="text-xs text-gray-500 flex-1">{child.label}</span>
                                  <AmountInput
                                    value={recurringDraft[child.key] ?? ''}
                                    onChange={v => setRecurringDraft(d => ({ ...d, [child.key]: v }))}
                                    onBlur={() => handleRecurringBlur(month, child.key)}
                                  />
                                </div>
                              ))}
                            </div>
                          )
                        })}
                      </div>

                      {/* Additional (free-form) entries */}
                      <div className="mt-3">
                        <p className="text-[10px] text-gray-700 uppercase tracking-wider mb-2">Additional</p>
                        {rec && rec.entries.length > 0 && (
                          <div className="space-y-1 mb-3">
                            {rec.entries.map(entry => (
                              <div key={entry.id} className="flex items-center gap-3 py-0.5 group">
                                <span className="text-xs text-gray-400 flex-1">{entry.category}</span>
                                {entry.note && <span className="text-xs text-gray-600 truncate max-w-[140px]">{entry.note}</span>}
                                <span className="text-xs font-semibold text-red-400 tabular-nums w-28 text-right">{formatCurrency(entry.amount)}</span>
                                <button
                                  onClick={() => handleDeleteEntry(month, entry.id)}
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
                        {/* Add entry form */}
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="flex-1 min-w-[130px]">
                            <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Category</label>
                            <input
                              list="expense-categories"
                              value={newCategory}
                              onChange={e => setNewCategory(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleAddEntry(month) }}
                              placeholder="Description"
                              className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                              type="number" step="0.01"
                              value={newAmount}
                              onChange={e => setNewAmount(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleAddEntry(month) }}
                              placeholder="0.00"
                              className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                          <div className="flex-1 min-w-[90px]">
                            <label className="block text-[10px] text-gray-600 mb-1 uppercase tracking-wider">Note</label>
                            <input
                              value={newNote}
                              onChange={e => setNewNote(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleAddEntry(month) }}
                              placeholder="optional"
                              className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                          <button
                            onClick={() => handleAddEntry(month)}
                            disabled={!newCategory.trim() || !newAmount}
                            className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
                          >
                            Add
                          </button>
                        </div>
                      </div>

                      {/* Business subtotal */}
                      <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-800">
                        <span className="text-xs text-gray-600">Business expenses</span>
                        <span className="text-xs font-semibold text-red-400 tabular-nums">
                          {formatCurrency(bizTotal)}
                        </span>
                      </div>
                    </div>

                    {/* ── Personal Deductions ── */}
                    <div>
                      <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Personal Deductions</p>
                      <div className="space-y-0.5">
                        {PERSONAL_RECURRING_ITEMS.map(item => {
                          const groupTotal = item.children.reduce((s, c) => {
                            const v = parseFloat(recurringDraft[c.key] ?? '') || 0
                            return s + v
                          }, 0)
                          return (
                            <div key={item.label}>
                              <div className="flex items-center gap-3 py-1">
                                <span className="text-xs font-medium text-gray-400 flex-1">{item.label}</span>
                                {groupTotal !== 0
                                  ? <span className="text-xs text-gray-500 w-28 text-right tabular-nums">{formatCurrency(groupTotal)}</span>
                                  : <span className="w-28" />}
                              </div>
                              {item.children.map(child => (
                                <div key={child.key} className="flex items-center gap-3 py-1 pl-4">
                                  <span className="text-xs text-gray-500 flex-1">{child.label}</span>
                                  <AmountInput
                                    value={recurringDraft[child.key] ?? ''}
                                    onChange={v => setRecurringDraft(d => ({ ...d, [child.key]: v }))}
                                    onBlur={() => handleRecurringBlur(month, child.key)}
                                  />
                                </div>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-800">
                        <span className="text-xs text-gray-600">Personal deductions</span>
                        <span className="text-xs font-semibold text-violet-400 tabular-nums">
                          {formatCurrency(personalTotal)}
                        </span>
                      </div>
                    </div>

                    {/* ── Month summary ── */}
                    {gross > 0 && (
                      <div className="space-y-1 pt-2 border-t border-gray-700">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-600">Net income</span>
                          <span className={`text-xs font-semibold tabular-nums ${net >= 0 ? 'text-indigo-400' : 'text-red-400'}`}>{formatCurrency(net)}</span>
                        </div>
                        {personalTotal !== 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-600">Total compensation</span>
                            <span className={`text-sm font-bold tabular-nums ${(net + personalTotal) >= 0 ? 'text-violet-400' : 'text-red-400'}`}>{formatCurrency(net + personalTotal)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* YTD footer */}
        <div className="px-5 py-3 border-t border-gray-800 bg-gray-800/40 flex items-center gap-3">
          <span className="w-3.5" />
          <span className="text-xs text-gray-600 w-10">YTD</span>
          <div className="flex-1 grid grid-cols-3 gap-2 text-right text-xs font-semibold">
            <span className="text-emerald-500">{formatCurrency(yearGross)}</span>
            <span className="text-red-500">{formatCurrency(yearBusinessExpenses)}</span>
            <span className={yearNet >= 0 ? 'text-indigo-400' : 'text-red-400'}>{formatCurrency(yearNet)}</span>
          </div>
          <span className="text-xs font-semibold text-amber-500 w-12 text-right">{formatPct(yearOverheadPct)}</span>
        </div>
      </div>
    </div>
  )
}
