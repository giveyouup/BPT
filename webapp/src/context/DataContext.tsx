import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import type { MonthlyReport, Schedule, Settings, StipendMapping } from '../types'
import { api } from '../api'
import { parseShiftSummary } from '../utils/shiftUtils'

const DEFAULT_SETTINGS: Settings = {
  defaultPaddingMinutes: 30,
  defaultNoTimeHours: 4,
  clinicalDayStart: '06:30',
  shiftHours: { APS: 10, APS_weekend: 10, BR: 9, NIR: 10 },
  holidays: {},
}

function normalizeReport(r: MonthlyReport): MonthlyReport {
  return {
    ...r,
    stipends: r.stipends ?? [],
    workingDayOverrides: r.workingDayOverrides ?? {},
    dayStipends: r.dayStipends ?? {},
  }
}

function normalizeStipendMapping(m: StipendMapping): StipendMapping {
  const endDate = m.endDate?.endsWith('-01')
    ? lastDayOfMonth(m.endDate.slice(0, 7))
    : m.endDate
  return { ...m, name: m.name ?? m.filename, endDate }
}

function lastDayOfMonth(ym: string): string {
  const [y, mo] = ym.split('-').map(Number)
  const d = new Date(y, mo, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface DataContextValue {
  reports: MonthlyReport[]
  schedules: Schedule[]
  settings: Settings
  stipendMappings: StipendMapping[]
  loading: boolean
  saveReport: (r: MonthlyReport) => Promise<void>
  deleteReport: (id: string) => Promise<void>
  saveSchedule: (s: Schedule) => Promise<void>
  deleteSchedule: (id: string) => Promise<void>
  saveManualShift: (date: string, shiftTypes: string[]) => Promise<void>
  saveSettings: (s: Settings) => Promise<void>
  saveStipendMapping: (m: StipendMapping) => Promise<void>
  deleteStipendMapping: (id: string) => Promise<void>
}

const DataContext = createContext<DataContextValue | null>(null)

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [rawReports, setRawReports] = useState<MonthlyReport[]>([])
  const [rawSchedules, setRawSchedules] = useState<Schedule[]>([])
  const [manualShifts, setManualShifts] = useState<Record<string, string[]>>({})
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [rawStipendMappings, setRawStipendMappings] = useState<StipendMapping[]>([])

  useEffect(() => {
    Promise.all([
      api.reports.list(),
      api.schedules.list(),
      api.manualShifts.list(),
      api.settings.get(),
      api.stipendMappings.list(),
    ]).then(([rpts, scheds, manual, setts, mappings]) => {
      setRawReports(rpts)
      setRawSchedules(scheds)
      setManualShifts(manual)
      setSettings({ ...DEFAULT_SETTINGS, ...setts, shiftHours: { ...DEFAULT_SETTINGS.shiftHours, ...setts.shiftHours } })
      setRawStipendMappings(mappings)
      setLoading(false)
    }).catch((err) => {
      console.error('Failed to load data:', err)
      setLoading(false)
    })
  }, [])

  const reports = useMemo(() => rawReports.map(normalizeReport), [rawReports])

  const schedules = useMemo(() => {
    const normalized = rawSchedules.map((s) => ({
      ...s,
      entries: s.entries.map((e) => {
        const entry = e as typeof e & { shiftType?: string }
        const rawTypes: string[] = e.shiftTypes ?? (entry.shiftType ? [entry.shiftType] : [])
        const expanded = [...new Set(rawTypes.flatMap(parseShiftSummary))]
        return { date: e.date, shiftTypes: expanded, hoursOverride: e.hoursOverride }
      }),
    }))
    const manualEntries = Object.entries(manualShifts).map(([date, shiftTypes]) => ({
      date, shiftTypes, hoursOverride: undefined as number | undefined,
    }))
    if (manualEntries.length > 0) {
      normalized.push({
        id: 'manual_shifts',
        filename: 'Manual Entries',
        uploadDate: '9999-12-31T00:00:00.000Z',
        entries: manualEntries,
      })
    }
    return normalized
  }, [rawSchedules, manualShifts])

  const stipendMappings = useMemo(
    () => rawStipendMappings.map(normalizeStipendMapping),
    [rawStipendMappings],
  )

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const saveReport = async (report: MonthlyReport) => {
    await api.reports.upsert(report)
    const normalized = normalizeReport(report)
    setRawReports((prev) => {
      const idx = prev.findIndex((r) => r.id === report.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = normalized
        return next
      }
      return [...prev, normalized].sort((a, b) => a.id.localeCompare(b.id))
    })
  }

  const deleteReport = async (id: string) => {
    await api.reports.delete(id)
    setRawReports((prev) => prev.filter((r) => r.id !== id))
  }

  const saveSchedule = async (schedule: Schedule) => {
    await api.schedules.upsert(schedule)
    setRawSchedules((prev) => {
      const idx = prev.findIndex((s) => s.id === schedule.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = schedule
        return next
      }
      return [...prev, schedule].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
    })
  }

  const deleteSchedule = async (id: string) => {
    await api.schedules.delete(id)
    setRawSchedules((prev) => prev.filter((s) => s.id !== id))
  }

  const saveManualShift = async (date: string, shiftTypes: string[]) => {
    await api.manualShifts.upsert(date, shiftTypes)
    setManualShifts((prev) => {
      const next = { ...prev }
      if (shiftTypes.length === 0) delete next[date]
      else next[date] = shiftTypes
      return next
    })
  }

  const saveSettings = async (s: Settings) => {
    await api.settings.upsert(s)
    setSettings(s)
  }

  const saveStipendMapping = async (mapping: StipendMapping) => {
    await api.stipendMappings.upsert(mapping)
    setRawStipendMappings((prev) => {
      const idx = prev.findIndex((m) => m.id === mapping.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = mapping
        return next
      }
      return [...prev, mapping].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    })
  }

  const deleteStipendMapping = async (id: string) => {
    await api.stipendMappings.delete(id)
    setRawStipendMappings((prev) => prev.filter((m) => m.id !== id))
  }

  return (
    <DataContext.Provider value={{
      reports, schedules, settings, stipendMappings, loading,
      saveReport, deleteReport,
      saveSchedule, deleteSchedule, saveManualShift,
      saveSettings,
      saveStipendMapping, deleteStipendMapping,
    }}>
      {children}
    </DataContext.Provider>
  )
}
