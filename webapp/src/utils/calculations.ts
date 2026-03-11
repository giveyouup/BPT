import type {
  LineItem,
  MonthlyReport,
  MonthlyStats,
  WorkingDayStats,
  CaseSummary,
  Schedule,
  ShiftEntry,
  Settings,
  StipendMapping,
} from '../types'
import { timeToMinutes, durationMinutes } from './dateUtils'
import {
  getFixedShiftKey,
  isCallShift,
  isOffDayShift,
  isWeekendOrHoliday,
  computeFederalHolidays,
  resolveShiftAlias,
  isAlwaysWeekendStipend,
} from './shiftUtils'

// ─── Stipend helpers ──────────────────────────────────────────────────────────

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getApplicableMapping(
  year: number,
  month: number,
  allMappings: StipendMapping[],
  overrideMappingId?: string
): StipendMapping | null {
  if (overrideMappingId) {
    return allMappings.find((m) => m.id === overrideMappingId) ?? null
  }
  const cutoff = lastDayOfMonth(year, month)
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const applicable = allMappings
    .filter((m) => m.effectiveDate <= cutoff && (!m.endDate || m.endDate >= firstDay))
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
  return applicable[0] ?? null
}

export function getStipendForDay(
  shiftTypes: string[],
  isWeekend: boolean,
  mapping: StipendMapping | null
): number {
  if (!shiftTypes.length || !mapping) return 0
  let total = 0
  for (const raw of shiftTypes) {
    const shiftType = resolveShiftAlias(raw) // e.g. ENDO → GI

    if (isCallShift(shiftType)) {
      // Call shifts (G1/G2): always use _weekend or _weekday suffix
      const key = `${shiftType}_${isWeekend ? 'weekend' : 'weekday'}`.toLowerCase()
      total += mapping.rates.find((r) => r.shiftType.toLowerCase() === key)?.amount ?? 0
    } else if (isAlwaysWeekendStipend(shiftType)) {
      // Shifts that always use the _Weekend rate (e.g. GI/ENDO)
      const key = `${shiftType}_weekend`.toLowerCase()
      total += mapping.rates.find((r) => r.shiftType.toLowerCase() === key)?.amount ?? 0
    } else {
      // Regular shifts: try _weekend/_weekday variant first, then plain name
      const suffix = isWeekend ? 'weekend' : 'weekday'
      const variantKey = `${shiftType}_${suffix}`.toLowerCase()
      const variantRate = mapping.rates.find((r) => r.shiftType.toLowerCase() === variantKey)
      if (variantRate) {
        total += variantRate.amount
      } else {
        total += mapping.rates.find((r) => r.shiftType.toLowerCase() === shiftType.toLowerCase())?.amount ?? 0
      }
    }
  }
  return total
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize a time (in minutes since midnight) to the clinical day.
 * Times before clinicalDayStartMins are treated as belonging to the tail
 * of the previous calendar day, so +1440 is added to push them past midnight.
 */
function normalizeMins(mins: number, clinicalDayStartMins: number): number {
  return mins < clinicalDayStartMins ? mins + 1440 : mins
}

function getMinMaxMinutes(
  timedItems: LineItem[],
  clinicalDayStartMins: number
): { minStart: number; maxEnd: number } {
  let minStart = Infinity
  let maxEnd = -Infinity
  for (const li of timedItems) {
    const start = normalizeMins(timeToMinutes(li.startTime!), clinicalDayStartMins)
    let end = normalizeMins(timeToMinutes(li.endTime!), clinicalDayStartMins)
    if (end <= start) end += 1440
    if (start < minStart) minStart = start
    if (end > maxEnd) maxEnd = end
  }
  return { minStart, maxEnd }
}

function getStartEndTimes(
  timedItems: LineItem[],
  clinicalDayStartMins: number
): {
  firstStartTime: string | null
  lastEndTime: string | null
} {
  let minStart = Infinity
  let maxEnd = -Infinity
  let firstStartTime: string | null = null
  let lastEndTime: string | null = null
  for (const li of timedItems) {
    const start = normalizeMins(timeToMinutes(li.startTime!), clinicalDayStartMins)
    let end = normalizeMins(timeToMinutes(li.endTime!), clinicalDayStartMins)
    if (end <= start) end += 1440
    if (start < minStart) { minStart = start; firstStartTime = li.startTime! }
    if (end > maxEnd) { maxEnd = end; lastEndTime = li.endTime! }
  }
  return { firstStartTime, lastEndTime }
}

// ─── Working days computation ─────────────────────────────────────────────────

function computeWorkingDays(
  lineItems: LineItem[],
  paddingMinutes: number,
  defaultNoTimeHours: number,
  overrides: Record<string, number>,
  shiftMap?: Map<string, ShiftEntry>,
  shiftHours?: { APS: number; APS_weekend: number; BR: number; NIR: number },
  holidayList?: string[],
  unitDollarValue?: number,
  stipendMapping?: StipendMapping | null,
  dayStipends?: Record<string, number>,
  clinicalDayStartMins = 390 // 06:30 default
): WorkingDayStats[] {
  const byDate = new Map<string, LineItem[]>()
  for (const li of lineItems) {
    if (!byDate.has(li.serviceDate)) byDate.set(li.serviceDate, [])
    byDate.get(li.serviceDate)!.push(li)
  }

  const days: WorkingDayStats[] = []

  for (const [date, items] of byDate) {
    const timedItems = items.filter((li) => li.startTime && li.endTime)
    const hasTimes = timedItems.length > 0
    const caseCount = new Set(items.map((li) => li.ticketNum)).size
    const isOverridden = overrides[date] !== undefined

    const shiftEntry = shiftMap?.get(date)
    const shiftTypes = shiftEntry?.shiftTypes ?? []
    const fixedKey = shiftTypes.reduce<ReturnType<typeof getFixedShiftKey>>(
      (k, s) => k ?? getFixedShiftKey(s), null
    )
    const hasVariableShift = shiftTypes.some((s) => !isOffDayShift(s) && !getFixedShiftKey(resolveShiftAlias(s.toUpperCase())))
    const isCallWeekend = shiftTypes.length > 0 && !!holidayList && isWeekendOrHoliday(date, holidayList)

    let firstStartTime: string | null = null
    let lastEndTime: string | null = null
    let hours: number

    if (isOverridden) {
      hours = overrides[date]
      if (hasTimes) ({ firstStartTime, lastEndTime } = getStartEndTimes(timedItems, clinicalDayStartMins))
    } else if (fixedKey && shiftHours && !hasVariableShift) {
      hours = fixedKey === 'APS' && isCallWeekend ? shiftHours.APS_weekend : shiftHours[fixedKey]
      if (hasTimes) ({ firstStartTime, lastEndTime } = getStartEndTimes(timedItems, clinicalDayStartMins))
    } else if (hasTimes) {
      ;({ firstStartTime, lastEndTime } = getStartEndTimes(timedItems, clinicalDayStartMins))
      const { minStart, maxEnd } = getMinMaxMinutes(timedItems, clinicalDayStartMins)
      hours = (maxEnd - minStart + paddingMinutes) / 60
    } else if (shiftTypes.length > 0 && shiftTypes.every(isOffDayShift)) {
      hours = 0
    } else {
      hours = defaultNoTimeHours
    }

    const totalUnits = items.reduce((s, li) => s + li.totalDistributableUnits, 0)
    const unitPay = unitDollarValue !== undefined ? totalUnits * unitDollarValue : 0
    const stipendAmount = getStipendForDay(shiftTypes, isCallWeekend, stipendMapping ?? null)
    const additionalStipend = dayStipends?.[date] ?? 0
    const totalDayPay = unitPay + stipendAmount + additionalStipend

    days.push({
      date,
      caseCount,
      hasTimes,
      firstStartTime,
      lastEndTime,
      hours,
      isOverridden,
      isDefault: !hasTimes && !isOverridden && !fixedKey,
      shiftTypes,
      hasProduction: true,
      isCallWeekend,
      totalUnits,
      unitPay,
      stipendAmount,
      additionalStipend,
      totalDayPay,
    })
  }

  return days.sort((a, b) => a.date.localeCompare(b.date))
}

function computeCaseSummaries(lineItems: LineItem[]): CaseSummary[] {
  const byTicket = new Map<string, LineItem[]>()
  for (const li of lineItems) {
    if (!byTicket.has(li.ticketNum)) byTicket.set(li.ticketNum, [])
    byTicket.get(li.ticketNum)!.push(li)
  }

  const summaries: CaseSummary[] = []
  for (const [ticketNum, lines] of byTicket) {
    const primaryLine = lines.find((l) => l.startTime && l.endTime) ?? lines[0]
    const totalUnits = lines.reduce((s, l) => s + l.totalDistributableUnits, 0)
    const addOnUnits = lines
      .filter((l) => l !== primaryLine)
      .reduce((s, l) => s + l.totalDistributableUnits, 0)

    let dur: number | null = null
    if (primaryLine.startTime && primaryLine.endTime) {
      dur = durationMinutes(primaryLine.startTime, primaryLine.endTime)
    }

    summaries.push({
      ticketNum,
      serviceDate: primaryLine.serviceDate,
      isSplit: ticketNum.toUpperCase().endsWith('S'),
      primaryCptAsa: primaryLine.cptAsa,
      primaryModifier: primaryLine.modifier,
      primaryDistributionValue: primaryLine.distributionValue,
      primaryTimeUnits: primaryLine.timeUnits,
      addOnUnits,
      totalUnits,
      startTime: primaryLine.startTime,
      endTime: primaryLine.endTime,
      durationMinutes: dur,
      lineCount: lines.length,
    })
  }

  return summaries.sort(
    (a, b) =>
      a.serviceDate.localeCompare(b.serviceDate) ||
      a.ticketNum.localeCompare(b.ticketNum)
  )
}

function buildShiftMap(allSchedules: Schedule[]): Map<string, ShiftEntry> {
  const sorted = [...allSchedules].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
  const map = new Map<string, ShiftEntry>()
  for (const schedule of sorted) {
    for (const entry of schedule.entries) {
      map.set(entry.date, entry)
    }
  }
  return map
}

// ─── Midnight attribution ─────────────────────────────────────────────────────

function getPrevDate(date: string): string {
  const d = new Date(date + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * If a line item starts before clinicalDayStart and the preceding calendar date
 * has a call shift in the schedule, reassign it to that prior date.
 */
function effectiveServiceDate(
  li: LineItem,
  shiftMap: Map<string, ShiftEntry>,
  clinicalDayStart: string
): string {
  if (li.startTime && li.startTime < clinicalDayStart) {
    const prev = getPrevDate(li.serviceDate)
    const prevEntry = shiftMap.get(prev)
    if (prevEntry && prevEntry.shiftTypes.some((st) => isCallShift(resolveShiftAlias(st)))) {
      return prev
    }
  }
  return li.serviceDate
}

/**
 * Build a map of ticketNum → reassigned date for any ticket whose timed primary
 * line qualifies for midnight attribution. Add-on lines (no startTime) on the
 * same ticket inherit the reassignment via this map.
 */
function buildTicketReassignmentMap(
  allReports: MonthlyReport[],
  shiftMap: Map<string, ShiftEntry>,
  clinicalDayStart: string
): Map<string, string> {
  const map = new Map<string, string>()
  for (const report of allReports) {
    for (const li of report.lineItems) {
      if (li.startTime) {
        const eff = effectiveServiceDate(li, shiftMap, clinicalDayStart)
        if (eff !== li.serviceDate) {
          map.set(li.ticketNum, eff)
        }
      }
    }
  }
  return map
}

/**
 * For each ticket number, collect the sorted list of scheduled working-day dates
 * that the ticket's line items fall on (after midnight attribution). Used to
 * attribute orphaned line items on non-working days to the correct working day.
 */
function buildTicketWorkingDayMap(
  allReports: MonthlyReport[],
  shiftMap: Map<string, ShiftEntry>,
  ticketReassign: Map<string, string>,
  clinicalDayStart: string
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const report of allReports) {
    for (const li of report.lineItems) {
      const effDate = ticketReassign.get(li.ticketNum) ?? effectiveServiceDate(li, shiftMap, clinicalDayStart)
      const entry = shiftMap.get(effDate)
      if (entry && entry.shiftTypes.length > 0 && !entry.shiftTypes.every(isOffDayShift)) {
        if (!result.has(li.ticketNum)) result.set(li.ticketNum, [])
        const days = result.get(li.ticketNum)!
        if (!days.includes(effDate)) { days.push(effDate); days.sort() }
      }
    }
  }
  return result
}

/**
 * If effDate is not a scheduled working day, redirect to the most recent
 * scheduled working day for that ticket (on or before effDate), or the
 * earliest if none precedes it. Returns effDate unchanged if it is already
 * a working day or the ticket has no known working days.
 */
function applyOrphanAttribution(
  effDate: string,
  ticketNum: string,
  shiftMap: Map<string, ShiftEntry>,
  ticketWorkingDays: Map<string, string[]>
): string {
  const entry = shiftMap.get(effDate)
  const isWorkingDay = entry && entry.shiftTypes.length > 0 && !entry.shiftTypes.every(isOffDayShift)
  if (isWorkingDay) return effDate
  const wds = ticketWorkingDays.get(ticketNum) ?? []
  return [...wds].reverse().find(d => d <= effDate) ?? wds[0] ?? effDate
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function computeMonthlyStats(
  report: MonthlyReport,
  allSchedules?: Schedule[],
  settings?: Settings,
  allMappings?: StipendMapping[]
): MonthlyStats {
  const {
    lineItems,
    unitDollarValue,
    paddingMinutes,
    workingDayOverrides,
    dayStipends,
    stipends,
  } = report
  const defaultNoTimeHours = settings?.defaultNoTimeHours ?? report.defaultNoTimeHours

  const totalCases = new Set(lineItems.map((li) => li.ticketNum)).size
  const totalDistributableUnits = lineItems.reduce((s, li) => s + li.totalDistributableUnits, 0)
  const unitCompensation = totalDistributableUnits * unitDollarValue

  const shiftMap = allSchedules?.length ? buildShiftMap(allSchedules) : undefined
  const holidayList = settings
    ? (settings.holidays[report.year] ?? computeFederalHolidays(report.year))
    : undefined

  const applicableMapping = allMappings?.length
    ? getApplicableMapping(report.year, report.month, allMappings)
    : null

  const clinicalDayStartMins = settings ? timeToMinutes(settings.clinicalDayStart) : 390
  const workingDays = computeWorkingDays(
    lineItems, paddingMinutes, defaultNoTimeHours, workingDayOverrides,
    shiftMap, settings?.shiftHours, holidayList,
    unitDollarValue, applicableMapping, dayStipends, clinicalDayStartMins
  )

  const totalHours = workingDays.reduce((s, d) => s + d.hours, 0)
  const cases = computeCaseSummaries(lineItems)

  const shiftStipends = workingDays.reduce((s, d) => s + d.stipendAmount, 0)
  const additionalStipends = workingDays.reduce((s, d) => s + d.additionalStipend, 0)
    + stipends.reduce((s, st) => s + st.amount, 0) // include legacy stipends
  const totalStipends = shiftStipends + additionalStipends
  const totalCompensation = unitCompensation + totalStipends

  const weekdayCallDays = workingDays.filter(
    (d) => d.shiftTypes.some(isCallShift) && !d.isCallWeekend
  ).length
  const weekendCallDays = workingDays.filter(
    (d) => d.shiftTypes.some(isCallShift) && d.isCallWeekend
  ).length

  return {
    id: report.id,
    year: report.year,
    month: report.month,
    totalCases,
    totalDistributableUnits,
    unitCompensation,
    shiftStipends,
    additionalStipends,
    totalStipends,
    totalCompensation,
    totalHours,
    daysWorked: workingDays.length,
    workingDays,
    cases,
    weekdayCallDays,
    weekendCallDays,
  }
}


export function computeCalendarMonthWorkingDays(
  calYear: number,
  calMonth: number,
  allReports: MonthlyReport[],
  allSchedules: Schedule[],
  settings: Settings,
  allMappings: StipendMapping[] = []
): WorkingDayStats[] {
  const monthPrefix = `${calYear}-${String(calMonth).padStart(2, '0')}`

  const clinicalDayStart = settings.clinicalDayStart
  const clinicalDayStartMins = timeToMinutes(clinicalDayStart)

  // Build shift map first — needed for midnight attribution before item collection
  const shiftMap = buildShiftMap(allSchedules)
  // Ticket-level reassignment: add-on lines (no startTime) follow their ticket's primary line
  const ticketReassign = buildTicketReassignmentMap(allReports, shiftMap, clinicalDayStart)
  // Orphan attribution: line items on non-working days redirected to ticket's most recent working day
  const ticketWorkingDays = buildTicketWorkingDayMap(allReports, shiftMap, ticketReassign, clinicalDayStart)

  // Collect line items and compute per-date unit totals (each item uses its source report's $/unit)
  const allItems: LineItem[] = []
  const dailyUnits = new Map<string, number>()
  const dailyUnitPay = new Map<string, number>()

  for (const report of allReports) {
    for (const li of report.lineItems) {
      const effDate = applyOrphanAttribution(
        ticketReassign.get(li.ticketNum) ?? effectiveServiceDate(li, shiftMap, clinicalDayStart),
        li.ticketNum, shiftMap, ticketWorkingDays
      )
      if (effDate.startsWith(monthPrefix)) {
        const adjustedLi = effDate === li.serviceDate ? li : { ...li, serviceDate: effDate }
        allItems.push(adjustedLi)
        dailyUnits.set(effDate, (dailyUnits.get(effDate) ?? 0) + li.totalDistributableUnits)
        dailyUnitPay.set(effDate, (dailyUnitPay.get(effDate) ?? 0) + li.totalDistributableUnits * report.unitDollarValue)
      }
    }
  }

  // Merge overrides: most recently uploaded report wins per date
  const sortedByUpload = [...allReports].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
  const mergedOverrides: Record<string, number> = {}
  for (const report of sortedByUpload) {
    for (const [date, hours] of Object.entries(report.workingDayOverrides)) {
      if (date.startsWith(monthPrefix)) mergedOverrides[date] = hours
    }
  }

  const labeledReport = allReports.find((r) => r.year === calYear && r.month === calMonth)
  const paddingMinutes = labeledReport?.paddingMinutes ?? 30
  const defaultNoTimeHours = settings.defaultNoTimeHours
  const holidayList = settings.holidays[calYear] ?? computeFederalHolidays(calYear)

  // Auto-select mapping for this calendar month (use labeled report's override if set)
  const applicableMapping = allMappings.length
    ? getApplicableMapping(calYear, calMonth, allMappings)
    : null

  // Compute PCR-based working days (unitDollarValue=undefined, we'll annotate after)
  const pcrDays = computeWorkingDays(
    allItems, paddingMinutes, defaultNoTimeHours, mergedOverrides,
    shiftMap, settings.shiftHours, holidayList,
    undefined, applicableMapping, undefined, clinicalDayStartMins
  )

  const labeledDayStipends = labeledReport?.dayStipends ?? {}

  // Annotate with correct per-report unit pay and per-day additional stipend
  for (const day of pcrDays) {
    day.totalUnits = dailyUnits.get(day.date) ?? 0
    day.unitPay = dailyUnitPay.get(day.date) ?? 0
    day.additionalStipend = labeledDayStipends[day.date] ?? 0
    day.totalDayPay = day.unitPay + day.stipendAmount + day.additionalStipend
  }

  const pcrDayMap = new Map(pcrDays.map((d) => [d.date, d]))
  const result: WorkingDayStats[] = [...pcrDays]

  // Add shift-only days (no PCR line items)
  for (const [date, shiftEntry] of shiftMap) {
    if (!date.startsWith(monthPrefix)) continue
    if (pcrDayMap.has(date)) continue

    const shiftTypes = shiftEntry.shiftTypes
    const fixedKey = shiftTypes.reduce<ReturnType<typeof getFixedShiftKey>>(
      (k, s) => k ?? getFixedShiftKey(s), null
    )
    const hasVariableShift = shiftTypes.some((s) => !isOffDayShift(s) && !getFixedShiftKey(resolveShiftAlias(s.toUpperCase())))
    const isCallWeekend = shiftTypes.length > 0 && isWeekendOrHoliday(date, holidayList)
    const stipendAmount = getStipendForDay(shiftTypes, isCallWeekend, applicableMapping)
    const additionalStipend = labeledDayStipends[date] ?? 0

    let hours = 0
    let isOverridden = false

    if (mergedOverrides[date] !== undefined) {
      hours = mergedOverrides[date]
      isOverridden = true
    } else if (shiftEntry.hoursOverride !== undefined) {
      hours = shiftEntry.hoursOverride
      isOverridden = true
    } else if (fixedKey && !hasVariableShift) {
      hours = fixedKey === 'APS' && isCallWeekend ? settings.shiftHours.APS_weekend : settings.shiftHours[fixedKey]
    } else if (shiftTypes.every(isOffDayShift)) {
      hours = 0
    } else {
      hours = settings.defaultNoTimeHours
    }

    result.push({
      date,
      caseCount: 0,
      hasTimes: false,
      firstStartTime: null,
      lastEndTime: null,
      hours,
      isOverridden,
      isDefault: false,
      shiftTypes,
      hasProduction: false,
      isCallWeekend,
      totalUnits: 0,
      unitPay: 0,
      stipendAmount,
      additionalStipend,
      totalDayPay: stipendAmount + additionalStipend,
    })
  }

  return result.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Service-date based stats ─────────────────────────────────────────────────
// Groups line items by their actual serviceDate month rather than the report label.
// Used by Dashboard and Annual Summary. MonthlyDetail continues to use computeMonthlyStats.

export function computeCalendarMonthStats(
  calYear: number,
  calMonth: number,
  allReports: MonthlyReport[],
  allSchedules: Schedule[],
  settings: Settings,
  allMappings: StipendMapping[] = []
): MonthlyStats | null {
  const monthPrefix = `${calYear}-${String(calMonth).padStart(2, '0')}`

  const clinicalDayStart = settings.clinicalDayStart

  // Build shift map early for midnight attribution
  const shiftMap = buildShiftMap(allSchedules)
  const ticketReassign = buildTicketReassignmentMap(allReports, shiftMap, clinicalDayStart)
  const ticketWorkingDays = buildTicketWorkingDayMap(allReports, shiftMap, ticketReassign, clinicalDayStart)

  // Collect all line items whose effective service date falls in this calendar month
  const allItems: LineItem[] = []
  let totalDistributableUnits = 0
  let unitCompensation = 0
  for (const report of allReports) {
    for (const li of report.lineItems) {
      const effDate = applyOrphanAttribution(
        ticketReassign.get(li.ticketNum) ?? effectiveServiceDate(li, shiftMap, clinicalDayStart),
        li.ticketNum, shiftMap, ticketWorkingDays
      )
      if (effDate.startsWith(monthPrefix)) {
        const adjustedLi = effDate === li.serviceDate ? li : { ...li, serviceDate: effDate }
        allItems.push(adjustedLi)
        totalDistributableUnits += li.totalDistributableUnits
        unitCompensation += li.totalDistributableUnits * report.unitDollarValue
      }
    }
  }

  const workingDays = computeCalendarMonthWorkingDays(
    calYear, calMonth, allReports, allSchedules, settings, allMappings
  )

  if (allItems.length === 0 && workingDays.length === 0) return null

  const totalCases = new Set(allItems.map((li) => li.ticketNum)).size
  const cases = computeCaseSummaries(allItems)

  const shiftStipends = workingDays.reduce((s, d) => s + d.stipendAmount, 0)
  const additionalStipends = workingDays.reduce((s, d) => s + d.additionalStipend, 0)
  const totalStipends = shiftStipends + additionalStipends
  const totalCompensation = unitCompensation + totalStipends
  const totalHours = workingDays.reduce((s, d) => s + d.hours, 0)
  const daysWorked = workingDays.filter((d) => d.hasProduction).length

  const weekdayCallDays = workingDays.filter(
    (d) => d.shiftTypes.some(isCallShift) && !d.isCallWeekend
  ).length
  const weekendCallDays = workingDays.filter(
    (d) => d.shiftTypes.some(isCallShift) && d.isCallWeekend
  ).length

  return {
    id: monthPrefix,
    year: calYear,
    month: calMonth,
    totalCases,
    totalDistributableUnits,
    unitCompensation,
    shiftStipends,
    additionalStipends,
    totalStipends,
    totalCompensation,
    totalHours,
    daysWorked,
    workingDays,
    cases,
    weekdayCallDays,
    weekendCallDays,
  }
}

export function computeCalendarYearStats(
  year: number,
  allReports: MonthlyReport[],
  allSchedules: Schedule[],
  settings: Settings,
  allMappings: StipendMapping[] = []
): MonthlyStats[] {
  const results: MonthlyStats[] = []
  for (let month = 1; month <= 12; month++) {
    const stats = computeCalendarMonthStats(year, month, allReports, allSchedules, settings, allMappings)
    if (stats) results.push(stats)
  }
  return results
}
