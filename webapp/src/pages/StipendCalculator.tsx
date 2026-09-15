import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { useData } from '../context/DataContext'
import {
  getApplicableMapping, classifyStipendBase, getShiftStipendAmount,
  STIPEND_PROMOTABLE_BASE_KEYS, parseStipendPromotionKey, getStipendGroupKey, stipendPromotionKey,
} from '../utils/calculations'
import { formatCurrency, formatCurrencyFull, formatDateFull, getMonthName } from '../utils/dateUtils'
import { isOffDayShift, isWeekendOrHoliday, resolveShiftAlias, computeFederalHolidays } from '../utils/shiftUtils'
import { resolvePcrCategoryMapping } from '../utils/pcrCategoryMatching'

const CHART_STYLE = {
  contentStyle: { fontSize: 12, borderRadius: 8, border: '1px solid #1f2937', backgroundColor: '#111827', color: '#f3f4f6' },
  itemStyle: { color: '#f3f4f6' },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
}
const AXIS_PROPS = {
  tick: { fontSize: 11, fill: '#6b7280' },
  axisLine: false as const,
  tickLine: false as const,
}

// ─── Stipend group classification ────────────────────────────────────────────
// "otherG" and "other" are catch-all buckets. Individual (code, weekday/weekend)
// variants landing in either one can be "promoted" (via Settings.promotedStipendCodes)
// to their own column — see buildGroups() below, which inserts a column per promotion.

const BASE_GROUP_KEYS = ['mainOrCall', 'otherG', 'APS', 'BR', 'NIR', 'ROC', 'GI', 'FS', 'alhambra', 'other', 'additional'] as const
const PROMOTABLE_BASE_KEYS = STIPEND_PROMOTABLE_BASE_KEYS

const classifyBase = classifyStipendBase
const promotionKey = stipendPromotionKey
const parsePromotionKey = parseStipendPromotionKey
const getStipendGroup = getStipendGroupKey
const getShiftStipend = getShiftStipendAmount

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayDetail {
  date: string
  shift: string
  group: string
  isWeekend: boolean
  amount: number
}

interface MonthRow {
  year: number
  month: number          // display month (row label)
  sourceYear: number      // year the displayed amounts actually come from
  sourceMonth: number     // month the displayed amounts actually come from (differs from `month` in PCR view)
  amounts: Record<string, number>
  mappingName: string | null
  mappingId: string | null
  overrideId: string | null
  details: DayDetail[]
}

function emptyAmounts(): Record<string, number> {
  return Object.fromEntries(BASE_GROUP_KEYS.map((k) => [k, 0]))
}

// ─── Group metadata ───────────────────────────────────────────────────────────

interface GroupMeta {
  key: string
  label: string
  headerClass: string
  cellClass: string
  activeBg: string
  barColor: string
}

const BASE_GROUPS: GroupMeta[] = [
  { key: 'mainOrCall', label: 'G1/G2 Call',  headerClass: 'text-indigo-400',  cellClass: 'text-indigo-300',  activeBg: 'bg-indigo-900/20', barColor: '#818cf8' },
  { key: 'otherG',     label: 'Other G',      headerClass: 'text-violet-400',  cellClass: 'text-violet-300',  activeBg: 'bg-violet-900/20', barColor: '#a78bfa' },
  { key: 'APS',        label: 'APS',          headerClass: 'text-blue-400',    cellClass: 'text-blue-300',    activeBg: 'bg-blue-900/20',   barColor: '#60a5fa' },
  { key: 'BR',         label: 'BR',           headerClass: 'text-sky-400',     cellClass: 'text-sky-300',     activeBg: 'bg-sky-900/20',    barColor: '#38bdf8' },
  { key: 'NIR',        label: 'NIR',          headerClass: 'text-cyan-400',    cellClass: 'text-cyan-300',    activeBg: 'bg-cyan-900/20',   barColor: '#22d3ee' },
  { key: 'ROC',        label: 'ROC',          headerClass: 'text-teal-400',    cellClass: 'text-teal-300',    activeBg: 'bg-teal-900/20',   barColor: '#2dd4bf' },
  { key: 'GI',         label: 'GI/Endo',      headerClass: 'text-emerald-400', cellClass: 'text-emerald-300', activeBg: 'bg-emerald-900/20',barColor: '#34d399' },
  { key: 'FS',         label: 'FS',           headerClass: 'text-slate-400',   cellClass: 'text-slate-300',   activeBg: 'bg-slate-800/40',  barColor: '#94a3b8' },
  { key: 'alhambra',   label: 'Alhambra',     headerClass: 'text-orange-400',  cellClass: 'text-orange-300',  activeBg: 'bg-orange-900/20', barColor: '#fb923c' },
  { key: 'other',      label: 'Other',        headerClass: 'text-gray-500',    cellClass: 'text-gray-400',    activeBg: 'bg-gray-700/30',   barColor: '#6b7280' },
  { key: 'additional', label: 'Additional',   headerClass: 'text-gray-400',    cellClass: 'text-gray-300',    activeBg: 'bg-gray-700/30',   barColor: '#9ca3af' },
]

