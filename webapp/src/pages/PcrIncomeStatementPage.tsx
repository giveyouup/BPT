import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { formatCurrency, getMonthName } from '../utils/dateUtils'
import { resolvePcrCategoryMapping } from '../utils/pcrCategoryMatching'
import { describeStipendGroupKey } from '../utils/calculations'
import { BUSINESS_LEAVES, BENEFITS_LEAVES, RETIREMENT_LEAVES, BUSINESS_KEYS, BENEFITS_KEYS, RETIREMENT_KEYS, LEAF_LABELS } from '../utils/expenseCategories'
import type { PcrStatementLine, PcrCategoryMapping } from '../types'

interface SectionMeta {
  key: PcrStatementLine['section']
  title: string
  description: string
  defaultOpen: boolean
}

// 'stipend' and 'otherIncome' are still computed here (row-building is keyed
// off the same PcrStatementLine sections regardless of layout), but they're
// no longer rendered as their own top-level sections below -- they're nested
// under the "Revenue" container instead, alongside Professional Fees.
const SECTION_META: SectionMeta[] = [
  { key: 'stipend', title: 'Stipends', description: 'Per-assignment stipend line items as reported on the PCR.', defaultOpen: true },
  { key: 'expense', title: 'Expenses', description: 'Itemized overhead costs as reported on the PCR, grouped to match the Compensation page.', defaultOpen: true },
  { key: 'otherIncome', title: 'Other Income', description: 'Board/committee and other non-clinical income.', defaultOpen: true },
  { key: 'other', title: 'Other (Balance Rollups)', description: 'Everything else on the PCR -- rolled-forward balance, PCR surplus/deficit, and similar running totals. These are largely point-in-time balances, so summing them across months is not always meaningful.', defaultOpen: false },
]

interface SectionRow {
  label: string
  amounts: Record<number, number>
  total: number
  // The raw PCR-printed label(s) this row was built from, when `label` is a
  // mapped category name rather than a printed label itself (i.e. whenever a
  // PcrCategoryMapping applies) -- multiple entries mean multiple PCR labels
  // were merged into this one category row. Shown as a hover tooltip so the
  // original printed text is never fully lost behind the category name.
  sourceLabels?: string[]
}

// A row paired with its stable identity for ordering/drag-and-drop purposes:
// the leaf category key for a fixed expense group (stable across relabeling),
// or the raw PCR label text for groups with no fixed key (stipends, unmapped
// expenses).
interface OrderedRow {
  id: string
  row: SectionRow
}

// Same coloring as Compensation's Business Expenses / Benefits / Retirement
// Benefits sections, so a PCR expense line's category is visually traceable
// to exactly where it lands on that page.
const EXPENSE_GROUP_META = {
  business:  { title: 'Business Expenses',   badge: 'bg-red-950 text-red-400',       border: 'border-red-700' },
  benefits:  { title: 'Benefits',            badge: 'bg-orange-950 text-orange-400', border: 'border-orange-700' },
  retirement:{ title: 'Retirement Benefits', badge: 'bg-green-950 text-green-400',   border: 'border-green-700' },
  unmapped:  { title: 'Unmapped',            badge: 'bg-gray-800 text-gray-400',     border: 'border-gray-700' },
} as const

type ExpenseGroupKey = keyof typeof EXPENSE_GROUP_META

// Revenue's own sub-blocks, same visual pattern (colored pill + left border)
// as Expenses, but a cooler palette so the two containers still read as
// visually distinct concepts (revenue vs. expense) despite sharing the pattern.
const REVENUE_GROUP_META = {
  professionalFees: { title: 'Professional Fees', badge: 'bg-blue-950 text-blue-400',    border: 'border-blue-700' },
  stipends:         { title: 'Stipends',           badge: 'bg-indigo-950 text-indigo-400', border: 'border-indigo-700' },
  otherIncome:      { title: 'Other Income',       badge: 'bg-teal-950 text-teal-400',    border: 'border-teal-700' },
} as const

