export type FixedShiftKey = 'APS' | 'BR' | 'NIR'

export function getFixedShiftKey(shiftType: string): FixedShiftKey | null {
  const u = shiftType.toUpperCase()
  if (u === 'APS') return 'APS'
  if (u === 'BR') return 'BR'
  if (u === 'NIR') return 'NIR'
  return null
}

export function isCallShift(shiftType: string): boolean {
  const u = shiftType.toUpperCase()
  return u === 'G1' || u === 'G2'
}

// Shifts that are always looked up with the _Weekend suffix regardless of day of week
const ALWAYS_WEEKEND_STIPEND = new Set(['GI'])

// Canonical alias map: any key shift name → the name to use for stipend lookup
const SHIFT_ALIASES: Record<string, string> = { ENDO: 'GI' }

/** Resolve a shift name to its canonical form for stipend lookup */
export function resolveShiftAlias(shiftType: string): string {
  return SHIFT_ALIASES[shiftType.toUpperCase()] ?? shiftType
}

/** True if this shift always uses the _Weekend stipend key regardless of day */
export function isAlwaysWeekendStipend(shiftType: string): boolean {
  return ALWAYS_WEEKEND_STIPEND.has(shiftType.toUpperCase())
}

/**
 * Parse a calendar event summary into one or more shift type strings.
 * Handles combined entries like "G1 (APS)" → ["G1", "APS"].
 */
export function parseShiftSummary(summary: string): string[] {
  const tokens = summary.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []
  return tokens.length > 0 ? [...new Set(tokens)] : [summary.trim()]
}

/** True if this shift type represents a non-working day (vacation, holiday, postcall) */
export function isOffDayShift(shiftType: string): boolean {
  const u = shiftType.toUpperCase()
  return u === 'V' || u === 'H' || u === 'POSTCALL'
}

export function isWeekendOrHoliday(date: string, holidayList: string[]): boolean {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = dt.getDay()
  if (dow === 0 || dow === 6) return true
  return holidayList.includes(date)
}

export function shiftBadgeClass(shiftType: string): string {
  const key = getFixedShiftKey(shiftType)
  if (key) return 'bg-amber-900/40 text-amber-400'
  if (isCallShift(shiftType)) return 'bg-rose-900/40 text-rose-400'
  return 'bg-indigo-900/30 text-indigo-400'
}

function dateToISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nthWeekday(year: number, month: number, dow: number, n: number): string {
  const d = new Date(year, month - 1, 1)
  let count = 0
  while (true) {
    if (d.getDay() === dow) {
      count++
      if (count === n) break
    }
    d.setDate(d.getDate() + 1)
  }
  return dateToISO(d)
}

function lastWeekday(year: number, month: number, dow: number): string {
  const d = new Date(year, month, 0) // last day of month
  while (d.getDay() !== dow) d.setDate(d.getDate() - 1)
  return dateToISO(d)
}

function observed(isoDate: string): string {
  const [y, m, dy] = isoDate.split('-').map(Number)
  const d = new Date(y, m - 1, dy)
  const dow = d.getDay()
  if (dow === 6) d.setDate(d.getDate() - 1) // Saturday → Friday
  else if (dow === 0) d.setDate(d.getDate() + 1) // Sunday → Monday
  return dateToISO(d)
}

export function computeFederalHolidays(year: number): string[] {
  return [...new Set([
    observed(`${year}-01-01`),       // New Year's Day
    nthWeekday(year, 1, 1, 3),       // MLK Day: 3rd Mon Jan
    nthWeekday(year, 2, 1, 3),       // Presidents' Day: 3rd Mon Feb
    lastWeekday(year, 5, 1),         // Memorial Day: last Mon May
    observed(`${year}-06-19`),       // Juneteenth
    observed(`${year}-07-04`),       // Independence Day
    nthWeekday(year, 9, 1, 1),       // Labor Day: 1st Mon Sep
    nthWeekday(year, 10, 1, 2),      // Columbus Day: 2nd Mon Oct
    observed(`${year}-11-11`),       // Veterans Day
    nthWeekday(year, 11, 4, 4),      // Thanksgiving: 4th Thu Nov
    observed(`${year}-12-25`),       // Christmas Day
  ])].sort()
}

// Returns labels for each computed federal holiday date for a year
export function getFederalHolidayLabels(year: number): Array<{ date: string; label: string }> {
  return [
    { date: observed(`${year}-01-01`),    label: "New Year's Day" },
    { date: nthWeekday(year, 1, 1, 3),    label: 'MLK Day' },
    { date: nthWeekday(year, 2, 1, 3),    label: "Presidents' Day" },
    { date: lastWeekday(year, 5, 1),       label: 'Memorial Day' },
    { date: observed(`${year}-06-19`),    label: 'Juneteenth' },
    { date: observed(`${year}-07-04`),    label: 'Independence Day' },
    { date: nthWeekday(year, 9, 1, 1),    label: 'Labor Day' },
    { date: nthWeekday(year, 10, 1, 2),   label: 'Columbus Day' },
    { date: observed(`${year}-11-11`),    label: 'Veterans Day' },
    { date: nthWeekday(year, 11, 4, 4),   label: 'Thanksgiving' },
    { date: observed(`${year}-12-25`),    label: 'Christmas Day' },
  ]
}