// Colors cycled through for promoted (user-configured standalone) columns
const PROMOTED_PALETTE: { headerClass: string; cellClass: string; activeBg: string; barColor: string }[] = [
  { headerClass: 'text-pink-400',     cellClass: 'text-pink-300',     activeBg: 'bg-pink-900/20',     barColor: '#f472b6' },
  { headerClass: 'text-lime-400',     cellClass: 'text-lime-300',     activeBg: 'bg-lime-900/20',     barColor: '#a3e635' },
  { headerClass: 'text-fuchsia-400',  cellClass: 'text-fuchsia-300',  activeBg: 'bg-fuchsia-900/20',  barColor: '#e879f9' },
  { headerClass: 'text-amber-400',    cellClass: 'text-amber-300',    activeBg: 'bg-amber-900/20',    barColor: '#fbbf24' },
  { headerClass: 'text-rose-400',     cellClass: 'text-rose-300',     activeBg: 'bg-rose-900/20',     barColor: '#fb7185' },
  { headerClass: 'text-yellow-400',   cellClass: 'text-yellow-300',   activeBg: 'bg-yellow-900/20',   barColor: '#facc15' },
]

// Inserts a column for each promoted (code, weekday/weekend) pair right after the
// catch-all bucket it was pulled from
function buildGroups(promotedKeys: string[]): GroupMeta[] {
  const groups = [...BASE_GROUPS]
  const sorted = [...promotedKeys].sort()
  sorted.forEach((promoKey, i) => {
    const parsed = parsePromotionKey(promoKey)
    if (!parsed) return // stale entry (not a valid composite key)
    const origin = classifyBase(parsed.code)
    if (!PROMOTABLE_BASE_KEYS.has(origin)) return // stale entry (code no longer resolves into a catch-all)
    const palette = PROMOTED_PALETTE[i % PROMOTED_PALETTE.length]
    const insertAt = groups.findIndex((g) => g.key === origin) + 1
    const label = `${parsed.code} (${parsed.isWeekend ? 'WE/Hol' : 'WD'})`
    groups.splice(insertAt, 0, { key: promoKey, label, ...palette })
  })
  return groups
}

function getDayOfWeek(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}

// ─── PCR match indicator (PCR view only) ─────────────────────────────────────
// A cell "matches" when a PCR income statement for that month has a mapped
// stipend line for this group and its paid amount is within a cent of the
// owed amount already shown in the cell -- same comparison Audits.tsx's PCR
// Stipend Audit makes, just surfaced inline instead of in a separate table.

type PcrMatchStatus = 'match' | 'mismatch'