// Category-block indent/border, thinned on mobile -- a full pl-4/border-l-4
// per level (plus the Health Insurance sub-group's own extra indent) eats
// enough width on a phone to leave almost nothing for the table itself.
const CATEGORY_BLOCK_CLS = 'pl-2 pr-3 py-4 border-l-2 md:pl-4 md:pr-5 md:border-l-4'
// Nested "Unmapped" block resets its parent's indent via negative margins
// before reapplying its own -- both sides of that cancellation need the same
// responsive values or they'd only cancel out at one breakpoint.
const NESTED_UNMAPPED_CLS = 'mt-3 pl-2 pr-3 py-4 -ml-2 -mr-3 md:pl-4 md:pr-5 md:-ml-4 md:-mr-5 border-t border-gray-800 border-l-2 md:border-l-4'

// Rows within a group default to matching Compensation's own leaf order (the
// single shared source of truth in expenseCategories.ts), not the order
// labels happen to first appear in the underlying PCR data. Rows with no
// fixed leaf (free-form categories, "Unmapped") keep first-appearance order,
// sorted after every fixed leaf. A user's own drag-and-drop order (applyCustomOrder)
// is layered on top of this default afterward.
const BUSINESS_ORDER = new Map(BUSINESS_LEAVES.map((l, i) => [l.key, i]))
const BENEFITS_ORDER = new Map(BENEFITS_LEAVES.map((l, i) => [l.key, i]))
const RETIREMENT_ORDER = new Map(RETIREMENT_LEAVES.map((l, i) => [l.key, i]))

// Multiple PCR labels can map to the same category (e.g. "CV Anesthesia" and
// "CV NIR" both -> NIR) -- merged into a single summed row per target key,
// displayed under the mapped category's own name, rather than showing two
// identically-labeled rows side by side. The row's id becomes the target key
// itself (stable across relabeling, unlike a raw PCR label).
function mergeRowsByTarget(
  entries: { row: SectionRow; targetKey: string }[],
  describeLabel: (key: string) => string,
): OrderedRow[] {
  const byKey = new Map<string, { amounts: Record<number, number>; sourceLabels: string[] }>()
  for (const { row, targetKey } of entries) {
    if (!byKey.has(targetKey)) byKey.set(targetKey, { amounts: {}, sourceLabels: [] })
    const bucket = byKey.get(targetKey)!
    for (const [month, amount] of Object.entries(row.amounts)) {
      const m = Number(month)
      bucket.amounts[m] = (bucket.amounts[m] ?? 0) + amount
    }
    if (!bucket.sourceLabels.includes(row.label)) bucket.sourceLabels.push(row.label)
  }
  return [...byKey.entries()].map(([targetKey, { amounts, sourceLabels }]) => ({
    id: targetKey,
    row: {
      label: describeLabel(targetKey),
      amounts,
      total: Object.values(amounts).reduce((s, v) => s + v, 0),
      sourceLabels,
    },
  }))
}

function sortByOrder(rows: OrderedRow[], order: Map<string, number>): OrderedRow[] {
  return rows
    .map((r, i) => ({ r, sortKey: order.get(r.id) ?? (1000 + i) }))
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((x) => x.r)
}

