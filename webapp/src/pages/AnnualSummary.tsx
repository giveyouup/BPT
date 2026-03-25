import { useState, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { exportShiftAnalytics, exportMonthBreakdown } from '../utils/exportXlsx'
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useData } from '../context/DataContext'
import { computeCalendarYearStats, getStipendForDay, getApplicableMapping } from '../utils/calculations'
import {
  formatCurrency, formatCurrencyFull, formatDateFull, formatHours, formatMonthYear, getMonthName, MONTH_ABBREVS,
} from '../utils/dateUtils'
import StatCard from '../components/StatCard'
import { isOffDayShift, isFixedShift, getFixedHours, isCallShift, resolveShiftAlias, computeFederalHolidays, isVacationShift, isHolidayOffShift, isPostcallShift, shiftBadgeClass } from '../utils/shiftUtils'
import type { MonthlyStats, StipendMapping } from '../types'

function shiftSortKey(shift: string): string {
  const u = shift.toUpperCase()
  const gMatch = u.match(/^G(\d+)(?:\s+(WD|WE))?$/)
  if (gMatch) return `0_${gMatch[1].padStart(3, '0')}_${gMatch[2] === 'WE' ? '1' : '0'}`
  if (u.startsWith('FS')) return `1_${(u.match(/^FS(\d*)/)?.[1] ?? '').padStart(3, '0')}_${u}`
  if (u === 'NIR') return '2_0'
  if (u === 'BR')  return '2_1'
  if (u === 'APS') return '2_2'
  if (u === 'GI')  return '2_3'
  return `3_${u}`
}

function shiftBarColor(shift: string): string {
  const u = shift.toUpperCase()
  if (/^G\d/.test(u)) return u.endsWith('WE') ? '#e11d48' : '#fb7185'
  if (u.startsWith('FS')) return '#fbbf24'
  return '#a78bfa'
}

const CHART_STYLE = {
  contentStyle: {
    fontSize: 12, borderRadius: 8,
    border: '1px solid #1f2937', backgroundColor: '#111827', color: '#f3f4f6',
  },
  itemStyle: { color: '#f3f4f6' },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
}
const AXIS_PROPS = {
  tick: { fontSize: 11, fill: '#6b7280' },
  axisLine: false as const,
  tickLine: false as const,
}

type ShiftRow = {
  shift: string; days: number
  avgHours: number | null; avgUnits: number
  avgDollarPerHr: number | null; totalPay: number
  isFixed: boolean
}

function shiftKey(canonical: string, isCallWeekend: boolean, shiftHours: Record<string, number>): string {
  return (!isFixedShift(canonical, shiftHours) && isCallShift(canonical))
    ? `${canonical} ${isCallWeekend ? 'WE' : 'WD'}`
    : canonical
}

function buildShiftStats(stats: MonthlyStats[], cutoff: string | null, allMappings: StipendMapping[], shiftHours: Record<string, number>, unitRateOverride: number | null = null): ShiftRow[] {
  type Entry = { hours: number; days: number; units: number; pay: number }
  const map = new Map<string, Entry>()

  function entry(key: string): Entry {
    if (!map.has(key)) map.set(key, { hours: 0, days: 0, units: 0, pay: 0 })
    return map.get(key)!
  }

  for (const month of stats) {
    // Find the applicable stipend mapping for this month (same logic as computeCalendarMonthStats)
    const applicableMapping = getApplicableMapping(month.year, month.month, allMappings)

    for (const day of month.workingDays) {
      if (day.shiftTypes.length === 0) continue
      if (cutoff && day.date > cutoff) continue

      // When a unit rate override is active, scale unit pay accordingly
      const effectiveUnitPay = unitRateOverride != null
        ? day.totalUnits * unitRateOverride
        : day.unitPay
      const effectiveTotalDayPay = effectiveUnitPay + day.stipendAmount + day.additionalStipend

      const fixedShifts   = day.shiftTypes.filter(s => !isOffDayShift(s) &&  isFixedShift(resolveShiftAlias(s.toUpperCase()), shiftHours))
      const primaryShifts = day.shiftTypes.filter(s => !isOffDayShift(s) && !isFixedShift(resolveShiftAlias(s.toUpperCase()), shiftHours))
      const isSharedDay   = fixedShifts.length > 0 && primaryShifts.length > 0

      if (isSharedDay) {
        // Total stipend belonging to fixed shifts only
        const fixedStipendTotal = getStipendForDay(fixedShifts, day.isCallWeekend, applicableMapping)
        // Primary pay = effectiveTotalDayPay minus fixed stipends, split evenly if multiple primaries
        const primaryPayEach = (effectiveTotalDayPay - fixedStipendTotal) / primaryShifts.length
        const primaryUnitsEach = day.totalUnits / primaryShifts.length

        // Primary shifts: full hours + days credit, units and pay minus fixed stipends
        for (const rawSt of primaryShifts) {
          const canonical = resolveShiftAlias(rawSt.toUpperCase())
          const e = entry(shiftKey(canonical, day.isCallWeekend, shiftHours))
          e.days++
          e.hours += day.hours
          e.units += primaryUnitsEach
          e.pay   += primaryPayEach
        }

        // Fixed shifts: stipend added to pay only — no days, hours, or units
        for (const rawSt of fixedShifts) {
          const canonical = resolveShiftAlias(rawSt.toUpperCase())
          const e = entry(canonical)
          e.pay += getStipendForDay([rawSt], day.isCallWeekend, applicableMapping)
        }
      } else {
        // Solo day: attribute everything to each shift
        for (const rawSt of day.shiftTypes) {
          if (isOffDayShift(rawSt)) continue
          const canonical = resolveShiftAlias(rawSt.toUpperCase())
          const e = entry(shiftKey(canonical, day.isCallWeekend, shiftHours))
          e.days++
          e.hours += day.hours
          e.units += day.totalUnits
          e.pay   += effectiveTotalDayPay
        }
      }
    }
  }

  return [...map.entries()]
    .map(([shift, { hours, days, units, pay }]) => ({
      shift, days,
      avgHours: days > 0 && hours > 0 ? Math.round((hours / days) * 10) / 10 : null,
      avgUnits: days > 0 ? Math.round((units / days) * 100) / 100 : 0,
      avgDollarPerHr: hours > 0 ? Math.round(pay / hours) : null,
      totalPay: pay,
      isFixed: isFixedShift(shift, shiftHours),
    }))
    .sort((a, b) => shiftSortKey(a.shift).localeCompare(shiftSortKey(b.shift)))
}

function deltaLabel(actual: number, projected: number): string {
  const diff = projected - actual
  return (diff >= 0 ? '+' : '') + formatCurrency(diff)
}

const FIXED_BAR_COLOR = '#475569'
const ET_BAR_GAP = 3

type BucketDayRecord = { stats: import('../types').WorkingDayStats; endTime: string; isFixed: boolean }

function minsToTimeStr(mins: number): string {
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function VarBarShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: EndTimeBucket }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props
  if (height <= 0 || !payload) return null
  // Expand to full category width when this bucket has no fixed shifts
  const w = payload.fixedCount > 0 ? width : width * 2 + ET_BAR_GAP
  return <rect x={x} y={y} width={Math.max(w, 0)} height={height} fill={payload.color} rx={4} ry={4} />
}

function FixedBarShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: EndTimeBucket }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props
  if (!payload?.fixedCount || height <= 0) return null
  return <rect x={x} y={y} width={width} height={height} fill={FIXED_BAR_COLOR} rx={4} ry={4} />
}

type EndTimeBucket = {
  label: string; color: string
  count: number; shiftCounts: Record<string, number>
  fixedCount: number; fixedShiftCounts: Record<string, number>
  varDays: BucketDayRecord[]; fixedDays: BucketDayRecord[]
}

function EndTimeTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: EndTimeBucket; dataKey: string }> }) {
  if (!active || !payload?.length) return null
  const { label, count, shiftCounts, fixedCount, fixedShiftCounts, color } = payload[0].payload
  const varEntries  = Object.entries(shiftCounts).sort((a, b) => b[1] - a[1])
  const fixEntries  = Object.entries(fixedShiftCounts).sort((a, b) => b[1] - a[1])
  const section = (title: string, titleColor: string, days: number, entries: [string, number][]) => (
    <div style={{ marginBottom: 6 }}>
      <p style={{ color: titleColor, fontWeight: 600, marginBottom: 2 }}>{title} — {days} day{days !== 1 ? 's' : ''}</p>
      {entries.map(([shift, n]) => (
        <div key={shift} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, paddingLeft: 8 }}>
          <span style={{ color: '#9ca3af' }}>{shift}</span>
          <span style={{ color: '#d1d5db' }}>{n}×</span>
        </div>
      ))}
    </div>
  )
  return (
    <div style={{ fontSize: 12, borderRadius: 8, border: '1px solid #1f2937', backgroundColor: '#111827', color: '#f3f4f6', padding: '8px 12px', minWidth: 150 }}>
      <p style={{ color, fontWeight: 700, marginBottom: 6 }}>{label}</p>
      {count > 0 && section('Variable', color, count, varEntries)}
      {fixedCount > 0 && section('Fixed', FIXED_BAR_COLOR, fixedCount, fixEntries)}
    </div>
  )
}

