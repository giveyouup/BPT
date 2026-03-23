export interface WeekendPair {
  dates: string[]   // [satDate, sunDate] or lone [date] for edge months
  label: string     // e.g. "4–5", "30", "1"
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Returns all Sat/Sun pairs (and lone weekend days at month boundaries) for a month. */
export function getWeekendPairs(year: number, month: number): WeekendPair[] {
  const ym = `${year}-${pad(month)}`
  const daysInMonth = new Date(year, month, 0).getDate()
  const pairs: WeekendPair[] = []

  // Month starts on Sunday → lone Sunday with no Saturday in this month
  if (new Date(year, month - 1, 1).getDay() === 0) {
    pairs.push({ dates: [`${ym}-01`], label: '1' })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(year, month - 1, d).getDay() === 6) {
      const satDate = `${ym}-${pad(d)}`
      if (d + 1 <= daysInMonth) {
        pairs.push({ dates: [satDate, `${ym}-${pad(d + 1)}`], label: `${d}–${d + 1}` })
      } else {
        // Saturday is last day of month — no Sunday in this month
        pairs.push({ dates: [satDate], label: `${d}` })
      }
    }
  }

  return pairs
}

/** Builds the ordered list of dates that should appear as tokens in the pasted row. */
export function buildDayList(year: number, month: number, activeWeekendDates: Set<string>): string[] {
  const ym = `${year}-${pad(month)}`
  const daysInMonth = new Date(year, month, 0).getDate()
  const days: string[] = []

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${ym}-${pad(d)}`
    const dow = new Date(year, month - 1, d).getDay()
    const isWeekend = dow === 0 || dow === 6
    if (!isWeekend || activeWeekendDates.has(date)) {
      days.push(date)
    }
  }

  return days
}

export interface ParsedShiftEntry {
  date: string
  shift: string
}

export interface ParseScheduleResult {
  entries: ParsedShiftEntry[]
  error?: string
}

/**
 * Parses a pasted schedule row into dated shift entries.
 * Backslash tokens (blocked weekends) are silently skipped — no calendar entry created.
 */
export function parseScheduleText(
  year: number,
  month: number,
  activeWeekendDates: Set<string>,
  pastedText: string,
): ParseScheduleResult {
  const tokens = pastedText.trim().split(/\s+/).filter(Boolean)
  const dayList = buildDayList(year, month, activeWeekendDates)

  if (tokens.length !== dayList.length) {
    const diff = tokens.length - dayList.length
    return {
      entries: [],
      error: `Expected ${dayList.length} entries but got ${tokens.length} (${Math.abs(diff)} ${diff > 0 ? 'extra' : 'missing'}). Adjust weekend selections.`,
    }
  }

  const entries: ParsedShiftEntry[] = []
  for (let i = 0; i < dayList.length; i++) {
    if (tokens[i] !== '\\') {
      entries.push({ date: dayList[i], shift: tokens[i] })
    }
    // backslash = blocked weekend — skip
  }

  return { entries }
}