// Layers a saved custom order (a list of item ids) on top of a group's
// already-default-sorted rows: items present in the saved order come first,
// in that order; anything new since the order was saved (a label that
// wasn't around yet) is appended afterward, in its existing default order.
function applyCustomOrder(items: OrderedRow[], savedOrder: string[] | undefined): OrderedRow[] {
  if (!savedOrder || savedOrder.length === 0) return items
  const rank = new Map(savedOrder.map((id, i) => [id, i]))
  return items
    .map((item, i) => ({ item, key: rank.has(item.id) ? rank.get(item.id)! : 100000 + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.item)
}

// Splits a flat section's rows into mapped / unmapped / hidden (via
// PcrCategoryMapping plus settings.hiddenPcrLabels -- the same "dismissed"
// list the PCR Category Mapping settings page uses for its suggestion chips,
// so hiding a label there also hides its row here instead of maintaining two
// separate "hidden" concepts for the same idea). Each bucket is independently
// custom-orderable. Shared by Stipends and Other Income -- unlike Expenses,
// neither has Compensation-side sub-categories to group by, so the only
// distinction worth surfacing is "does this feed a downstream feature
// (audit, sync) or not."
function splitMappedUnmapped(
  rows: SectionRow[],
  mappingSection: 'stipend' | 'otherIncome',
  mappings: PcrCategoryMapping[],
  hiddenLabels: string[],
  rowOrder: Record<string, string[]>,
  mappedGroupId: string,
  unmappedGroupId: string,
  describeLabel: (key: string) => string,
): { mapped: OrderedRow[]; unmapped: OrderedRow[]; hidden: OrderedRow[] } {
  const mappedEntries: { row: SectionRow; targetKey: string }[] = []
  const unmapped: OrderedRow[] = []
  const hidden: OrderedRow[] = []
  for (const row of rows) {
    const mapping = resolvePcrCategoryMapping(row.label, mappingSection, mappings)
    if (mapping) { mappedEntries.push({ row, targetKey: mapping.targetKey }); continue }
    ;(hiddenLabels.includes(row.label) ? hidden : unmapped).push({ id: row.label, row })
  }
  return {
    mapped: applyCustomOrder(mergeRowsByTarget(mappedEntries, describeLabel), rowOrder[mappedGroupId]),
    hidden: applyCustomOrder(hidden, rowOrder[unmappedGroupId]),
    unmapped: applyCustomOrder(unmapped, rowOrder[unmappedGroupId]),
  }
}

// Hidden below md -- this relies on native HTML5 drag-and-drop, which doesn't
// fire from touch input at all, so the handle would just be dead weight
// taking up space in the already-tight mobile Label column.
function DragHandle() {
  return (
    <svg className="hidden md:block w-3 h-3 text-gray-700 flex-shrink-0 cursor-grab" fill="currentColor" viewBox="0 0 16 16">
      <circle cx="5" cy="3" r="1.3" /><circle cx="11" cy="3" r="1.3" />
      <circle cx="5" cy="8" r="1.3" /><circle cx="11" cy="8" r="1.3" />
      <circle cx="5" cy="13" r="1.3" /><circle cx="11" cy="13" r="1.3" />
    </svg>
  )
}

function AmountTable({ rows, months, groupId, onReorder, onHideRow }: {
  rows: OrderedRow[]
  months: number[]
  groupId?: string
  onReorder?: (groupId: string, newOrder: string[]) => void
  // Only passed for "Unmapped" tables -- lets the user dismiss a row they've
  // decided isn't worth mapping, same "hidden" list the PCR Category Mapping
  // settings page uses for its own suggestion chips.
  onHideRow?: (label: string) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const reorderable = !!groupId && !!onReorder

  if (rows.length === 0) return null

  function handleDrop(targetId: string) {
    if (reorderable && dragId && dragId !== targetId) {
      const ids = rows.map((r) => r.id)
      const from = ids.indexOf(dragId)
      const to = ids.indexOf(targetId)
      if (from !== -1 && to !== -1) {
        const next = [...ids]
        next.splice(from, 1)
        next.splice(to, 0, dragId)
        onReorder!(groupId!, next)
      }
    }
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-max">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider sticky left-0 z-10 bg-gray-900 whitespace-nowrap">
              Label
            </th>
            {months.map((m) => (
              <th key={m} className="hidden md:table-cell px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                {getMonthName(m).slice(0, 3)}
              </th>
            ))}
            <th className="px-4 py-3 text-right text-xs font-semibold text-emerald-500 uppercase tracking-wider whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, row }) => (
            <tr
              key={id}
              draggable={reorderable}
              onDragStart={() => setDragId(id)}
              onDragOver={(e) => { if (reorderable) { e.preventDefault(); setOverId(id) } }}
              onDrop={(e) => { if (reorderable) { e.preventDefault(); handleDrop(id) } }}
              onDragEnd={() => { setDragId(null); setOverId(null) }}
              className={`group border-b border-gray-800 last:border-0 hover:bg-gray-800/60 ${
                overId === id && dragId !== id ? 'bg-indigo-950/40' : ''
              } ${dragId === id ? 'opacity-40' : ''}`}
            >
              <td
                className="px-4 py-2.5 text-gray-300 whitespace-nowrap sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800/60"
                title={row.sourceLabels ? `PCR label(s): ${row.sourceLabels.join(', ')}` : row.label}
              >
                <span className="flex items-center gap-1.5">
                  {reorderable && <DragHandle />}
                  {row.label}
                  {onHideRow && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onHideRow(row.label) }}
                      className="text-gray-700 hover:text-red-400 transition-colors leading-none"
                      title="Hide this row"
                    >
                      ×
                    </button>
                  )}
                </span>
              </td>
              {months.map((m) => {
                const v = row.amounts[m]
                return (
                  <td key={m} className="hidden md:table-cell px-4 py-2.5 text-right text-gray-400 tabular-nums whitespace-nowrap">
                    {v !== undefined ? formatCurrency(v) : <span className="text-gray-700">—</span>}
                  </td>
                )
              })}
              <td className="px-4 py-2.5 text-right font-semibold text-gray-200 tabular-nums whitespace-nowrap">
                {formatCurrency(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Compact chip-list reveal for rows dismissed from an Unmapped table -- same
// "Show N dismissed" / restore pattern as the PCR Category Mapping settings
// page's own hidden-label chips, since it's the same underlying list.
function HiddenRowsToggle({ hidden, onUnhide }: { hidden: OrderedRow[]; onUnhide: (label: string) => void }) {
  const [show, setShow] = useState(false)
  if (hidden.length === 0) return null
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="text-[10px] text-gray-600 hover:text-gray-400 underline underline-offset-2"
      >
        {show ? 'Hide dismissed rows' : `Show ${hidden.length} dismissed`}
      </button>
      {show && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {hidden.map(({ id, row }) => (
            <button
              key={id}
              type="button"
              onClick={() => onUnhide(row.label)}
              className="px-2 py-1 rounded-md text-[11px] font-mono border border-gray-800 text-gray-600 hover:text-emerald-400 hover:border-emerald-700 transition-colors"
              title="Restore this row"
            >
              {row.label} <span className="ml-0.5">↺</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PcrIncomeStatementPage() {
  const { year: yearParam } = useParams<{ year: string }>()
  const navigate = useNavigate()
  const { pcrIncomeStatements, pcrCategoryMappings, annualExpenses, settings, saveSettings } = useData()

  function handleReorder(groupId: string, newOrder: string[]) {
    saveSettings({ ...settings, pcrRowOrder: { ...(settings.pcrRowOrder ?? {}), [groupId]: newOrder } })
  }

  const years = useMemo(
    () => [...new Set(pcrIncomeStatements.map((s) => s.year))].sort((a, b) => b - a),
    [pcrIncomeStatements],
  )
  const year = yearParam ? parseInt(yearParam) : (years[0] ?? new Date().getFullYear())

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => ({ revenue: true, ...Object.fromEntries(SECTION_META.map((s) => [s.key, s.defaultOpen])) }),
  )

  const statementsForYear = useMemo(
    () => pcrIncomeStatements.filter((s) => s.year === year).sort((a, b) => a.month - b.month),
    [pcrIncomeStatements, year],
  )
  const months = statementsForYear.map((s) => s.month)

  const sections = useMemo(() => {
    return SECTION_META.map((meta) => {
      const labelOrder: string[] = []
      const rowsByLabel = new Map<string, Record<number, number>>()
      for (const stmt of statementsForYear) {
        for (const line of stmt.lines) {
          if (line.section !== meta.key) continue
          if (!rowsByLabel.has(line.label)) { rowsByLabel.set(line.label, {}); labelOrder.push(line.label) }
          const amounts = rowsByLabel.get(line.label)!
          amounts[stmt.month] = (amounts[stmt.month] ?? 0) + line.amount
        }
      }
      const rows: SectionRow[] = labelOrder.map((label) => {
        const amounts = rowsByLabel.get(label)!
        return { label, amounts, total: Object.values(amounts).reduce((s, v) => s + v, 0) }
      })
      return { ...meta, rows }
    })
  }, [statementsForYear])

  // Splits the Expenses section's rows into the same Business/Benefits
  // (with a nested Health Insurance group)/Retirement buckets Compensation
  // uses, by resolving each row's label through PcrCategoryMapping. A
  // mapped-but-free-form category (not a fixed leaf) is placed by checking
  // which of AnnualExpenses' entries/benefitsEntries/retirementEntries
  // arrays already contains it; if it's nowhere yet, it defaults to Business
  // -- the same default Compensation's own "Sync from PCR" apply uses.
  //
  // "Operating Reserves" items (Corporate Development Reserve/Fee, Operating
  // Expense) are extracted with section 'other', not 'expense' -- they sit
  // before the PCR's own EXPENSES header opens -- but Compensation's sync
  // still matches expense mappings against 'other' lines too, so a *mapped*
  // 'other' row is absorbed into these same buckets here; an *unmapped*
  // 'other' row is left alone in the Other section (matching the same
  // "don't flag unmapped 'other' lines" rule Compensation's sync uses).
  // Absorption is restricted to Business Expenses keys specifically -- the
  // only category real Operating Reserves items ever belong to -- so an
  // unrelated 'other' line that happens to share a mapping's substring (e.g.
  // "Cash Balance Plan - PCR Reserve" matching the "Cash Balance Plan"
  // mapping) doesn't get swept into Retirement/Benefits.
  const { expenseGroups, absorbedOtherLabels } = useMemo(() => {
    const expenseSection = sections.find((s) => s.key === 'expense')
    const otherSection = sections.find((s) => s.key === 'other')
    const hiddenExpenseLabels = settings.hiddenPcrLabels?.expense ?? []
    const buckets = {
      business: [] as { row: SectionRow; targetKey: string }[],
      benefits: [] as { row: SectionRow; targetKey: string }[],
      retirement: [] as { row: SectionRow; targetKey: string }[],
      unmapped: [] as OrderedRow[],
      hidden: [] as OrderedRow[],
      healthInsurance: [] as { row: SectionRow; targetKey: string }[],
    }
    const absorbed = new Set<string>()

    function place(row: SectionRow, isOther: boolean) {
      const mapping = resolvePcrCategoryMapping(row.label, 'expense', pcrCategoryMappings)
      if (!mapping) {
        // an unmapped 'other' row stays in Other, untouched
        if (!isOther) (hiddenExpenseLabels.includes(row.label) ? buckets.hidden : buckets.unmapped).push({ id: row.label, row })
        return
      }
      if (isOther && !BUSINESS_KEYS.has(mapping.targetKey)) return // leave in Other, untouched
      if (isOther) absorbed.add(row.label)
      const key = mapping.targetKey

      if (BUSINESS_KEYS.has(key)) { buckets.business.push({ row, targetKey: key }); return }
      if (BENEFITS_KEYS.has(key)) {
        const leaf = BENEFITS_LEAVES.find((l) => l.key === key)
        if (leaf?.subGroup) buckets.healthInsurance.push({ row, targetKey: key })
        else buckets.benefits.push({ row, targetKey: key })
        return
      }
      if (RETIREMENT_KEYS.has(key)) { buckets.retirement.push({ row, targetKey: key }); return }

      // Free-form category -- find which section it actually lives in on Compensation
      for (const rec of annualExpenses) {
        if ((rec.benefitsEntries ?? []).some((e) => e.category === key)) { buckets.benefits.push({ row, targetKey: key }); return }
        if ((rec.retirementEntries ?? []).some((e) => e.category === key)) { buckets.retirement.push({ row, targetKey: key }); return }
        if ((rec.entries ?? []).some((e) => e.category === key)) { buckets.business.push({ row, targetKey: key }); return }
      }
      buckets.business.push({ row, targetKey: key })
    }

    for (const row of expenseSection?.rows ?? []) place(row, false)
    for (const row of otherSection?.rows ?? []) place(row, true)

    const describeExpenseKey = (key: string) => LEAF_LABELS[key] ?? key
    const rowOrder = settings.pcrRowOrder ?? {}
    const groups: Record<ExpenseGroupKey, OrderedRow[]> & { healthInsurance: OrderedRow[]; hidden: OrderedRow[] } = {
      business: applyCustomOrder(sortByOrder(mergeRowsByTarget(buckets.business, describeExpenseKey), BUSINESS_ORDER), rowOrder['expense:business']),
      benefits: applyCustomOrder(sortByOrder(mergeRowsByTarget(buckets.benefits, describeExpenseKey), BENEFITS_ORDER), rowOrder['expense:benefits']),
      retirement: applyCustomOrder(sortByOrder(mergeRowsByTarget(buckets.retirement, describeExpenseKey), RETIREMENT_ORDER), rowOrder['expense:retirement']),
      unmapped: applyCustomOrder(buckets.unmapped, rowOrder['expense:unmapped']),
      hidden: applyCustomOrder(buckets.hidden, rowOrder['expense:unmapped']),
      healthInsurance: applyCustomOrder(sortByOrder(mergeRowsByTarget(buckets.healthInsurance, describeExpenseKey), BENEFITS_ORDER), rowOrder['expense:healthInsurance']),
    }

    return { expenseGroups: groups, absorbedOtherLabels: absorbed }
  }, [sections, pcrCategoryMappings, annualExpenses, settings.pcrRowOrder, settings.hiddenPcrLabels])

  // Splits Stipends and Other Income into mapped vs. unmapped, same parity as
  // Expenses -- otherwise an unmapped label just blends into the rest of the
  // table with no indication it's not feeding the PCR Audit / Compensation sync.
  const stipendGroups = useMemo(
    () => splitMappedUnmapped(
      sections.find((s) => s.key === 'stipend')?.rows ?? [], 'stipend', pcrCategoryMappings,
      settings.hiddenPcrLabels?.stipend ?? [], settings.pcrRowOrder ?? {}, 'stipend', 'stipend:unmapped',
      describeStipendGroupKey,
    ),
    [sections, pcrCategoryMappings, settings.pcrRowOrder, settings.hiddenPcrLabels],
  )
  const otherIncomeGroups = useMemo(
    () => splitMappedUnmapped(
      sections.find((s) => s.key === 'otherIncome')?.rows ?? [], 'otherIncome', pcrCategoryMappings,
      settings.hiddenPcrLabels?.otherIncome ?? [], settings.pcrRowOrder ?? {}, 'otherIncome', 'otherIncome:unmapped',
      (key) => key, // otherIncome targetKeys are already free-form category names
    ),
    [sections, pcrCategoryMappings, settings.pcrRowOrder, settings.hiddenPcrLabels],
  )

  function setHiddenLabels(section: 'stipend' | 'expense' | 'otherIncome', labels: string[]) {
    const current = settings.hiddenPcrLabels ?? { stipend: [], expense: [] }
    saveSettings({ ...settings, hiddenPcrLabels: { ...current, [section]: labels } })
  }
  function getHiddenLabels(section: 'stipend' | 'expense' | 'otherIncome'): string[] {
    return section === 'stipend' ? (settings.hiddenPcrLabels?.stipend ?? [])
      : section === 'expense' ? (settings.hiddenPcrLabels?.expense ?? [])
      : (settings.hiddenPcrLabels?.otherIncome ?? [])
  }
  function hideLabel(section: 'stipend' | 'expense' | 'otherIncome', label: string) {
    const current = getHiddenLabels(section)
    if (current.includes(label)) return
    setHiddenLabels(section, [...current, label])
  }
  function unhideLabel(section: 'stipend' | 'expense' | 'otherIncome', label: string) {
    setHiddenLabels(section, getHiddenLabels(section).filter((l) => l !== label))
  }

  // "PROFESSIONAL FEES" is extracted under section 'other' (it's printed
  // before any of STIPENDS/EXPENSES/OTHER PROFESSIONAL INCOME open), but it's
  // real per-month revenue, unlike the rest of that bucket (rolled-forward
  // balance, PCR surplus/deficit, etc.) -- promoted into Revenue instead of
  // staying buried in the collapsed Other section. Matched by exact label
  // text (case-insensitive) so it doesn't also catch "PROFESSIONAL REVENUES"
  // or "PROFESSIONAL REVENUES Less RESERVES", which are rollups, not raw fees.
  const professionalFeesGroup = useMemo(() => {
    const otherRows = sections.find((s) => s.key === 'other')?.rows ?? []
    const matches = otherRows.filter((r) => r.label.trim().toLowerCase() === 'professional fees')
    const labels = new Set(matches.map((r) => r.label))
    const rowOrder = settings.pcrRowOrder ?? {}
    const rows = applyCustomOrder(
      matches.map((r): OrderedRow => ({ id: r.label, row: r })),
      rowOrder['revenue:professionalFees'],
    )
    return { rows, labels }
  }, [sections, settings.pcrRowOrder])

  function toggleSection(key: string) {
    setOpenSections((o) => ({ ...o, [key]: !o[key] }))
  }

  const hasData = statementsForYear.length > 0

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-2">
        <h2 className="text-2xl font-bold text-gray-100">PCR Income Statement</h2>
        {years.length > 0 && (
          <select
            value={year}
            onChange={(e) => navigate(`/income-statement/${e.target.value}`)}
            className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>
      <p className="text-xs text-gray-600 mb-8">
        Reconstructed from every uploaded PCR's income-statement pages for {year} -- one column per month found,
        one row per line label. A blank cell means that label wasn't on that month's PCR at all (label wording can
        vary between report periods); a $0 cell means it was there but printed as zero. On smaller screens only the
        yearly total is shown per row -- switch to a wider screen for the monthly breakdown.
      </p>

      {!hasData ? (
        <p className="text-gray-500 text-sm">No PCR income-statement data found for {year}.</p>
      ) : (
        <div className="space-y-10">
          {(() => {
            const isEmpty = professionalFeesGroup.rows.length === 0
              && stipendGroups.mapped.length === 0 && stipendGroups.unmapped.length === 0 && stipendGroups.hidden.length === 0
              && otherIncomeGroups.mapped.length === 0 && otherIncomeGroups.unmapped.length === 0 && otherIncomeGroups.hidden.length === 0
            if (isEmpty) return null
            return (
              <section>
                <button
                  type="button"
                  onClick={() => toggleSection('revenue')}
                  className="w-full flex items-center justify-between gap-3 mb-1 text-left"
                >
                  <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Revenue</h3>
                  <svg
                    className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${openSections.revenue ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <p className="text-xs text-gray-600 mb-3">
                  Professional fees, per-assignment stipends, and other income, as reported on the PCR.
                </p>

                {openSections.revenue && (
                  <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                    {professionalFeesGroup.rows.length > 0 && (
                      <div className={`${CATEGORY_BLOCK_CLS} ${REVENUE_GROUP_META.professionalFees.border}`}>
                        <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3 ${REVENUE_GROUP_META.professionalFees.badge}`}>
                          {REVENUE_GROUP_META.professionalFees.title}
                        </span>
                        <AmountTable rows={professionalFeesGroup.rows} months={months} groupId="revenue:professionalFees" onReorder={handleReorder} />
                      </div>
                    )}
                    {(stipendGroups.mapped.length > 0 || stipendGroups.unmapped.length > 0 || stipendGroups.hidden.length > 0) && (
                      <div className={`${CATEGORY_BLOCK_CLS} ${REVENUE_GROUP_META.stipends.border} ${professionalFeesGroup.rows.length > 0 ? 'border-t border-gray-800' : ''}`}>
                        <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3 ${REVENUE_GROUP_META.stipends.badge}`}>
                          {REVENUE_GROUP_META.stipends.title}
                        </span>
                        <AmountTable rows={stipendGroups.mapped} months={months} groupId="stipend" onReorder={handleReorder} />
                        {(stipendGroups.unmapped.length > 0 || stipendGroups.hidden.length > 0) && (
                          <div className={`${NESTED_UNMAPPED_CLS} ${EXPENSE_GROUP_META.unmapped.border}`}>
                            <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3 ${EXPENSE_GROUP_META.unmapped.badge}`}>
                              {EXPENSE_GROUP_META.unmapped.title}
                            </span>
                            <AmountTable
                              rows={stipendGroups.unmapped} months={months} groupId="stipend:unmapped" onReorder={handleReorder}
                              onHideRow={(label) => hideLabel('stipend', label)}
                            />
                            <HiddenRowsToggle hidden={stipendGroups.hidden} onUnhide={(label) => unhideLabel('stipend', label)} />
                          </div>
                        )}
                      </div>
                    )}
                    {(otherIncomeGroups.mapped.length > 0 || otherIncomeGroups.unmapped.length > 0 || otherIncomeGroups.hidden.length > 0) && (
                      <div className={`${CATEGORY_BLOCK_CLS} border-t border-gray-800 ${REVENUE_GROUP_META.otherIncome.border}`}>
                        <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3 ${REVENUE_GROUP_META.otherIncome.badge}`}>
                          {REVENUE_GROUP_META.otherIncome.title}
                        </span>
                        <AmountTable rows={otherIncomeGroups.mapped} months={months} groupId="otherIncome" onReorder={handleReorder} />
                        {(otherIncomeGroups.unmapped.length > 0 || otherIncomeGroups.hidden.length > 0) && (
                          <div className={`${NESTED_UNMAPPED_CLS} ${EXPENSE_GROUP_META.unmapped.border}`}>
                            <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3 ${EXPENSE_GROUP_META.unmapped.badge}`}>
                              {EXPENSE_GROUP_META.unmapped.title}
                            </span>
                            <AmountTable
                              rows={otherIncomeGroups.unmapped} months={months} groupId="otherIncome:unmapped" onReorder={handleReorder}
                              onHideRow={(label) => hideLabel('otherIncome', label)}
                            />
                            <HiddenRowsToggle hidden={otherIncomeGroups.hidden} onUnhide={(label) => unhideLabel('otherIncome', label)} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )
          })()}

          {sections.filter((s) => s.key === 'expense' || s.key === 'other').map((section) => {
            const displayRows = section.key === 'other'
              ? section.rows.filter((r) => !absorbedOtherLabels.has(r.label) && !professionalFeesGroup.labels.has(r.label))
              : section.rows
            const orderedDisplayRows = applyCustomOrder(
              displayRows.map((r): OrderedRow => ({ id: r.label, row: r })),
              undefined,
            )
            const isEmpty = section.key === 'expense'
              ? Object.values(expenseGroups).every((rows) => rows.length === 0)
              : displayRows.length === 0
            if (isEmpty) return null

            return (
              <section key={section.key}>
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  className="w-full flex items-center justify-between gap-3 mb-1 text-left"
                >
                  <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">{section.title}</h3>
                  <svg
                    className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${openSections[section.key] ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <p className="text-xs text-gray-600 mb-3">{section.description}</p>

                {openSections[section.key] && (
                  <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                    {section.key === 'expense' ? (
                      <>
                        {expenseGroups.business.length > 0 && (
                          <div className={`${CATEGORY_BLOCK_CLS} ${EXPENSE_GROUP_META.business.border}`}>
                            <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3 ${EXPENSE_GROUP_META.business.badge}`}>
                              {EXPENSE_GROUP_META.business.title}
                            </span>
                            <AmountTable rows={expenseGroups.business} months={months} groupId="expense:business" onReorder={handleReorder} />
                          </div>
                        )}
                        {(expenseGroups.benefits.length > 0 || expenseGroups.healthInsurance.length > 0) && (
                          <div className={`${CATEGORY_BLOCK_CLS} border-t border-gray-800 ${EXPENSE_GROUP_META.benefits.border}`}>
                            <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3 ${EXPENSE_GROUP_META.benefits.badge}`}>
                              {EXPENSE_GROUP_META.benefits.title}
                            </span>
                            {expenseGroups.healthInsurance.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs text-gray-600 mb-2">Health Insurance</p>
                                <div className="pl-1.5 border-l md:pl-3 border-gray-800">
                                  <AmountTable rows={expenseGroups.healthInsurance} months={months} groupId="expense:healthInsurance" onReorder={handleReorder} />
                                </div>
                              </div>
                            )}
                            <AmountTable rows={expenseGroups.benefits} months={months} groupId="expense:benefits" onReorder={handleReorder} />
                          </div>
                        )}
                        {expenseGroups.retirement.length > 0 && (
                          <div className={`${CATEGORY_BLOCK_CLS} border-t border-gray-800 ${EXPENSE_GROUP_META.retirement.border}`}>
                            <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3 ${EXPENSE_GROUP_META.retirement.badge}`}>
                              {EXPENSE_GROUP_META.retirement.title}
                            </span>
                            <AmountTable rows={expenseGroups.retirement} months={months} groupId="expense:retirement" onReorder={handleReorder} />
                          </div>
                        )}
                        {(expenseGroups.unmapped.length > 0 || expenseGroups.hidden.length > 0) && (
                          <div className={`${CATEGORY_BLOCK_CLS} border-t border-gray-800 ${EXPENSE_GROUP_META.unmapped.border}`}>
                            <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3 ${EXPENSE_GROUP_META.unmapped.badge}`}>
                              {EXPENSE_GROUP_META.unmapped.title}
                            </span>
                            <AmountTable
                              rows={expenseGroups.unmapped} months={months} groupId="expense:unmapped" onReorder={handleReorder}
                              onHideRow={(label) => hideLabel('expense', label)}
                            />
                            <HiddenRowsToggle hidden={expenseGroups.hidden} onUnhide={(label) => unhideLabel('expense', label)} />
                          </div>
                        )}
                      </>
                    ) : (
                      <AmountTable rows={orderedDisplayRows} months={months} />
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
