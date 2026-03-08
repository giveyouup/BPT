import type { MonthlyReport, Settings, Schedule, StipendMapping } from '../types'
import { parseShiftSummary } from './shiftUtils'

const REPORTS_KEY = 'pcr_reports'
const SETTINGS_KEY = 'pcr_settings'
const SCHEDULES_KEY = 'pcr_schedules'
const STIPEND_MAPPINGS_KEY = 'pcr_stipend_mappings'
const MANUAL_SHIFTS_KEY = 'pcr_manual_shifts'

const DEFAULT_SETTINGS: Settings = {
  defaultPaddingMinutes: 30,
  defaultNoTimeHours: 4,
  clinicalDayStart: '06:30',
  shiftHours: { APS: 10, APS_weekend: 10, BR: 9, NIR: 10 },
  holidays: {},
}

function normalize(r: MonthlyReport): MonthlyReport {
  return {
    ...r,
    stipends: r.stipends ?? [],
    workingDayOverrides: r.workingDayOverrides ?? {},
    dayStipends: r.dayStipends ?? {},
  }
}

function normalizeSettings(s: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    shiftHours: { ...DEFAULT_SETTINGS.shiftHours, ...(s.shiftHours ?? {}) },
    holidays: s.holidays ?? {},
  }
}

export function getReports(): MonthlyReport[] {
  try {
    const raw = localStorage.getItem(REPORTS_KEY)
    const parsed: MonthlyReport[] = raw ? JSON.parse(raw) : []
    return parsed.map(normalize)
  } catch {
    return []
  }
}

export function getReport(id: string): MonthlyReport | undefined {
  return getReports().find((r) => r.id === id)
}

export function saveReport(report: MonthlyReport): void {
  const reports = getReports()
  const idx = reports.findIndex((r) => r.id === report.id)
  if (idx >= 0) {
    reports[idx] = normalize(report)
  } else {
    reports.push(normalize(report))
  }
  reports.sort((a, b) => a.id.localeCompare(b.id))
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports))
}

export function deleteReport(id: string): void {
  const reports = getReports().filter((r) => r.id !== id)
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports))
}

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? normalizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

function getManualShifts(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(MANUAL_SHIFTS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveManualShift(date: string, shiftTypes: string[]): void {
  const shifts = getManualShifts()
  if (shiftTypes.length === 0) {
    delete shifts[date]
  } else {
    shifts[date] = shiftTypes
  }
  localStorage.setItem(MANUAL_SHIFTS_KEY, JSON.stringify(shifts))
}

export function getSchedules(): Schedule[] {
  try {
    const raw = localStorage.getItem(SCHEDULES_KEY)
    const parsed: Schedule[] = raw ? JSON.parse(raw) : []
    const normalized = parsed.map((s) => ({
      ...s,
      entries: s.entries.map((e) => {
        const entry = e as typeof e & { shiftType?: string }
        const rawTypes: string[] = e.shiftTypes
          ?? (entry.shiftType ? [entry.shiftType] : [])
        const expanded = [...new Set(rawTypes.flatMap(parseShiftSummary))]
        return { date: e.date, shiftTypes: expanded, hoursOverride: e.hoursOverride }
      }),
    }))
    // Inject manual shifts as a highest-priority virtual schedule (uploadDate far future = always wins)
    const manual = getManualShifts()
    const manualEntries = Object.entries(manual).map(([date, shiftTypes]) => ({ date, shiftTypes, hoursOverride: undefined }))
    if (manualEntries.length > 0) {
      normalized.push({
        id: 'manual_shifts',
        filename: 'Manual Entries',
        uploadDate: '9999-12-31T00:00:00.000Z',
        entries: manualEntries,
      })
    }
    return normalized
  } catch {
    return []
  }
}

export function saveSchedule(schedule: Schedule): void {
  const schedules = getSchedules()
  const idx = schedules.findIndex((s) => s.id === schedule.id)
  if (idx >= 0) {
    schedules[idx] = schedule
  } else {
    schedules.push(schedule)
  }
  schedules.sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(schedules))
}

export function deleteSchedule(id: string): void {
  const schedules = getSchedules().filter((s) => s.id !== id)
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(schedules))
}

function lastDayOfMonthDate(ym: string): string {
  const [y, mo] = ym.split('-').map(Number)
  const d = new Date(y, mo, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getStipendMappings(): StipendMapping[] {
  try {
    const raw = localStorage.getItem(STIPEND_MAPPINGS_KEY)
    const parsed: StipendMapping[] = raw ? JSON.parse(raw) : []
    return parsed.map((m) => ({
      ...m,
      // Backward-compat: back-fill name from filename for old records
      name: m.name ?? m.filename,
      // Migrate old endDates stored as YYYY-MM-01 (first of month) to last day of that month
      endDate: m.endDate?.endsWith('-01') ? lastDayOfMonthDate(m.endDate.slice(0, 7)) : m.endDate,
    }))
  } catch {
    return []
  }
}

export function saveStipendMapping(mapping: StipendMapping): void {
  const mappings = getStipendMappings()
  const idx = mappings.findIndex((m) => m.id === mapping.id)
  if (idx >= 0) {
    mappings[idx] = mapping
  } else {
    mappings.push(mapping)
  }
  // Sort by effectiveDate ascending
  mappings.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
  localStorage.setItem(STIPEND_MAPPINGS_KEY, JSON.stringify(mappings))
}

export function deleteStipendMapping(id: string): void {
  const mappings = getStipendMappings().filter((m) => m.id !== id)
  localStorage.setItem(STIPEND_MAPPINGS_KEY, JSON.stringify(mappings))
}
