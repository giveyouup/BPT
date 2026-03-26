import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import type { MonthlyReport, Schedule, Settings, StipendMapping, CptRange, Physician, MonthlyExpenses, AnnualExpenses } from '../types'
import { api } from '../api'
import { parseShiftSummary } from '../utils/shiftUtils'
import { lastDayOfMonth } from '../utils/dateUtils'

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
    ? lastDayOfMonth(...m.endDate.slice(0, 7).split('-').map(Number) as [number, number])
    : m.endDate
  return { ...m, name: m.name ?? m.filename, endDate }
}

interface DataContextValue {
  physicians: Physician[]
  activePhysicianId: string
  setActivePhysicianId: (id: string) => void
  savePhysician: (p: { id: string; name: string }) => Promise<void>
  deletePhysician: (id: string) => Promise<void>
  reports: MonthlyReport[]
  schedules: Schedule[]
  settings: Settings
  stipendMappings: StipendMapping[]
  cptRanges: CptRange[]
  loading: boolean
  loadError: string | null
  saveReport: (r: MonthlyReport) => Promise<void>
  deleteReport: (id: string) => Promise<void>
  saveSchedule: (s: Schedule) => Promise<void>
  deleteSchedule: (id: string) => Promise<void>
  saveManualShift: (date: string, shiftTypes: string[]) => Promise<void>
  deleteManualShift: (date: string) => Promise<void>
  saveSettings: (s: Settings) => Promise<void>
  saveStipendMapping: (m: StipendMapping) => Promise<void>
  deleteStipendMapping: (id: string) => Promise<void>
  saveCptRange: (r: CptRange) => Promise<void>
  deleteCptRange: (id: string) => Promise<void>
  resetCptRanges: () => Promise<void>
  monthlyExpenses: MonthlyExpenses[]
  saveMonthlyExpenses: (r: MonthlyExpenses) => Promise<void>
  deleteMonthlyExpenses: (id: string) => Promise<void>
  annualExpenses: AnnualExpenses[]
  saveAnnualExpenses: (r: AnnualExpenses) => Promise<void>
  deleteAnnualExpenses: (id: string) => Promise<void>
}