export default function AnnualSummary() {
  const [hoursView, setHoursView] = useState<'month' | 'week'>('month')
  const [expandedShift, setExpandedShift] = useState<string | null>(
    (window.history.state?.usr as { selectedBucketIdx?: number; expandedShift?: string } | null)?.expandedShift ?? null
  )
  const [shiftTab, setShiftTab] = useState<'hours' | 'dollars'>('hours')
  const [shiftSort, setShiftSort] = useState<{ col: string; dir: 1 | -1 }>({ col: 'shift', dir: 1 })
  const [whatIfMappingId, setWhatIfMappingId] = useState<string | null>(null)
  const [whatIfUnitRate, setWhatIfUnitRate] = useState<number | null>(null)
  const [showWhatIfPopover, setShowWhatIfPopover] = useState(false)
  const [showWeeksPopover, setShowWeeksPopover] = useState(false)
  const [showExcludedPopover, setShowExcludedPopover] = useState(false)
  const [selectedBucketIdx, setSelectedBucketIdx] = useState<number | null>(
    (window.history.state?.usr as { selectedBucketIdx?: number } | null)?.selectedBucketIdx ?? null
  )
  const [showYoY, setShowYoY] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const weeksPopoverRef = useRef<HTMLDivElement>(null)
  const excludedPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showWhatIfPopover) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node))
        setShowWhatIfPopover(false)
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowWhatIfPopover(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [showWhatIfPopover])

  useEffect(() => {
    if (!showWeeksPopover) return
    const handler = (e: MouseEvent) => {
      if (weeksPopoverRef.current && !weeksPopoverRef.current.contains(e.target as Node))
        setShowWeeksPopover(false)
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowWeeksPopover(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [showWeeksPopover])

  useEffect(() => {
    if (!showExcludedPopover) return
    const handler = (e: MouseEvent) => {
      if (excludedPopoverRef.current && !excludedPopoverRef.current.contains(e.target as Node))
        setShowExcludedPopover(false)
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowExcludedPopover(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler) }
  }, [showExcludedPopover])

  const { year: yearParam } = useParams<{ year: string }>()
  const navigate = useNavigate()

  const { reports, schedules: allSchedules, settings, stipendMappings: allMappings } = useData()
  const years = [...new Set(reports.map((r) => r.year))].sort((a, b) => b - a)
  const year = yearParam ? parseInt(yearParam) : years[0]

  // ── Memoized stats (must be before early return to satisfy rules of hooks) ─
  const yearStats = useMemo(
    () => year ? computeCalendarYearStats(year, reports, allSchedules, settings, allMappings) : [],
    [year, reports, allSchedules, settings, allMappings]
  )

  // Restore scroll position when returning via browser back — wait for content to render
  const scrollRestored = useRef(false)
  useEffect(() => {
    if (scrollRestored.current || yearStats.length === 0) return
    const savedScrollY = (window.history.state?.usr as { scrollY?: number } | null)?.scrollY
    if (savedScrollY == null) return
    scrollRestored.current = true
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: savedScrollY, behavior: 'instant' })))
  }, [yearStats])

  // ── YoY stats for all years (for comparison view) ─────────────────────────
  const allYearStats = useMemo(
    () => years.map((y) => ({
      year: y,
      stats: computeCalendarYearStats(y, reports, allSchedules, settings, allMappings),
    })),
    [years, reports, allSchedules, settings, allMappings],
  )

  const whatIfMapping = whatIfMappingId
    ? allMappings.find(m => m.id === whatIfMappingId) ?? null
    : null

  // Force the selected mapping to cover all dates by stripping its date bounds
  const whatIfYearStats = useMemo(() => {
    if (!year || !whatIfMappingId) return null
    const mapping = allMappings.find(m => m.id === whatIfMappingId) ?? null
    if (!mapping) return null
    return computeCalendarYearStats(year, reports, allSchedules, settings,
      [{ ...mapping, effectiveDate: '0000-01-01', endDate: undefined }])
  }, [year, whatIfMappingId, allMappings, reports, allSchedules, settings])

  if (!year || years.length === 0) {
    return (
      <div className="p-4 md:p-8 text-gray-500">
        No reports uploaded yet.{' '}
        <button onClick={() => navigate('/upload')} className="text-indigo-400">Upload one</button>
      </div>
    )
  }

  // ── YTD aggregates ────────────────────────────────────────────────────────
  const ytdUnits    = yearStats.reduce((s, m) => s + m.totalDistributableUnits, 0)
  const ytdUnitPay  = yearStats.reduce((s, m) => s + m.unitCompensation, 0)
  const ytdStipends = yearStats.reduce((s, m) => s + m.totalStipends, 0)
  const ytdTotal    = yearStats.reduce((s, m) => s + m.totalCompensation, 0)
  const ytdHours    = yearStats.reduce((s, m) => s + m.totalHours, 0)
  const ytdCases    = yearStats.reduce((s, m) => s + m.totalCases, 0)
  const daysScheduled  = yearStats.flatMap(m => m.workingDays)
    .filter(d => d.shiftTypes.length > 0 && !d.shiftTypes.every(isOffDayShift)).length
  const daysWithProduction = yearStats.reduce((s, m) => s + m.daysWorked, 0)

  const isProjectionActive = whatIfMapping !== null || whatIfUnitRate !== null

  // Per-month projected unit pay when rate is overridden
  const projUnitPayByMonth: number[] | null = whatIfUnitRate != null
    ? yearStats.map(m => m.totalDistributableUnits * whatIfUnitRate)
    : null

  // Per-month projected stipends when mapping is active
  const projStipendsByMonth: number[] | null = whatIfYearStats
    ? whatIfYearStats.map(m => m.totalStipends)
    : null

  // Per-month projected total (combines whichever overrides are active)
  const projTotalByMonth: number[] | null = (projUnitPayByMonth || projStipendsByMonth)
    ? yearStats.map((m, i) => {
        const up = projUnitPayByMonth?.[i] ?? m.unitCompensation
        const stip = projStipendsByMonth?.[i] ?? m.totalStipends
        return up + stip
      })
    : null

  const projYtdUnitPay  = projUnitPayByMonth?.reduce((s, v) => s + v, 0) ?? null
  const wiStipends      = projStipendsByMonth?.reduce((s, v) => s + v, 0) ?? null
  const wiTotal         = projTotalByMonth?.reduce((s, v) => s + v, 0) ?? null

  // ── Off-days ──────────────────────────────────────────────────────────────
  const offDays = (() => {
    const dateMap = new Map<string, string[]>()
    for (const sched of [...allSchedules].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))) {
      for (const entry of sched.entries) dateMap.set(entry.date, entry.shiftTypes)
    }

    // Count off-day types for the selected year
    const prefix = `${year}-`
    let vacation = 0, holiday = 0, postcall = 0
    for (const [date, shiftTypes] of dateMap) {
      if (!date.startsWith(prefix)) continue
      if (!shiftTypes.every(isOffDayShift)) continue
      if (shiftTypes.some(isVacationShift)) vacation++
      else if (shiftTypes.some(isHolidayOffShift)) holiday++
      else if (shiftTypes.some(isPostcallShift)) postcall++
    }

    // ── Full-week detection ──────────────────────────────────────────────────
    const toStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    // Holiday sets for this year and adjacent years (for cross-year spans)
    const holidaySetFor = (y: number) =>
      new Set<string>(settings.holidays[y] ?? computeFederalHolidays(y))
    const holidaySets = new Map<number, Set<string>>([
      [year - 1, holidaySetFor(year - 1)],
      [year,     holidaySetFor(year)],
      [year + 1, holidaySetFor(year + 1)],
    ])
    const getHolidaySet = (y: number) => holidaySets.get(y) ?? holidaySetFor(y)

    // A day is non-working if:
    //  - explicitly scheduled as all off-day shifts (V/H/Postcall), OR
    //  - blank AND is a weekend or holiday
    //  - a day with any working shift always breaks the streak
    const isNonWorking = (date: string): boolean => {
      const [y, m, d] = date.split('-').map(Number)
      const dow = new Date(y, m - 1, d).getDay()
      const shifts = dateMap.get(date) ?? []
      if (shifts.length > 0 && !shifts.every(isOffDayShift)) return false              // working shift
      if (shifts.some(isPostcallShift)) return false                                    // postcall breaks streak
      if (shifts.length > 0) return true                                                // V or H
      return dow === 0 || dow === 6 || getHolidaySet(y).has(date)                     // blank: weekend or holiday
    }

    // Format a span label, handling same-month, same-year, and cross-year
    const fmtSpan = (start: string, end: string): string => {
      const [sy, sm, sd] = start.split('-').map(Number)
      const [ey, em, ed] = end.split('-').map(Number)
      if (sy === ey && sm === em) return `${MONTH_ABBREVS[sm-1]} ${sd}–${ed}`
      if (sy === ey) return `${MONTH_ABBREVS[sm-1]} ${sd}–${MONTH_ABBREVS[em-1]} ${ed}`
      return `${MONTH_ABBREVS[sm-1]} ${sd} '${String(sy).slice(2)}–${MONTH_ABBREVS[em-1]} ${ed} '${String(ey).slice(2)}`
    }

    // Walk extended range (±10 days around year boundaries) to catch cross-year spans
    const fullWeekSpans: { label: string; weeks: number }[] = []
    let spanDates: string[] = []

    const flushSpan = () => {
      if (spanDates.length >= 5) {
        // Require ≥3 V days anywhere in the span
        const vDaysInSpan = spanDates.filter(d => dateMap.get(d)?.some(isVacationShift)).length
        // Only attribute to this year if it contains ≥1 V or H day in the selected year
        const hasYearOffDay = spanDates.some(d => {
          if (!d.startsWith(prefix)) return false
          const shifts = dateMap.get(d) ?? []
          return shifts.length > 0 && shifts.every(isOffDayShift)
        })
        if (vDaysInSpan >= 3 && hasYearOffDay) {
          const weeks = Math.max(1, Math.floor(spanDates.length / 7))
          fullWeekSpans.push({ label: fmtSpan(spanDates[0], spanDates[spanDates.length - 1]), weeks })
        }
      }
      spanDates = []
    }

    const cur = new Date(year - 1, 11, 22)  // Dec 22 of prior year
    const rangeEnd = new Date(year + 1, 0, 10) // Jan 10 of next year
    while (cur <= rangeEnd) {
      const d = toStr(cur)
      if (isNonWorking(d)) spanDates.push(d)
      else flushSpan()
      cur.setDate(cur.getDate() + 1)
    }
    flushSpan()

    const fullWeekCount = fullWeekSpans.reduce((s, w) => s + w.weeks, 0)
    return { vacation, holiday, postcall, total: vacation + holiday + postcall, fullWeekSpans, fullWeekCount }
  })()

  // ── Shift analytics ───────────────────────────────────────────────────────
  const shiftDataCutoff = (() => {
    let max = ''
    for (const month of yearStats)
      for (const day of month.workingDays)
        if (day.hasProduction && day.date > max) max = day.date
    return max || null
  })()

  const shiftStatsData = buildShiftStats(yearStats, shiftDataCutoff, allMappings, settings.shiftHours)
  const whatIfMappings = whatIfMapping
    ? [{ ...whatIfMapping, effectiveDate: '0000-01-01', endDate: undefined }]
    : allMappings
  // Compute projected shift stats whenever either lever is active
  const whatIfShiftStats = isProjectionActive
    ? buildShiftStats(whatIfYearStats ?? yearStats, shiftDataCutoff, whatIfMappings, settings.shiftHours, whatIfUnitRate)
    : null

  // Merge actual + what-if by shift key for the table
  const shiftTableData = shiftStatsData.map(row => {
    const wi = whatIfShiftStats?.find(r => r.shift === row.shift)
    return {
      ...row,
      wiAvgDollarPerHr: wi?.avgDollarPerHr ?? null,
      wiTotalPay: wi?.totalPay ?? null,
    }
  })

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = yearStats.map((s, i) => {
    const projUp   = projUnitPayByMonth?.[i]
    const projStip = projStipendsByMonth?.[i]
    return {
      month: getMonthName(s.month).slice(0, 3),
      units: Math.round(s.totalDistributableUnits * 100) / 100,
      unitPay: Math.round(s.unitCompensation),
      projUnitPay: projUp != null ? Math.round(projUp) : undefined,
      stipends: Math.round(s.totalStipends),
      wiStipends: projStip != null ? Math.round(projStip) : undefined,
      total: Math.round(s.totalCompensation),
      hours: Math.round(s.totalHours * 10) / 10,
      ratePerUnit: s.totalDistributableUnits > 0
        ? Math.round((s.unitCompensation / s.totalDistributableUnits) * 100) / 100
        : 0,
      projRatePerUnit: whatIfUnitRate != null ? whatIfUnitRate : undefined,
    }
  })

  // ── Weekly hours data ─────────────────────────────────────────────────────
  const weeklyHoursData = useMemo(() => {
    const weekMap = new Map<string, number>()
    for (const month of yearStats) {
      for (const day of month.workingDays) {
        const [y, m, d] = day.date.split('-').map(Number)
        const date = new Date(y, m - 1, d)
        const dow = date.getDay()
        date.setDate(date.getDate() + (dow === 0 ? -6 : 1 - dow))
        const wk = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        weekMap.set(wk, (weekMap.get(wk) ?? 0) + day.hours)
      }
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([iso, hours]) => {
        const [, m, d] = iso.split('-').map(Number)
        return { week: `${getMonthName(m).slice(0, 3)} ${d}`, hours: Math.round(hours * 10) / 10 }
      })
  }, [yearStats])

  // ── End-of-day time distribution ──────────────────────────────────────────
  const endTimeDistribution = useMemo(() => {
    const mk = () => ({
      shiftCounts: {} as Record<string, number>,
      fixedShiftCounts: {} as Record<string, number>,
      varDays: [] as BucketDayRecord[],
      fixedDays: [] as BucketDayRecord[],
    })
    const buckets = [
      { label: 'Before 3pm', color: '#10b981', count: 0, fixedCount: 0, ...mk() },
      { label: '3 – 5pm',    color: '#6366f1', count: 0, fixedCount: 0, ...mk() },
      { label: '5 – 7pm',    color: '#8b5cf6', count: 0, fixedCount: 0, ...mk() },
      { label: '7 – 9pm',    color: '#f59e0b', count: 0, fixedCount: 0, ...mk() },
      { label: '9 – 11pm',   color: '#f97316', count: 0, fixedCount: 0, ...mk() },
      { label: 'Past 11pm',  color: '#ef4444', count: 0, fixedCount: 0, ...mk() },
    ]

    const [startH, startM] = settings.clinicalDayStart.split(':').map(Number)
    const dayStartMins = startH * 60 + (startM ?? 0)
    const excludedDays: { date: string; shiftTypes: string[] }[] = []

    for (const month of yearStats) {
      for (const day of month.workingDays) {
        const activeShifts = day.shiftTypes.filter((s) => !isOffDayShift(s))
        if (activeShifts.length === 0) continue

        const hasVariable = activeShifts.some(
          (s) => !isFixedShift(resolveShiftAlias(s.toUpperCase()), settings.shiftHours)
        )

        let endMins: number | null = null

        if (hasVariable) {
          // Variable or mixed day: use actual last case end time
          if (!day.lastEndTime) { excludedDays.push({ date: day.date, shiftTypes: activeShifts }); continue }
          const match = day.lastEndTime.match(/^(\d{1,2}):(\d{2})/)
          if (!match) { excludedDays.push({ date: day.date, shiftTypes: activeShifts }); continue }
          endMins = parseInt(match[1]) * 60 + parseInt(match[2])
          // Times after midnight (e.g. "00:30") parse to small values; treat as next-day continuation
          if (endMins < dayStartMins) endMins += 24 * 60
        } else {
          // Fixed-shift-only day: estimate end as clinicalDayStart + longest shift
          const maxHours = Math.max(...activeShifts.map((s) => {
            const canonical = resolveShiftAlias(s.toUpperCase())
            return getFixedHours(canonical, day.isCallWeekend, settings.shiftHours) ?? 0
          }))
          if (maxHours === 0) { excludedDays.push({ date: day.date, shiftTypes: activeShifts }); continue }
          endMins = dayStartMins + maxHours * 60
        }

        // Use <= on upper bounds so exact boundary times (e.g. 17:00) belong to the earlier bucket
        const bi =
          endMins <= 15 * 60 ? 0 :
          endMins <= 17 * 60 ? 1 :
          endMins <= 19 * 60 ? 2 :
          endMins <= 21 * 60 ? 3 :
          endMins <= 23 * 60 ? 4 : 5
        const endTimeStr = minsToTimeStr(endMins)
        if (hasVariable) {
          buckets[bi].count++
          buckets[bi].varDays.push({ stats: day, endTime: endTimeStr, isFixed: false })
          for (const s of activeShifts.filter((s) => !isFixedShift(resolveShiftAlias(s.toUpperCase()), settings.shiftHours))) {
            const canonical = resolveShiftAlias(s.toUpperCase())
            buckets[bi].shiftCounts[canonical] = (buckets[bi].shiftCounts[canonical] ?? 0) + 1
          }
        } else {
          buckets[bi].fixedCount++
          buckets[bi].fixedDays.push({ stats: day, endTime: `${endTimeStr} (est.)`, isFixed: true })
          for (const s of activeShifts) {
            const canonical = resolveShiftAlias(s.toUpperCase())
            buckets[bi].fixedShiftCounts[canonical] = (buckets[bi].fixedShiftCounts[canonical] ?? 0) + 1
          }
        }
      }
    }
    return { buckets, excludedDays }
  }, [yearStats, settings.shiftHours, settings.clinicalDayStart])

  // ── Per-shift day map (mirrors buildShiftStats attribution logic exactly) ────
  const shiftDayMap = useMemo(() => {
    type DayEntry = { day: import('../types').WorkingDayStats; hours: number; pay: number }
    const map = new Map<string, DayEntry[]>()
    const add = (key: string, day: import('../types').WorkingDayStats, hours: number, pay: number) => {
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ day, hours, pay })
    }
    for (const month of yearStats) {
      const applicableMapping = getApplicableMapping(month.year, month.month, allMappings)
      for (const day of month.workingDays) {
        if (day.shiftTypes.length === 0) continue
        if (shiftDataCutoff && day.date > shiftDataCutoff) continue
        const effectiveTotalDayPay = day.unitPay + day.stipendAmount + day.additionalStipend
        const fixedShifts   = day.shiftTypes.filter(s => !isOffDayShift(s) &&  isFixedShift(resolveShiftAlias(s.toUpperCase()), settings.shiftHours))
        const primaryShifts = day.shiftTypes.filter(s => !isOffDayShift(s) && !isFixedShift(resolveShiftAlias(s.toUpperCase()), settings.shiftHours))
        const isSharedDay   = fixedShifts.length > 0 && primaryShifts.length > 0
        if (isSharedDay) {
          const fixedStipendTotal = getStipendForDay(fixedShifts, day.isCallWeekend, applicableMapping)
          const primaryPayEach = (effectiveTotalDayPay - fixedStipendTotal) / primaryShifts.length
          for (const rawSt of primaryShifts) {
            const canonical = resolveShiftAlias(rawSt.toUpperCase())
            add(shiftKey(canonical, day.isCallWeekend, settings.shiftHours), day, day.hours, primaryPayEach)
          }
          for (const rawSt of fixedShifts) {
            const canonical = resolveShiftAlias(rawSt.toUpperCase())
            const stipend = getStipendForDay([rawSt], day.isCallWeekend, applicableMapping)
            add(canonical, day, 0, stipend)
          }
        } else {
          for (const rawSt of day.shiftTypes) {
            if (isOffDayShift(rawSt)) continue
            const canonical = resolveShiftAlias(rawSt.toUpperCase())
            add(shiftKey(canonical, day.isCallWeekend, settings.shiftHours), day, day.hours, effectiveTotalDayPay)
          }
        }
      }
    }
    return map
  }, [yearStats, allMappings, shiftDataCutoff, settings])

  // Dollar/hr chart data for shift analytics — use what-if when active
  const activeShiftStats = whatIfShiftStats ?? shiftStatsData

  return (
    <div className="p-4 md:p-8">

      {/* Header + year selector + what-if selector */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-100">{year} Annual Summary</h2>
        {years.length > 1 && (
          <div className="flex items-center gap-2 ml-4">
            {years.slice(0, 3).map((y) => (
              <button key={y} onClick={() => { navigate(`/annual/${y}`); setWhatIfMappingId(null); setWhatIfUnitRate(null); setShowYoY(false); setSelectedBucketIdx(null) }}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  y === year ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}>
                {y}
              </button>
            ))}
            {years.length > 3 && (
              <select
                value={years.slice(3).includes(year!) ? year : ''}
                onChange={e => { navigate(`/annual/${e.target.value}`); setWhatIfMappingId(null); setWhatIfUnitRate(null); setShowYoY(false); setSelectedBucketIdx(null) }}
                className={`bg-gray-900 border rounded-md px-2 py-1 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                  years.slice(3).includes(year!)
                    ? 'border-indigo-600 text-white'
                    : 'border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                {!years.slice(3).includes(year!) && <option value="" disabled>More…</option>}
                {years.slice(3).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
          </div>
        )}
        {years.length > 1 && (
          <button
            onClick={() => setShowYoY((v) => !v)}
            className={`ml-2 px-3 py-1 rounded-md text-sm font-medium transition-colors border ${
              showYoY
                ? 'border-violet-600 bg-violet-900/30 text-violet-300'
                : 'border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            YoY
          </button>
        )}

        {/* Projection icon button */}
        <div className="relative ml-auto" ref={popoverRef}>
          <button
            onClick={() => setShowWhatIfPopover(v => !v)}
            className={`p-1.5 rounded-md transition-colors ${
              isProjectionActive
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-gray-700 hover:text-gray-400'
            }`}
            title="Rate projection"
            aria-label="Rate projection"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </button>

          {showWhatIfPopover && (
            <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-3.5">
              <p className="text-xs font-semibold text-gray-200 mb-0.5">Rate Projection</p>
              <p className="text-[10px] text-gray-500 mb-3">Apply hypothetical rates to this year's production data</p>

              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">Stipend Mapping</p>
              <select
                value={whatIfMappingId ?? ''}
                onChange={e => setWhatIfMappingId(e.target.value || null)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-amber-500 mb-3"
              >
                <option value="">— actual rates —</option>
                {allMappings.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>

              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-1">$/Unit Override</p>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={ytdUnits > 0 ? (ytdUnitPay / ytdUnits).toFixed(2) : '0.00'}
                  value={whatIfUnitRate ?? ''}
                  onChange={e => setWhatIfUnitRate(e.target.value !== '' ? parseFloat(e.target.value) : null)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-md pl-6 pr-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <p className="text-[10px] text-gray-600 mt-1 mb-3">
                Leave blank to use actual avg {ytdUnits > 0 ? `$${(ytdUnitPay / ytdUnits).toFixed(2)}` : '—'}/unit
              </p>

              {isProjectionActive && (
                <button
                  onClick={() => { setWhatIfMappingId(null); setWhatIfUnitRate(null); setShowWhatIfPopover(false) }}
                  className="w-full text-xs text-amber-500 hover:text-amber-400 transition-colors text-center py-1 border-t border-gray-700 pt-2.5"
                >
                  Clear projection
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* What-if banner */}
      {isProjectionActive && (
        <div className="flex items-center gap-2.5 mb-5 px-3.5 py-2.5 bg-amber-950/40 border border-amber-700/40 rounded-lg">
          <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <span className="text-xs text-amber-400 flex-1">
            Projection active —
            {whatIfMapping && <> stipend mapping: <span className="font-semibold">{whatIfMapping.name}</span></>}
            {whatIfMapping && whatIfUnitRate != null && <span className="text-amber-600"> · </span>}
            {whatIfUnitRate != null && <> unit rate: <span className="font-semibold">${whatIfUnitRate.toFixed(2)}/unit</span></>}
            . Figures in amber are hypothetical — no data has been changed.
          </span>
          <button
            onClick={() => { setWhatIfMappingId(null); setWhatIfUnitRate(null) }}
            className="text-amber-600 hover:text-amber-400 transition-colors flex-shrink-0 ml-1"
            aria-label="Clear projection"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Year-over-Year Comparison */}
      {showYoY && years.length > 1 && (() => {
        const allMonths = [1,2,3,4,5,6,7,8,9,10,11,12]
        // Only show months that have data in at least one year
        const activeMonths = allMonths.filter((m) =>
          allYearStats.some(({ stats }) => stats.some((s) => s.month === m))
        )
        const sortedYears = [...years].sort((a, b) => a - b)

        return (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden mb-8">
            <div className="px-5 py-4 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-gray-300">Year-over-Year Comparison</h3>
              <p className="text-xs text-gray-600 mt-0.5">Units and total compensation by month across all uploaded years</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-max">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider sticky left-0 z-10 bg-gray-900">Month</th>
                    {sortedYears.map((y) => (
                      <th key={y} colSpan={3} className={`px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider border-l border-gray-800 ${y === year ? 'text-indigo-400' : 'text-gray-500'}`}>
                        {y}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-800">
                    <th className="sticky left-0 z-10 bg-gray-900" />
                    {sortedYears.map((y) => (
                      <>
                        <th key={`${y}-cases`} className="px-3 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wider border-l border-gray-800">Cases</th>
                        <th key={`${y}-units`} className="px-3 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Units</th>
                        <th key={`${y}-pay`} className="px-3 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Total Pay</th>
                      </>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeMonths.map((m) => (
                    <tr key={m} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                      <td className="px-4 py-2.5 text-gray-400 font-medium sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800 text-sm">
                        {getMonthName(m).slice(0, 3)}
                      </td>
                      {sortedYears.map((y) => {
                        const ys = allYearStats.find((a) => a.year === y)
                        const ms = ys?.stats.find((s) => s.month === m)
                        const isCurrent = y === year
                        return (
                          <>
                            <td key={`${y}-${m}-cases`} className={`px-3 py-2.5 text-right text-xs border-l border-gray-800 ${ms ? (isCurrent ? 'text-gray-300' : 'text-gray-500') : 'text-gray-800'}`}>
                              {ms ? ms.totalCases : '—'}
                            </td>
                            <td key={`${y}-${m}-units`} className={`px-3 py-2.5 text-right text-xs font-medium ${ms ? (isCurrent ? 'text-indigo-400' : 'text-indigo-600') : 'text-gray-800'}`}>
                              {ms ? ms.totalDistributableUnits.toFixed(1) : '—'}
                            </td>
                            <td key={`${y}-${m}-pay`} className={`px-3 py-2.5 text-right text-xs font-semibold ${ms ? (isCurrent ? 'text-emerald-400' : 'text-emerald-700') : 'text-gray-800'}`}>
                              {ms ? formatCurrency(ms.totalCompensation) : '—'}
                            </td>
                          </>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-800 border-t border-gray-700 font-semibold">
                    <td className="px-4 py-3 text-gray-300 sticky left-0 z-10 bg-gray-800 text-sm">Total</td>
                    {sortedYears.map((y) => {
                      const ys = allYearStats.find((a) => a.year === y)
                      const totalCases = ys?.stats.reduce((s, m) => s + m.totalCases, 0) ?? 0
                      const totalUnits = ys?.stats.reduce((s, m) => s + m.totalDistributableUnits, 0) ?? 0
                      const totalPay   = ys?.stats.reduce((s, m) => s + m.totalCompensation, 0) ?? 0
                      const isCurrent = y === year
                      return (
                        <>
                          <td key={`${y}-tot-cases`} className={`px-3 py-3 text-right text-xs border-l border-gray-700 ${isCurrent ? 'text-gray-200' : 'text-gray-500'}`}>{totalCases}</td>
                          <td key={`${y}-tot-units`} className={`px-3 py-3 text-right text-xs ${isCurrent ? 'text-indigo-300' : 'text-indigo-700'}`}>{totalUnits.toFixed(1)}</td>
                          <td key={`${y}-tot-pay`} className={`px-3 py-3 text-right text-xs ${isCurrent ? 'text-emerald-300' : 'text-emerald-700'}`}>{formatCurrency(totalPay)}</td>
                        </>
                      )
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      })()}

      {/* Shift analytics cutoff notice */}
      {shiftDataCutoff && (
        <div className="flex items-center gap-2 mb-5 px-3 py-2 bg-gray-800/60 border border-gray-700/60 rounded-lg w-fit">
          <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-xs text-gray-500">
            Shift analytics use data through{' '}
            <span className="text-gray-300 font-medium">{formatDateFull(shiftDataCutoff)}</span>
            {' '}— days after this date lack processed billing data
          </span>
        </div>
      )}

      {/* YTD Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard
          label="YTD Total Pay"
          value={isProjectionActive && wiTotal != null ? formatCurrency(wiTotal) : formatCurrency(ytdTotal)}
          color={isProjectionActive ? 'amber' : 'green'}
          sub={isProjectionActive && wiTotal != null
            ? `Actual: ${formatCurrency(ytdTotal)} · ${deltaLabel(ytdTotal, wiTotal)}`
            : `${formatCurrency(ytdUnitPay)} unit · ${formatCurrency(ytdStipends)} stipends`}
          private
        />
        <StatCard label="YTD Hours" value={formatHours(ytdHours)}
          sub={`${yearStats.reduce((s, m) => s + m.daysWorked, 0)} days worked · ${yearStats.length} months`} />
        <StatCard
          label="Avg $/hr"
          value={isProjectionActive && wiTotal != null
            ? `$${(wiTotal / ytdHours).toFixed(0)}/hr`
            : ytdHours > 0 ? `$${(ytdTotal / ytdHours).toFixed(0)}/hr` : '—'}
          sub={isProjectionActive && wiTotal != null
            ? `Actual: $${(ytdTotal / ytdHours).toFixed(0)}/hr · ${deltaLabel(ytdTotal / ytdHours, wiTotal / ytdHours)}`
            : 'Total compensation ÷ hours'}
          color="amber"
          private
        />
        {/* YTD Days Off — inline card with full-week chip */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">YTD Days Off</p>
          <p className="text-2xl font-bold text-gray-100">{offDays.total > 0 ? offDays.total : '—'}</p>
          {offDays.total > 0 && (
            <div className="mt-1 space-y-1">
              <p className="text-xs text-gray-600">
                {[
                  offDays.vacation > 0 ? `${offDays.vacation} vacation` : '',
                  offDays.holiday > 0  ? `${offDays.holiday} holiday`  : '',
                  offDays.postcall > 0 ? `${offDays.postcall} postcall` : '',
                ].filter(Boolean).join(' · ')}
              </p>
              {offDays.fullWeekCount > 0 && (
                <div ref={weeksPopoverRef} className="relative w-fit">
                  <button
                    onClick={() => setShowWeeksPopover(o => !o)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${
                      showWeeksPopover
                        ? 'bg-indigo-700/60 border-indigo-500/70 text-indigo-200'
                        : 'bg-indigo-900/50 border-indigo-700/50 text-indigo-300 hover:bg-indigo-800/50'
                    }`}
                  >
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {offDays.fullWeekCount} full wk{offDays.fullWeekCount !== 1 ? 's' : ''}
                  </button>
                  {showWeeksPopover && (
                    <div className="absolute bottom-full left-0 mb-1.5 z-50 w-max max-w-[220px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 shadow-xl">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Consecutive time-off spans</p>
                      {offDays.fullWeekSpans.map(({ label, weeks }) => (
                        <div key={label} className="flex items-center justify-between gap-4 py-0.5">
                          <span className="text-xs text-gray-200">{label}</span>
                          <span className="text-[10px] text-indigo-400 font-semibold whitespace-nowrap">
                            {weeks} wk{weeks !== 1 ? 's' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <StatCard
          label="Days Scheduled"
          value={daysScheduled > 0 ? String(daysScheduled) : '—'}
          sub="working shift assignments"
        />
        <StatCard
          label="Days w/ Production"
          value={daysWithProduction > 0 ? String(daysWithProduction) : '—'}
          sub="days with PCR line items"
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Units per Month</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} />
              <Tooltip formatter={(v: number) => [v.toFixed(2), 'Units']} {...CHART_STYLE} />
              <Bar dataKey="units" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {yearStats.length > 0 && (
            <p className="text-xs text-gray-600 mt-2 text-right">
              Avg <span className="text-gray-400 font-medium">{(ytdUnits / yearStats.length).toFixed(1)}</span> units/month
            </p>
          )}
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Monthly Compensation</h3>
          {isProjectionActive && (
            <p className="text-[10px] text-amber-600 mb-3">
              {[
                whatIfMapping && `Stipends: ${whatIfMapping.name}`,
                whatIfUnitRate != null && `Unit rate: $${whatIfUnitRate.toFixed(2)}/unit`,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number, name: string) => [
                  formatCurrency(v),
                  name === 'projUnitPay' ? 'Unit Pay (proj)'
                  : name === 'unitPay' ? 'Unit Pay'
                  : name === 'wiStipends' ? 'Stipends (proj)'
                  : 'Stipends (actual)',
                ]}
                {...CHART_STYLE}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
                formatter={(v) =>
                  v === 'projUnitPay' ? 'Unit Pay (proj)'
                  : v === 'unitPay' ? 'Unit Pay'
                  : v === 'wiStipends' ? 'Stipends (proj)'
                  : 'Stipends (actual)'
                } />
              {projUnitPayByMonth
                ? <Bar dataKey="projUnitPay" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                : <Bar dataKey="unitPay" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
              }
              {isProjectionActive
                ? <Bar dataKey="wiStipends" stackId="a" fill={whatIfMapping ? '#fbbf24' : '#34d399'} radius={[4, 4, 0, 0]} />
                : <Bar dataKey="stipends" stackId="a" fill="#34d399" radius={[4, 4, 0, 0]} />
              }
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Dollar per Unit Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} tickFormatter={(v) => `$${v.toFixed(0)}`} domain={['auto', 'auto']} />
              <Tooltip
                formatter={(v: number, name: string) => [`$${v.toFixed(2)}`, name === 'projRatePerUnit' ? '$/Unit (proj)' : '$/Unit (actual)']}
                {...CHART_STYLE}
              />
              <Line type="monotone" dataKey="ratePerUnit" stroke="#f59e0b" strokeWidth={2}
                dot={{ r: 4, fill: '#f59e0b' }} />
              {whatIfUnitRate != null && (
                <Line type="monotone" dataKey="projRatePerUnit" stroke="#fb923c" strokeWidth={2}
                  strokeDasharray="5 3" dot={{ r: 3, fill: '#fb923c' }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-300">Hours Worked</h3>
            <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
              {(['month', 'week'] as const).map((v) => (
                <button key={v} onClick={() => setHoursView(v)}
                  className={`px-3 py-1 font-medium transition-colors ${hoursView === v ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'}`}>
                  {v === 'month' ? 'Monthly' : 'Weekly'}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={hoursView === 'month' ? chartData : weeklyHoursData}
              margin={{ top: 0, right: 8, bottom: 0, left: -10 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey={hoursView === 'month' ? 'month' : 'week'} {...AXIS_PROPS} interval={hoursView === 'week' ? 3 : 0} />
              <YAxis {...AXIS_PROPS} />
              <Tooltip formatter={(v: number) => [formatHours(v), 'Hours']} {...CHART_STYLE} />
              {hoursView === 'week' && (
                <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="4 4"
                  label={{ value: '50h', position: 'right', fill: '#f59e0b', fontSize: 10 }} />
              )}
              <Bar dataKey="hours" fill="#0ea5e9" radius={hoursView === 'month' ? [4, 4, 0, 0] : [2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {(() => {
            const totalHours = yearStats.reduce((s, m) => s + m.totalHours, 0)
            const avgWeekly = weeklyHoursData.length > 0 ? totalHours / weeklyHoursData.length : null
            const avgMonthly = chartData.length > 0 ? totalHours / chartData.length : null
            return (
              <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                <span>Avg <span className="text-gray-300 font-medium">{avgWeekly != null ? formatHours(avgWeekly) : '—'}</span> / week</span>
                <span className="text-gray-700">·</span>
                <span>Avg <span className="text-gray-300 font-medium">{avgMonthly != null ? formatHours(avgMonthly) : '—'}</span> / month</span>
              </div>
            )
          })()}
        </div>
      </div>

      {/* End-of-Day Distribution */}
      {endTimeDistribution.buckets.some((b) => b.count > 0) && (() => {
        const { buckets: etBuckets, excludedDays: etExcluded } = endTimeDistribution
        const total = etBuckets.reduce((s, b) => s + b.count + b.fixedCount, 0)
        return (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-8">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-300">End-of-Day Distribution</h3>
              {etExcluded.length > 0 && (
                <div className="relative" ref={excludedPopoverRef}>
                  <button
                    onClick={() => setShowExcludedPopover((v) => !v)}
                    className="text-xs text-gray-600 hover:text-gray-400 transition-colors underline decoration-dotted underline-offset-2"
                  >
                    {etExcluded.length} day{etExcluded.length !== 1 ? 's' : ''} excluded (no time data)
                  </button>
                  {showExcludedPopover && (
                    <div className="absolute right-0 top-full mt-1.5 z-50 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-3">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Days without time data</p>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {etExcluded.map((d) => (
                          <div key={d.date} className="flex items-center justify-between gap-3">
                            <span className="text-xs text-gray-300">{formatDateFull(d.date)}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">{d.shiftTypes.join(', ')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-600 mb-4">Variable days: last case end time · Fixed days (APS/BR/NIR): start + shift hours</p>
            <div className="flex items-center gap-4 mb-3">
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-indigo-500" />
                Variable
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FIXED_BAR_COLOR }} />
                Fixed (APS / BR / NIR)
              </span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={etBuckets} margin={{ top: 0, right: 8, bottom: 0, left: -10 }} barCategoryGap="25%" barGap={ET_BAR_GAP}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} allowDecimals={false} />
                <Tooltip content={<EndTimeTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} wrapperStyle={{ zIndex: 50 }} />
                <Bar dataKey="count" shape={<VarBarShape />} style={{ cursor: 'pointer' }}
                  onClick={(_d, i) => setSelectedBucketIdx(i === selectedBucketIdx ? null : i)} />
                <Bar dataKey="fixedCount" shape={<FixedBarShape />} style={{ cursor: 'pointer' }}
                  onClick={(_d, i) => setSelectedBucketIdx(i === selectedBucketIdx ? null : i)} />
              </BarChart>
            </ResponsiveContainer>
            {selectedBucketIdx !== null && (() => {
              const sel = etBuckets[selectedBucketIdx]
              const allDays = [...sel.varDays, ...sel.fixedDays].sort((a, b) => a.stats.date.localeCompare(b.stats.date))
              return (
                <div className="mt-4 border border-gray-700 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700" style={{ backgroundColor: sel.color + '18' }}>
                    <span className="text-sm font-semibold" style={{ color: sel.color }}>{sel.label}</span>
                    <span className="text-xs text-gray-500 mr-auto ml-3">{allDays.length} day{allDays.length !== 1 ? 's' : ''}</span>
                    <button onClick={() => setSelectedBucketIdx(null)} className="text-gray-600 hover:text-gray-300 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="divide-y divide-gray-800 max-h-72 overflow-y-auto">
                    {allDays.map(({ stats: d, endTime, isFixed }) => (
                      <div key={d.date} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/50 transition-colors cursor-pointer" onClick={() => {
                          window.history.replaceState(
                            { ...window.history.state, usr: { selectedBucketIdx, expandedShift, scrollY: window.scrollY } },
                            ''
                          )
                          navigate('/', { state: { date: d.date } })
                        }}>
                        <span className="text-xs text-gray-400 w-28 shrink-0">{formatDateFull(d.date)}</span>
                        <div className="flex flex-wrap gap-1 flex-1">
                          {d.shiftTypes.filter(s => !isOffDayShift(s)).map(s => (
                            <span key={s} className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${shiftBadgeClass(s, settings.shiftHours)}`}>{s}</span>
                          ))}
                        </div>
                        <span className="text-xs tabular-nums shrink-0" style={{ color: isFixed ? FIXED_BAR_COLOR : sel.color }}>{endTime}</span>
                        {d.hours > 0 && <span className="text-xs text-gray-600 shrink-0">{d.hours.toFixed(1)}h</span>}
                        {d.caseCount > 0 && <span className="text-xs text-gray-600 shrink-0">{d.caseCount} case{d.caseCount !== 1 ? 's' : ''}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {etBuckets.filter((b) => b.count + b.fixedCount > 0).map((b) => (
                <span key={b.label} className="text-xs text-gray-500">
                  <span className="font-medium" style={{ color: b.color }}>{b.label}</span>
                  {b.count > 0 && <> {b.count}v</>}
                  {b.fixedCount > 0 && <span style={{ color: FIXED_BAR_COLOR }}> {b.fixedCount}f</span>}
                  {' '}
                  <span className="text-gray-700">({Math.round((b.count + b.fixedCount) / total * 100)}%)</span>
                </span>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Shift Type Analytics */}
      {shiftStatsData.length > 0 && (() => {
        const hoursData = activeShiftStats.filter((d) => !d.isFixed && d.avgHours != null)
        const dollarsData = activeShiftStats.filter((d) => d.avgDollarPerHr != null)
        return (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-8">
            {/* Tab header */}
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-300">Shift Type Analytics</h3>
              <div className="flex items-center gap-2">
              <button
                onClick={() => exportShiftAnalytics(shiftTableData, year, isProjectionActive)}
                title="Export to Excel"
                className="p-1 text-gray-600 hover:text-gray-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
              </button>
              <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                <button
                  onClick={() => setShiftTab('hours')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    shiftTab === 'hours' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Avg Hours
                </button>
                <button
                  onClick={() => setShiftTab('dollars')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    shiftTab === 'dollars' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Avg $/hr
                </button>
              </div>
              </div>
            </div>
            {whatIfMapping && (
              <p className="text-[10px] text-amber-600 mb-3">$/hr and pay figures using {whatIfMapping.name} stipend mapping</p>
            )}

            {/* Chart */}
            {shiftTab === 'hours' ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={hoursData} margin={{ top: 0, right: 32, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="shift" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => `${v}h`} />
                  <Tooltip
                    labelFormatter={(label: string) => label.replace(/ WD$/, ' Weekday').replace(/ WE$/, ' Weekend')}
                    formatter={(v: number, _: string, entry: { payload?: { days: number } }) =>
                      [`${v}h avg · ${entry.payload?.days ?? 0} days`, 'Shift length']}
                    {...CHART_STYLE}
                  />
                  {[8, 10, 12].map((h) => (
                    <ReferenceLine key={h} y={h} stroke="#374151" strokeDasharray="4 4"
                      label={{ value: `${h}h`, position: 'right', fill: '#6b7280', fontSize: 10 }} />
                  ))}
                  <Bar dataKey="avgHours" radius={[4, 4, 0, 0]}>
                    {hoursData.map((entry) => (
                      <Cell key={entry.shift} fill={shiftBarColor(entry.shift)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dollarsData} margin={{ top: 0, right: 32, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="shift" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => `$${v}`} domain={[0, 650]} />
                  <Tooltip
                    labelFormatter={(label: string) => label.replace(/ WD$/, ' Weekday').replace(/ WE$/, ' Weekend')}
                    formatter={(v: number, _: string, entry: { payload?: { days: number } }) =>
                      [`$${v}/hr avg · ${entry.payload?.days ?? 0} days`, '$/hr']}
                    {...CHART_STYLE}
                  />
                  <Bar dataKey="avgDollarPerHr" radius={[4, 4, 0, 0]}>
                    {dollarsData.map((entry) => (
                      <Cell key={entry.shift} fill={whatIfMapping ? '#f59e0b' : shiftBarColor(entry.shift)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}

            {/* Stat table */}
            {(() => {
              const cols: { label: string; key: string }[] = [
                { label: 'Shift', key: 'shift' },
                { label: 'Days', key: 'days' },
                { label: 'Avg Hours', key: 'avgHours' },
                { label: 'Avg Units', key: 'avgUnits' },
                { label: 'Avg $/hr', key: 'avgDollarPerHr' },
                { label: 'Total Pay', key: 'totalPay' },
              ]
              const toggleSort = (key: string) =>
                setShiftSort((s) => s.col === key ? { col: key, dir: s.dir === 1 ? -1 : 1 } : { col: key, dir: key === 'shift' ? 1 : -1 })
              const sortedRows = [...shiftTableData].sort((a, b) => {
                if (shiftSort.col === 'shift') {
                  const cmp = shiftSortKey(a.shift).localeCompare(shiftSortKey(b.shift))
                  return cmp * shiftSort.dir
                }
                const av = a[shiftSort.col as keyof typeof a] ?? -Infinity
                const bv = b[shiftSort.col as keyof typeof b] ?? -Infinity
                return av < bv ? -shiftSort.dir : av > bv ? shiftSort.dir : 0
              })
              return (
                <div className="overflow-x-auto mt-5">
                  <table className="w-full text-sm min-w-max">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {cols.map(({ label, key }, i) => (
                          <th key={key} onClick={() => toggleSort(key)}
                            className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-gray-300 ${shiftSort.col === key ? 'text-indigo-400' : 'text-gray-600'}${i === 0 ? ' sticky left-0 z-10 bg-gray-900' : ''}`}>
                            <span className="flex items-center gap-1">
                              {label}
                              {shiftSort.col === key && (
                                <span className="text-indigo-400">{shiftSort.dir === 1 ? '↑' : '↓'}</span>
                              )}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => {
                        const isExpanded = expandedShift === row.shift
                        const dayEntries = (shiftDayMap.get(row.shift) ?? []).slice().sort((a, b) => a.day.date.localeCompare(b.day.date))
                        return (
                          <>
                            <tr key={row.shift}
                              className="group border-b border-gray-800 hover:bg-gray-800 cursor-pointer select-none"
                              onClick={() => setExpandedShift(isExpanded ? null : row.shift)}
                            >
                              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-200 sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800">
                                <span className="flex items-center gap-2">
                                  <svg className={`w-3 h-3 text-gray-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                  {row.shift}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-gray-400">{row.days}</td>
                              <td className="px-4 py-2.5 text-gray-400">
                                {row.isFixed ? <span className="text-gray-600 text-xs">fixed</span> : row.avgHours != null ? `${row.avgHours}h` : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-indigo-400">{row.avgUnits.toFixed(2)}</td>
                              <td className="px-4 py-2.5">
                                {whatIfMapping && row.wiAvgDollarPerHr != null ? (
                                  <span className="flex flex-col">
                                    <span className="text-amber-400 font-medium">${row.wiAvgDollarPerHr}/hr</span>
                                    <span className="text-gray-600 text-[10px]">actual: {row.avgDollarPerHr != null ? `$${row.avgDollarPerHr}/hr` : '—'}</span>
                                  </span>
                                ) : (
                                  <span className="text-amber-400">{row.avgDollarPerHr != null ? `$${row.avgDollarPerHr}/hr` : '—'}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                {whatIfMapping && row.wiTotalPay != null ? (
                                  <span className="flex flex-col">
                                    <span className="text-amber-400 font-semibold">{formatCurrencyFull(row.wiTotalPay)}</span>
                                    <span className="text-gray-600 text-[10px]">actual: {formatCurrencyFull(row.totalPay)}</span>
                                  </span>
                                ) : (
                                  <span className="text-emerald-400 font-semibold">{formatCurrencyFull(row.totalPay)}</span>
                                )}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${row.shift}-detail`} className="border-b border-gray-800 bg-gray-950">
                                <td colSpan={cols.length} className="px-6 py-3">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-600 uppercase tracking-wider border-b border-gray-800">
                                        <th className="pb-1.5 text-left font-semibold pr-6">Date</th>
                                        <th className="pb-1.5 text-left font-semibold pr-6">Cases</th>
                                        <th className="pb-1.5 text-left font-semibold pr-6">Start</th>
                                        <th className="pb-1.5 text-left font-semibold pr-6">End</th>
                                        <th className="pb-1.5 text-left font-semibold pr-6">Hours</th>
                                        <th className="pb-1.5 text-left font-semibold">Total Pay</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {dayEntries.map(({ day, hours, pay }) => (
                                        <tr key={day.date} className="border-t border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors" onClick={() => {
                                          window.history.replaceState(
                                            { ...window.history.state, usr: { selectedBucketIdx, expandedShift, scrollY: window.scrollY } },
                                            ''
                                          )
                                          navigate('/', { state: { date: day.date } })
                                        }}>
                                          <td className="py-1 pr-6 text-gray-300">{formatDateFull(day.date)}</td>
                                          <td className="py-1 pr-6 text-gray-500">{day.caseCount > 0 ? day.caseCount : '—'}</td>
                                          <td className="py-1 pr-6 font-mono text-gray-500">{day.firstStartTime ?? '—'}</td>
                                          <td className="py-1 pr-6 font-mono text-gray-500">{day.lastEndTime ?? '—'}</td>
                                          <td className="py-1 pr-6 text-gray-400">{hours > 0 ? formatHours(hours) : '—'}</td>
                                          <td className="py-1 text-emerald-400 font-medium">{formatCurrencyFull(pay)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        )
      })()}

      {/* Month-by-month table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-300">Month-by-Month Breakdown</h3>
            {whatIfMapping && (
              <p className="text-[10px] text-amber-600 mt-0.5">Stipends and totals shown using {whatIfMapping.name}</p>
            )}
          </div>
          <button
            onClick={() => exportMonthBreakdown(yearStats, year, isProjectionActive ? {
              unitPayByMonth: projUnitPayByMonth ?? undefined,
              stipendsByMonth: projStipendsByMonth ?? undefined,
              totalByMonth: projTotalByMonth ?? undefined,
            } : undefined)}
            title="Export to Excel"
            className="p-1 text-gray-600 hover:text-gray-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-max">
            <thead>
              <tr className="border-b border-gray-800">
                {['Month', 'Cases', 'Units', '$/Unit', 'Unit Pay', 'Stipends', 'Total Pay', 'Hours', '$/hr', 'Days'].map((h, i) => (
                  <th key={h} className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider${i === 0 ? ' sticky left-0 z-10 bg-gray-900' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yearStats.map((s, i) => {
                const actualRate = s.totalDistributableUnits > 0 ? s.unitCompensation / s.totalDistributableUnits : null
                const projUp    = projUnitPayByMonth?.[i] ?? null
                const projStip  = projStipendsByMonth?.[i] ?? null
                const projTotal = projTotalByMonth?.[i] ?? null
                const actualDollarPerHr = s.totalHours > 0 ? s.totalCompensation / s.totalHours : null
                const projDollarPerHr   = projTotal != null && s.totalHours > 0 ? projTotal / s.totalHours : null
                return (
                  <tr key={s.id} onClick={() => navigate(`/calendar/${s.year}-${String(s.month).padStart(2, '0')}`)}
                    className="group border-b border-gray-800 hover:bg-gray-800 cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-200 sticky left-0 z-10 bg-gray-900 group-hover:bg-gray-800">{formatMonthYear(s.year, s.month)}</td>
                    <td className="px-4 py-3 text-gray-400">{s.totalCases}</td>
                    <td className="px-4 py-3 text-gray-300 font-medium">{s.totalDistributableUnits.toFixed(2)}</td>
                    {/* $/Unit */}
                    <td className="px-4 py-3">
                      {whatIfUnitRate != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400">${whatIfUnitRate.toFixed(2)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {actualRate != null ? `$${actualRate.toFixed(2)}` : '—'}</span>
                        </span>
                      ) : (
                        <span className="text-amber-400">{actualRate != null ? `$${actualRate.toFixed(2)}` : '—'}</span>
                      )}
                    </td>
                    {/* Unit Pay */}
                    <td className="px-4 py-3">
                      {projUp != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400">{formatCurrencyFull(projUp)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {formatCurrencyFull(s.unitCompensation)}</span>
                        </span>
                      ) : (
                        <span className="text-emerald-400">{formatCurrencyFull(s.unitCompensation)}</span>
                      )}
                    </td>
                    {/* Stipends */}
                    <td className="px-4 py-3">
                      {projStip != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400 font-medium">{formatCurrencyFull(projStip)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {formatCurrencyFull(s.totalStipends)}</span>
                        </span>
                      ) : (
                        <span className="text-gray-400">{formatCurrencyFull(s.totalStipends)}</span>
                      )}
                    </td>
                    {/* Total Pay */}
                    <td className="px-4 py-3">
                      {projTotal != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400 font-semibold">{formatCurrencyFull(projTotal)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {formatCurrencyFull(s.totalCompensation)}</span>
                        </span>
                      ) : (
                        <span className="text-emerald-400 font-semibold">{formatCurrencyFull(s.totalCompensation)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatHours(s.totalHours)}</td>
                    {/* $/hr */}
                    <td className="px-4 py-3">
                      {projDollarPerHr != null ? (
                        <span className="flex flex-col">
                          <span className="text-amber-400">${projDollarPerHr.toFixed(0)}</span>
                          <span className="text-gray-600 text-[10px]">actual: {actualDollarPerHr != null ? `$${actualDollarPerHr.toFixed(0)}` : '—'}</span>
                        </span>
                      ) : (
                        <span className="text-amber-400">{actualDollarPerHr != null ? `$${actualDollarPerHr.toFixed(0)}` : '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{s.daysWorked}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-800 border-t border-gray-700 font-semibold">
                <td className="px-4 py-3 text-gray-300 sticky left-0 z-10 bg-gray-800">Year Total</td>
                <td className="px-4 py-3 text-gray-300">{ytdCases}</td>
                <td className="px-4 py-3 text-indigo-400">{ytdUnits.toFixed(2)}</td>
                {/* $/Unit footer */}
                <td className="px-4 py-3">
                  {whatIfUnitRate != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">${whatIfUnitRate.toFixed(2)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: {ytdUnits > 0 ? `$${(ytdUnitPay / ytdUnits).toFixed(2)}` : '—'} avg</span>
                    </span>
                  ) : (
                    <span className="text-amber-400">{ytdUnits > 0 ? `$${(ytdUnitPay / ytdUnits).toFixed(2)} avg` : '—'}</span>
                  )}
                </td>
                {/* Unit Pay footer */}
                <td className="px-4 py-3">
                  {projYtdUnitPay != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">{formatCurrencyFull(projYtdUnitPay)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: {formatCurrencyFull(ytdUnitPay)}</span>
                    </span>
                  ) : (
                    <span className="text-emerald-400">{formatCurrencyFull(ytdUnitPay)}</span>
                  )}
                </td>
                {/* Stipends footer */}
                <td className="px-4 py-3">
                  {wiStipends != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">{formatCurrencyFull(wiStipends)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: {formatCurrencyFull(ytdStipends)}</span>
                    </span>
                  ) : (
                    <span className="text-gray-300">{formatCurrencyFull(ytdStipends)}</span>
                  )}
                </td>
                {/* Total Pay footer */}
                <td className="px-4 py-3">
                  {wiTotal != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">{formatCurrencyFull(wiTotal)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: {formatCurrencyFull(ytdTotal)} · {deltaLabel(ytdTotal, wiTotal)}</span>
                    </span>
                  ) : (
                    <span className="text-emerald-400">{formatCurrencyFull(ytdTotal)}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-300">{formatHours(ytdHours)}</td>
                <td className="px-4 py-3">
                  {wiTotal != null ? (
                    <span className="flex flex-col">
                      <span className="text-amber-400">${(wiTotal / ytdHours).toFixed(0)}</span>
                      <span className="text-gray-500 text-[10px] font-normal">actual: ${(ytdTotal / ytdHours).toFixed(0)}</span>
                    </span>
                  ) : (
                    <span className="text-amber-400">{ytdHours > 0 ? `$${(ytdTotal / ytdHours).toFixed(0)}` : '—'}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-300">{yearStats.reduce((s, m) => s + m.daysWorked, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