// Tap/click-to-toggle popover instead of a hover-only title -- a native SVG
// <title> tooltip never shows on touch devices, so mobile had no way to see
// the paid/owed detail behind a mismatch badge.
function PcrMatchBadge({ status, paid, owed }: { status: PcrMatchStatus; paid: number; owed: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const isMatch = status === 'match'
  const message = isMatch
    ? `Matches PCR paid amount (${formatCurrency(paid)})`
    : `PCR paid ${formatCurrency(paid)}, differs from owed ${formatCurrency(owed)}`

  // A plain clickable <span>, not <button> -- this badge is used inside other
  // clickable rows/cells (including a <button> in the mobile card view), and
  // nesting a real button inside another button is invalid HTML.
  return (
    <span ref={ref} className="relative inline-flex">
      <span
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="flex items-center cursor-pointer"
      >
        <svg className={`w-3 h-3 flex-shrink-0 ${isMatch ? 'text-emerald-500' : 'text-amber-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isMatch
            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v3.75m0 3.75h.007M10.29 3.86L1.82 18a1.5 1.5 0 001.29 2.25h17.78a1.5 1.5 0 001.29-2.25L13.71 3.86a1.5 1.5 0 00-2.42 0z" />}
        </svg>
      </span>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-gray-950 border border-gray-700 rounded-lg shadow-xl text-[11px] text-gray-200 whitespace-nowrap"
        >
          {message}
        </div>
      )}
    </span>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function StipendCalculator() {
  const {
    reports, schedules: allSchedules, settings, stipendMappings: allMappings, saveReport, saveSettings,
    pcrIncomeStatements, pcrCategoryMappings,
  } = useData()

  const scheduleYears = allSchedules.flatMap((s) => s.entries.map((e) => parseInt(e.date.slice(0, 4))))
  const reportYears = reports.map((r) => r.year)
  const years = [...new Set([...scheduleYears, ...reportYears])].sort((a, b) => b - a)

  const [selectedYear, setSelectedYear] = useState<number>(years[0] ?? new Date().getFullYear())
  const [activeCell, setActiveCell] = useState<{ month: number; group: string } | null>(null)
  const [savingMonth, setSavingMonth] = useState<number | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'accrual' | 'pcr'>('accrual')

  const promoted = useMemo(() => new Set(settings.promotedStipendCodes ?? []), [settings.promotedStipendCodes])
  const groups = useMemo(() => buildGroups(settings.promotedStipendCodes ?? []), [settings.promotedStipendCodes])
  // Groups whose sub-table shows extra Shift + Day-of-week columns
  const detailGroups = useMemo(
    () => new Set(['mainOrCall', 'otherG', ...(settings.promotedStipendCodes ?? [])]),
    [settings.promotedStipendCodes],
  )

  // Distinct codes currently lumped into "Other G" / "Other" across all data — candidates for
  // promotion. Tracks whether each code has weekday and/or weekend/holiday occurrences so both
  // can be promoted independently.
  const promotableCodes = useMemo(() => {
    const map = new Map<string, { base: string; weekday: boolean; weekend: boolean }>()
    for (const sched of allSchedules) {
      for (const entry of sched.entries) {
        const year = parseInt(entry.date.slice(0, 4))
        const holidayList = settings.holidays[year] ?? computeFederalHolidays(year)
        const isWeekend = isWeekendOrHoliday(entry.date, holidayList)
        for (const raw of entry.shiftTypes) {
          if (isOffDayShift(raw)) continue
          const canonical = resolveShiftAlias(raw.toUpperCase())
          const base = classifyBase(canonical)
          if (!PROMOTABLE_BASE_KEYS.has(base)) continue
          const existing = map.get(canonical) ?? { base, weekday: false, weekend: false }
          if (isWeekend) existing.weekend = true
          else existing.weekday = true
          map.set(canonical, existing)
        }
      }
    }
    return map
  }, [allSchedules, settings.holidays])

  async function togglePromoted(key: string) {
    const current = new Set(settings.promotedStipendCodes ?? [])
    if (current.has(key)) current.delete(key)
    else current.add(key)
    await saveSettings({ ...settings, promotedStipendCodes: [...current] })
  }

  if (allSchedules.length === 0) {
    return (
      <div className="p-4 md:p-8 text-gray-500">
        No schedule uploaded yet. Upload a schedule to see stipend calculations.
      </div>
    )
  }

  const dateMap = new Map<string, string[]>()
  for (const sched of [...allSchedules].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))) {
    for (const entry of sched.entries) dateMap.set(entry.date, entry.shiftTypes)
  }

  const additionalByDate = new Map<string, number>()
  for (const report of reports) {
    for (const [date, amount] of Object.entries(report.dayStipends ?? {})) {
      additionalByDate.set(date, (additionalByDate.get(date) ?? 0) + amount)
    }
  }

  function getMonthEntries(year: number, month: number): [string, string[]][] {
    const prefix = `${year}-${String(month).padStart(2, '0')}-`
    return [...dateMap.entries()]
      .filter(([date, shiftTypes]) => date.startsWith(prefix) && shiftTypes.some((s) => !isOffDayShift(s)))
      .sort(([a], [b]) => a.localeCompare(b))
  }

  // Builds a row labeled `displayMonth` whose numbers come from (sourceYear, sourceMonth).
  // In Accrual view these are the same month; in PCR view sourceMonth is one behind.
  function buildRow(displayMonth: number, sourceYear: number, sourceMonth: number): { row: MonthRow; entryCount: number } {
    const entries = getMonthEntries(sourceYear, sourceMonth)
    const reportForMonth = reports.find((r) => r.year === sourceYear && r.month === sourceMonth)
    const monthKey = `${sourceYear}-${String(sourceMonth).padStart(2, '0')}`
    const overrideId = settings.stipendMappingOverrides?.[monthKey] ?? reportForMonth?.stipendMappingOverride ?? null
    const autoMapping = allMappings.length ? getApplicableMapping(sourceYear, sourceMonth, allMappings) : null
    const mapping = overrideId
      ? (allMappings.find((m) => m.id === overrideId) ?? autoMapping)
      : autoMapping
    const holidayList = settings.holidays[sourceYear] ?? computeFederalHolidays(sourceYear)

    const row: MonthRow = {
      year: selectedYear, month: displayMonth,
      sourceYear, sourceMonth,
      amounts: emptyAmounts(),
      mappingName: mapping ? (mapping.name || mapping.filename) : null,
      mappingId: mapping?.id ?? null,
      overrideId,
      details: [],
    }

    for (const [date, shiftTypes] of entries) {
      const isWeekend = isWeekendOrHoliday(date, holidayList)

      for (const raw of shiftTypes) {
        if (isOffDayShift(raw)) continue
        const canonical = resolveShiftAlias(raw.toUpperCase())
        const group = getStipendGroup(canonical, isWeekend, promoted)
        const amount = mapping ? getShiftStipend(raw, isWeekend, mapping) : 0
        row.amounts[group] = (row.amounts[group] ?? 0) + amount
        if (amount > 0) {
          row.details.push({ date, shift: canonical, group, isWeekend, amount })
        }
      }

      const addl = additionalByDate.get(date) ?? 0
      if (addl > 0) {
        const groupsOnDay = new Set(
          shiftTypes
            .filter(r => !isOffDayShift(r))
            .map(r => getStipendGroup(resolveShiftAlias(r.toUpperCase()), isWeekend, promoted))
        )
        const addlGroup = groupsOnDay.size === 1 ? [...groupsOnDay][0] : 'additional'
        row.amounts[addlGroup] = (row.amounts[addlGroup] ?? 0) + addl
        row.details.push({ date, shift: '—', group: addlGroup, isWeekend, amount: addl })
      }
    }

    return { row, entryCount: entries.length }
  }

  const rows: MonthRow[] = []
  for (let month = 1; month <= 12; month++) {
    if (viewMode === 'pcr') {
      // PCR view always shows all 12 calendar months, shifted one month back
      // (January pulls from December of the prior year) — even $0 rows appear.
      const sourceMonth = month === 1 ? 12 : month - 1
      const sourceYear = month === 1 ? selectedYear - 1 : selectedYear
      rows.push(buildRow(month, sourceYear, sourceMonth).row)
    } else {
      const { row, entryCount } = buildRow(month, selectedYear, month)
      const total = Object.values(row.amounts).reduce((s, v) => s + v, 0)
      if (total > 0 || entryCount > 0) rows.push(row)
    }
  }

  // PCR-paid amounts per (display month -> group -> amount), from mapped stipend
  // lines on that month's own PCR income statement -- the display month's PCR
  // is the one reporting the source (prior) month's stipends as paid. Used to
  // show a per-cell match/mismatch indicator, PCR view only.
  const pcrPaidByMonth = new Map<number, Record<string, number>>()
  if (viewMode === 'pcr') {
    for (const stmt of pcrIncomeStatements) {
      if (stmt.year !== selectedYear) continue
      const paid: Record<string, number> = {}
      for (const line of stmt.lines) {
        if (line.section !== 'stipend') continue
        const mapping = resolvePcrCategoryMapping(line.label, 'stipend', pcrCategoryMappings)
        if (!mapping) continue
        paid[mapping.targetKey] = (paid[mapping.targetKey] ?? 0) + line.amount
      }
      pcrPaidByMonth.set(stmt.month, paid)
    }
  }

  function getPcrStatus(month: number, group: string, owed: number): PcrMatchStatus | null {
    const paidMap = pcrPaidByMonth.get(month)
    if (!paidMap || !(group in paidMap)) return null
    return Math.abs(paidMap[group] - owed) <= 0.01 ? 'match' : 'mismatch'
  }

  function getPcrPaid(month: number, group: string): number {
    return pcrPaidByMonth.get(month)?.[group] ?? 0
  }

  const totals = groups.reduce((acc, g) => {
    acc[g.key] = rows.reduce((s, r) => s + (r.amounts[g.key] ?? 0), 0)
    return acc
  }, {} as Record<string, number>)

  const rowTotal = (r: MonthRow) => Object.values(r.amounts).reduce((s, v) => s + v, 0)
  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0)
  // A group with zero owed everywhere still needs a column if a PCR paid amount
  // exists for it in some month with nothing owed to offset it against — e.g.
  // no NIR shifts worked but the PCR still paid out $1,500 for NIR that month.
  const visibleGroups = groups.filter((g) =>
    rows.some((r) => (r.amounts[g.key] ?? 0) > 0) ||
    (viewMode === 'pcr' && rows.some((r) => getPcrStatus(r.month, g.key, r.amounts[g.key] ?? 0) === 'mismatch'))
  )

  const mappingNames = [...new Set(rows.map((r) => r.mappingName).filter(Boolean))]
  const footerMappingLabel = mappingNames.length === 1 ? mappingNames[0] : mappingNames.length > 1 ? 'varies' : null

  const toggleCell = (month: number, group: string) => {
    setActiveCell((prev) =>
      prev?.month === month && prev?.group === group ? null : { month, group }
    )
  }

  // displayMonth identifies which row's select is saving; sourceYear/sourceMonth is what
  // actually gets the override (in PCR view these differ from displayMonth/selectedYear).
  async function handleOverrideChange(displayMonth: number, sourceYear: number, sourceMonth: number, mappingId: string) {
    const monthKey = `${sourceYear}-${String(sourceMonth).padStart(2, '0')}`
    setSavingMonth(displayMonth)
    try {
      const overrides = { ...(settings.stipendMappingOverrides ?? {}) }
      if (mappingId) {
        overrides[monthKey] = mappingId
      } else {
        delete overrides[monthKey]
      }
      await saveSettings({ ...settings, stipendMappingOverrides: overrides })

      // Also update the report's override field if a report exists (keeps them in sync)
      const report = reports.find((r) => r.year === sourceYear && r.month === sourceMonth)
      if (report) {
        await saveReport({ ...report, stipendMappingOverride: mappingId || undefined })
      }
    } finally {
      setSavingMonth(null)
    }
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-100">Stipend Calculator</h2>
        {years.length > 1 && (
          <div className="flex gap-2 ml-4">
            {years.map((y) => (
              <button key={y} onClick={() => { setSelectedYear(y); setActiveCell(null) }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  y === selectedYear ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}>
                {y}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-md p-0.5">
          {(['accrual', 'pcr'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => { setViewMode(mode); setActiveCell(null) }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === mode ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {mode === 'accrual' ? 'Accrual' : 'PCR'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setConfigOpen((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            configOpen ? 'border-indigo-600 text-indigo-400 bg-indigo-600/10' : 'border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Columns
        </button>
      </div>

      {configOpen && (
        <div className="mb-5 bg-gray-900 border border-gray-800 rounded-xl p-4 max-w-lg">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Standalone Columns</h3>
          <p className="text-xs text-gray-600 mb-3">
            Codes below are currently lumped into "Other G" or "Other". Weekday and weekend/holiday
            occurrences can be broken out independently.
          </p>
          {promotableCodes.size === 0 ? (
            <p className="text-xs text-gray-600">No lumped shift codes found in your data — nothing to configure yet.</p>
          ) : (
            <div className="space-y-3">
              {(['otherG', 'other'] as const).map((bucket) => {
                const codes = [...promotableCodes.entries()]
                  .filter(([, info]) => info.base === bucket)
                  .map(([code]) => code)
                  .sort()
                if (codes.length === 0) return null
                return (
                  <div key={bucket}>
                    <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">
                      {bucket === 'otherG' ? 'Other G' : 'Other'}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {codes.map((code) => {
                        const info = promotableCodes.get(code)!
                        return (
                          <div key={code} className="flex items-center gap-1">
                            <span className="text-xs text-gray-500 mr-0.5">{code}</span>
                            {(['weekday', 'weekend'] as const).map((variant) => {
                              const present = variant === 'weekday' ? info.weekday : info.weekend
                              if (!present) return null
                              const key = promotionKey(code, variant === 'weekend')
                              const isPromoted = promoted.has(key)
                              return (
                                <button
                                  key={variant}
                                  onClick={() => togglePromoted(key)}
                                  title={`${code} — ${variant === 'weekend' ? 'Weekend/Holiday' : 'Weekday'}`}
                                  className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                                    isPromoted
                                      ? 'bg-indigo-600/20 border-indigo-600 text-indigo-300'
                                      : 'border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
                                  }`}
                                >
                                  {variant === 'weekend' ? 'WE/Hol' : 'WD'}
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {allMappings.length === 0 && (
        <div className="flex items-center gap-2 mb-5 px-3 py-2 bg-amber-900/20 border border-amber-800/40 rounded-lg w-fit">
          <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs text-amber-400">No stipend rate schedule uploaded — rate-based columns will show $0</span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-gray-500 text-sm">No scheduled shifts found for {selectedYear}.</p>
      ) : (
        <>
        {/* ── Bar chart ──────────────────────────────────────────────────────── */}
        {rows.length > 1 && (() => {
          const chartData = rows.map(row => ({
            month: getMonthName(row.month).slice(0, 3),
            ...Object.fromEntries(visibleGroups.map(g => [g.key, row.amounts[g.key] ?? 0])),
          }))
          const avg = grandTotal / rows.length

          return (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 className="text-sm font-semibold text-gray-300">Monthly Stipend Breakdown</h3>
                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {visibleGroups.map(g => (
                    <span key={g.key} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: g.barColor }} />
                      {g.label}
                    </span>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={44} />
                  <Tooltip
                    {...CHART_STYLE}
                    formatter={(v: number, name: string) => {
                      const g = groups.find(g => g.key === name)
                      return [formatCurrencyFull(v), g?.label ?? name]
                    }}
                  />
                  <ReferenceLine
                    y={avg}
                    stroke="#374151"
                    strokeDasharray="4 2"
                    label={{ value: `Avg ${formatCurrency(avg)}`, fill: '#6b7280', fontSize: 10, position: 'right' }}
                  />
                  {visibleGroups.map((g, i) => (
                    <Bar
                      key={g.key}
                      dataKey={g.key}
                      stackId="a"
                      fill={g.barColor}
                      radius={i === visibleGroups.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )
        })()}

        {/* ── Mobile card view ───────────────────────────────────────────────── */}
        <div className="md:hidden space-y-3 mb-3">
          {rows.map((row) => {
            const total = rowTotal(row)
            const isRowExpanded = activeCell?.month === row.month
            const expandedGroup = isRowExpanded ? activeCell!.group : null
            const nonZeroGroups = visibleGroups.filter((g) =>
              (row.amounts[g.key] ?? 0) > 0 ||
              (viewMode === 'pcr' && getPcrStatus(row.month, g.key, row.amounts[g.key] ?? 0) === 'mismatch')
            )

            return (
              <div key={`${row.year}-${row.month}`} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                {/* Month + Total header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                  <span className="font-semibold text-gray-200">
                    {getMonthName(row.month)}
                    {viewMode === 'pcr' && (
                      <span className="ml-1.5 text-[10px] font-normal text-gray-600">
                        ({getMonthName(row.sourceMonth).slice(0, 3)}{row.sourceYear !== selectedYear ? ` ${row.sourceYear}` : ''} data)
                      </span>
                    )}
                  </span>
                  <span className="text-emerald-400 font-bold text-base">{formatCurrencyFull(total)}</span>
                </div>

                {/* Group breakdown */}
                <div className="px-3 py-2 space-y-0.5">
                  {nonZeroGroups.map((g) => {
                    const isActive = expandedGroup === g.key
                    const detailRows = row.details.filter((d) => d.group === g.key).sort((a, b) => a.date.localeCompare(b.date))
                    const cellValue = row.amounts[g.key] ?? 0
                    const pcrStatus = viewMode === 'pcr' ? getPcrStatus(row.month, g.key, cellValue) : null
                    return (
                      <div key={g.key}>
                        <button
                          onClick={() => toggleCell(row.month, g.key)}
                          className={`w-full flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors ${isActive ? g.activeBg : 'hover:bg-gray-800/50'}`}
                        >
                          <span className="text-xs text-gray-500">{g.label}</span>
                          <span className={`inline-flex items-center gap-1 text-sm font-medium ${g.cellClass} ${isActive ? 'underline underline-offset-2' : ''}`}>
                            {formatCurrencyFull(cellValue)}
                            {pcrStatus && <PcrMatchBadge status={pcrStatus} paid={getPcrPaid(row.month, g.key)} owed={cellValue} />}
                          </span>
                        </button>
                        {/* Inline detail panel */}
                        {isActive && detailRows.length > 0 && (() => {
                          const showExtra = detailGroups.has(g.key)
                          return (
                            <div className={`mt-1 mb-1 rounded-lg border border-gray-700/50 overflow-hidden ${g.activeBg}`}>
                              <table className="text-xs w-full">
                                <tbody>
                                  {detailRows.map((d, i) => (
                                    <tr key={i} className="border-b border-gray-700/30 last:border-0">
                                      <td className="px-3 py-1.5 text-gray-300 whitespace-nowrap">{formatDateFull(d.date)}</td>
                                      {showExtra && <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap font-medium">{d.shift}</td>}
                                      {showExtra && <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{getDayOfWeek(d.date)}</td>}
                                      <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{d.isWeekend ? 'WE/Hol' : 'WD'}</td>
                                      <td className={`px-3 py-1.5 text-right font-semibold whitespace-nowrap ${g.cellClass}`}>{formatCurrencyFull(d.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t border-gray-700/50">
                                    <td className="px-3 py-1.5 text-gray-500 font-semibold">{detailRows.length} shift{detailRows.length !== 1 ? 's' : ''}</td>
                                    {showExtra && <td />}
                                    {showExtra && <td />}
                                    <td />
                                    <td className={`px-3 py-1.5 text-right font-bold whitespace-nowrap ${g.cellClass}`}>
                                      {formatCurrencyFull(detailRows.reduce((s, d) => s + d.amount, 0))}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>

                {/* Rate Schedule */}
                {allMappings.length > 0 && (
                  <div className="flex items-center gap-1.5 px-4 py-2.5 border-t border-gray-800">
                    <span className="text-[10px] text-gray-600 uppercase tracking-wider">Rate</span>
                    {row.overrideId && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Manual override active" />}
                    <select
                      value={row.overrideId ?? ''}
                      disabled={savingMonth === row.month}
                      onChange={(e) => handleOverrideChange(row.month, row.sourceYear, row.sourceMonth, e.target.value)}
                      className="bg-transparent text-xs text-gray-400 border-0 outline-none cursor-pointer hover:text-gray-200 focus:text-gray-200 min-w-0 flex-1 truncate disabled:opacity-40"
                    >
                      <option value="">Auto — {row.overrideId ? (allMappings.find(m => m.id === getApplicableMapping(row.sourceYear, row.sourceMonth, allMappings)?.id)?.name ?? '—') : (row.mappingName ?? '—')}</option>
                      {allMappings.map((m) => (
                        <option key={m.id} value={m.id}>{m.name || m.filename}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )
          })}

          {/* Year total summary card */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-300">{selectedYear} Total</span>
            <span className="text-emerald-400 font-bold text-base">{formatCurrencyFull(grandTotal)}</span>
          </div>
        </div>

        {/* ── Desktop table ───────────────────────────────────────────────────── */}
        <div className="hidden md:block bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider sticky left-0 z-10 bg-gray-900">
                    Month
                  </th>
                  {visibleGroups.map((g) => (
                    <th key={g.key} className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${g.headerClass}`}>
                      {g.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-emerald-500 uppercase tracking-wider whitespace-nowrap">
                    Total
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                    Rate Schedule
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const total = rowTotal(row)
                  const isRowExpanded = activeCell?.month === row.month
                  const expandedGroup = isRowExpanded ? activeCell!.group : null
                  const expandedGroupMeta = visibleGroups.find((g) => g.key === expandedGroup)
                  const detailRows = expandedGroup
                    ? row.details.filter((d) => d.group === expandedGroup).sort((a, b) => a.date.localeCompare(b.date))
                    : []
                  const colSpan = visibleGroups.length + 3

                  return (
                    <Fragment key={`${row.year}-${row.month}`}>
                      <tr className="group border-b border-gray-800 hover:bg-gray-800">
                        <td className="px-4 py-3 font-medium text-gray-200 sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800">
                          {getMonthName(row.month)}
                          {viewMode === 'pcr' && (
                            <span className="ml-1.5 text-[10px] font-normal text-gray-600">
                              ({getMonthName(row.sourceMonth).slice(0, 3)}{row.sourceYear !== selectedYear ? ` ${row.sourceYear}` : ''} data)
                            </span>
                          )}
                        </td>
                        {visibleGroups.map((g) => {
                          const isActive = expandedGroup === g.key
                          const value = row.amounts[g.key] ?? 0
                          const hasValue = value > 0
                          const pcrStatus = viewMode === 'pcr' ? getPcrStatus(row.month, g.key, value) : null
                          return (
                            <td
                              key={g.key}
                              onClick={() => hasValue ? toggleCell(row.month, g.key) : undefined}
                              className={`px-4 py-3 text-right transition-colors ${
                                hasValue ? 'cursor-pointer' : ''
                              } ${isActive ? g.activeBg : ''} ${hasValue ? g.cellClass : 'text-gray-700'}`}
                            >
                              <span className={`inline-flex items-center gap-1 ${hasValue && isActive ? 'underline underline-offset-2' : ''}`}>
                                {hasValue ? formatCurrencyFull(value) : '—'}
                                {pcrStatus && <PcrMatchBadge status={pcrStatus} paid={getPcrPaid(row.month, g.key)} owed={value} />}
                              </span>
                            </td>
                          )
                        })}
                        <td className="px-4 py-3 text-right font-semibold text-emerald-400">
                          {formatCurrencyFull(total)}
                        </td>
                        <td className="px-4 py-3 text-left">
                          {allMappings.length > 0 ? (
                            <div className="flex items-center gap-1.5">
                              {row.overrideId && (
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Manual override active" />
                              )}
                              <select
                                value={row.overrideId ?? ''}
                                disabled={savingMonth === row.month}
                                onChange={(e) => handleOverrideChange(row.month, row.sourceYear, row.sourceMonth, e.target.value)}
                                className="bg-transparent text-xs text-gray-400 border-0 outline-none cursor-pointer hover:text-gray-200 focus:text-gray-200 max-w-[140px] truncate disabled:opacity-40"
                              >
                                <option value="">Auto — {row.overrideId ? (allMappings.find(m => m.id === getApplicableMapping(row.sourceYear, row.sourceMonth, allMappings)?.id)?.name ?? '—') : (row.mappingName ?? '—')}</option>
                                {allMappings.map((m) => (
                                  <option key={m.id} value={m.id}>{m.name || m.filename}</option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-600">{row.mappingName ?? '—'}</span>
                          )}
                        </td>
                      </tr>

                      {/* Sub-row detail — sticky left so it's visible on mobile scroll */}
                      {isRowExpanded && expandedGroupMeta && detailRows.length > 0 && (() => {
                        const showExtra = detailGroups.has(expandedGroup as string)
                        return (
                          <tr className={`border-b border-gray-800 ${expandedGroupMeta.activeBg}`}>
                            <td colSpan={colSpan} className="p-0">
                              <div className={`sticky left-0 w-fit px-4 py-3 ${showExtra ? 'max-w-[min(calc(100vw-2rem),540px)]' : 'max-w-[min(calc(100vw-2rem),420px)]'}`}>
                                {/* Panel header */}
                                <div className="flex items-center justify-between mb-2 gap-4">
                                  <p className={`text-xs font-semibold uppercase tracking-wider ${expandedGroupMeta.headerClass}`}>
                                    {getMonthName(row.month)} — {expandedGroupMeta.label}
                                  </p>
                                  <button
                                    onClick={() => setActiveCell(null)}
                                    className="text-gray-600 hover:text-gray-300 text-xs leading-none"
                                    aria-label="Close detail"
                                  >
                                    ✕
                                  </button>
                                </div>
                                {/* Detail table */}
                                <div className={`rounded-lg border border-gray-700/50 overflow-hidden ${expandedGroupMeta.activeBg}`}>
                                  <table className="text-xs w-full">
                                    <thead>
                                      <tr className="border-b border-gray-700/50">
                                        <th className="px-3 py-1.5 text-left text-gray-600 font-semibold uppercase tracking-wider whitespace-nowrap">Date</th>
                                        {showExtra && <th className="px-3 py-1.5 text-left text-gray-600 font-semibold uppercase tracking-wider whitespace-nowrap">Shift</th>}
                                        {showExtra && <th className="px-3 py-1.5 text-left text-gray-600 font-semibold uppercase tracking-wider whitespace-nowrap">DOW</th>}
                                        <th className="px-3 py-1.5 text-left text-gray-600 font-semibold uppercase tracking-wider whitespace-nowrap">Day</th>
                                        <th className="px-3 py-1.5 text-right text-gray-600 font-semibold uppercase tracking-wider whitespace-nowrap">Amount</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detailRows.map((d, i) => (
                                        <tr key={i} className="border-b border-gray-700/30 last:border-0">
                                          <td className="px-3 py-1.5 text-gray-300 whitespace-nowrap">{formatDateFull(d.date)}</td>
                                          {showExtra && <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap font-medium">{d.shift}</td>}
                                          {showExtra && <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{getDayOfWeek(d.date)}</td>}
                                          <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{d.isWeekend ? 'WE/Hol' : 'WD'}</td>
                                          <td className={`px-3 py-1.5 text-right font-semibold whitespace-nowrap ${expandedGroupMeta.cellClass}`}>
                                            {formatCurrencyFull(d.amount)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t border-gray-700/50">
                                        <td className="px-3 py-1.5 text-gray-500 font-semibold">{detailRows.length} shift{detailRows.length !== 1 ? 's' : ''}</td>
                                        {showExtra && <td />}
                                        {showExtra && <td />}
                                        <td />
                                        <td className={`px-3 py-1.5 text-right font-bold whitespace-nowrap ${expandedGroupMeta.cellClass}`}>
                                          {formatCurrencyFull(detailRows.reduce((s, d) => s + d.amount, 0))}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )
                      })()}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-800 border-t border-gray-700 font-semibold">
                  <td className="px-4 py-3 text-gray-300 sticky left-0 z-10 bg-gray-800">
                    {selectedYear} Total
                  </td>
                  {visibleGroups.map((g) => (
                    <td key={g.key} className={`px-4 py-3 text-right ${totals[g.key] > 0 ? g.cellClass : 'text-gray-600'}`}>
                      {totals[g.key] > 0 ? formatCurrencyFull(totals[g.key]) : '—'}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right text-emerald-400">
                    {formatCurrencyFull(grandTotal)}
                  </td>
                  <td className="px-4 py-3 text-left text-xs text-gray-600">
                    {footerMappingLabel ?? '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        </>
      )}
    </div>
  )
}