const DataContext = createContext<DataContextValue | null>(null)

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  const [physicians, setPhysicians] = useState<Physician[]>([])
  const [activePhysicianId, setActivePhysicianIdState] = useState<string>('')

  const [rawReports, setRawReports] = useState<MonthlyReport[]>([])
  const [rawSchedules, setRawSchedules] = useState<Schedule[]>([])
  const [manualShifts, setManualShifts] = useState<Record<string, string[]>>({})
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [rawStipendMappings, setRawStipendMappings] = useState<StipendMapping[]>([])
  const [cptRanges, setCptRanges] = useState<CptRange[]>([])
  const [monthlyExpenses, setMonthlyExpenses] = useState<MonthlyExpenses[]>([])
  const [annualExpenses, setAnnualExpenses] = useState<AnnualExpenses[]>([])

  // One-time initialization: shared data + physicians
  useEffect(() => {
    Promise.all([
      api.physicians.list(),
      api.settings.get(),
      api.stipendMappings.list(),
      api.cptRanges.list(),
    ]).then(([physList, setts, mappings, cptRangesData]) => {
      setPhysicians(physList)
      setSettings({ ...DEFAULT_SETTINGS, ...setts, shiftHours: setts.shiftHours ?? DEFAULT_SETTINGS.shiftHours })
      setRawStipendMappings(mappings)
      setCptRanges(cptRangesData)

      const stored = localStorage.getItem('activePhysicianId')
      const validId = physList.find((p) => p.id === stored)?.id ?? physList[0]?.id ?? ''
      setActivePhysicianIdState(validId)
      if (validId) localStorage.setItem('activePhysicianId', validId)
      setInitialized(true)
    }).catch((err) => {
      console.error('Failed to load data:', err)
      setLoadError('Could not reach the server. Make sure the BRACT server is running.')
      setLoading(false)
    })
  }, [])

  // Reload physician-specific data when activePhysicianId changes
  useEffect(() => {
    if (!initialized || !activePhysicianId) return
    setLoading(true)
    Promise.all([
      api.reports.list(activePhysicianId),
      api.schedules.list(activePhysicianId),
      api.manualShifts.list(activePhysicianId),
      api.expenses.list(activePhysicianId),
      api.annualExpenses.list(activePhysicianId),
    ]).then(([rpts, scheds, manual, expenses, annualExp]) => {
      setRawReports(rpts)
      setRawSchedules(scheds)
      setManualShifts(manual)
      setMonthlyExpenses(expenses)
      setAnnualExpenses(annualExp)
      setLoading(false)
    }).catch((err) => {
      console.error('Failed to load physician data:', err)
      setLoadError('Could not reach the server. Make sure the BRACT server is running.')
      setLoading(false)
    })
  }, [initialized, activePhysicianId])

  const setActivePhysicianId = (id: string) => {
    localStorage.setItem('activePhysicianId', id)
    setActivePhysicianIdState(id)
  }

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

  // ─── Physician mutations ──────────────────────────────────────────────────

  const savePhysician = async (p: { id: string; name: string }) => {
    await api.physicians.upsert(p)
    setPhysicians((prev) => {
      const idx = prev.findIndex((x) => x.id === p.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], name: p.name }
        return next
      }
      return [...prev, { id: p.id, name: p.name, createdAt: new Date().toISOString() }]
    })
  }

  const deletePhysician = async (id: string) => {
    await api.physicians.delete(id)
    setPhysicians((prev) => {
      const remaining = prev.filter((p) => p.id !== id)
      if (id === activePhysicianId && remaining.length > 0) {
        setActivePhysicianId(remaining[0].id)
      }
      return remaining
    })
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  const saveReport = async (report: MonthlyReport) => {
    const r = { ...report, physicianId: report.physicianId ?? activePhysicianId }
    await api.reports.upsert(r)
    const normalized = normalizeReport(r)
    setRawReports((prev) => {
      const idx = prev.findIndex((x) => x.id === r.id)
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
    const s = { ...schedule, physicianId: schedule.physicianId ?? activePhysicianId }
    await api.schedules.upsert(s)
    setRawSchedules((prev) => {
      const idx = prev.findIndex((x) => x.id === s.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = s
        return next
      }
      return [...prev, s].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
    })
  }

  const deleteSchedule = async (id: string) => {
    await api.schedules.delete(id)
    setRawSchedules((prev) => prev.filter((s) => s.id !== id))
  }

  const saveManualShift = async (date: string, shiftTypes: string[]) => {
    await api.manualShifts.upsert(activePhysicianId, date, shiftTypes)
    setManualShifts((prev) => ({ ...prev, [date]: shiftTypes }))
  }

  const deleteManualShift = async (date: string) => {
    await api.manualShifts.delete(activePhysicianId, date)
    setManualShifts((prev) => {
      const next = { ...prev }
      delete next[date]
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

  const saveCptRange = async (range: CptRange) => {
    await api.cptRanges.upsert(range)
    setCptRanges(prev => {
      const idx = prev.findIndex(r => r.id === range.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = range; return next }
      return [...prev, range].sort((a, b) => a.lo - b.lo)
    })
  }

  const deleteCptRange = async (id: string) => {
    await api.cptRanges.delete(id)
    setCptRanges(prev => prev.filter(r => r.id !== id))
  }

  const resetCptRanges = async () => {
    const fresh = await api.cptRanges.reset()
    setCptRanges(fresh)
  }

  const saveMonthlyExpenses = async (record: MonthlyExpenses) => {
    const r = { ...record, physicianId: record.physicianId ?? activePhysicianId }
    await api.expenses.upsert(r)
    setMonthlyExpenses((prev) => {
      const idx = prev.findIndex((x) => x.id === r.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = r; return next }
      return [...prev, r].sort((a, b) => a.id.localeCompare(b.id))
    })
  }

  const deleteMonthlyExpenses = async (id: string) => {
    await api.expenses.delete(id)
    setMonthlyExpenses((prev) => prev.filter((r) => r.id !== id))
  }

  const saveAnnualExpenses = async (record: AnnualExpenses) => {
    const r = { ...record, physicianId: record.physicianId ?? activePhysicianId }
    await api.annualExpenses.upsert(r)
    setAnnualExpenses((prev) => {
      const idx = prev.findIndex((x) => x.id === r.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = r; return next }
      return [...prev, r].sort((a, b) => a.id.localeCompare(b.id))
    })
  }

  const deleteAnnualExpenses = async (id: string) => {
    await api.annualExpenses.delete(id)
    setAnnualExpenses((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <DataContext.Provider value={{
      physicians, activePhysicianId, setActivePhysicianId, savePhysician, deletePhysician,
      reports, schedules, settings, stipendMappings, cptRanges, loading, loadError,
      saveReport, deleteReport,
      saveSchedule, deleteSchedule, saveManualShift, deleteManualShift,
      saveSettings,
      saveStipendMapping, deleteStipendMapping,
      saveCptRange, deleteCptRange, resetCptRanges,
      monthlyExpenses, saveMonthlyExpenses, deleteMonthlyExpenses,
      annualExpenses, saveAnnualExpenses, deleteAnnualExpenses,
    }}>
      {children}
    </DataContext.Provider>
  )
}
