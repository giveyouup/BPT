import type { MonthlyReport, Schedule, Settings, StipendMapping, CptRange, Physician, MonthlyExpenses, AnnualExpenses } from './types'

export interface MaintenanceResult {
  walBusy: boolean
  walPagesCheckpointed: number
  walPagesRemaining: number
  dbSizeBefore: number
  dbSizeAfter: number
  backupExists: boolean
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API ${method} ${url}: ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  physicians: {
    list: () => req<Physician[]>('GET', '/physicians'),
    upsert: (p: { id: string; name: string }) => req<void>('PUT', `/physicians/${p.id}`, p),
    delete: (id: string) => req<void>('DELETE', `/physicians/${id}`),
  },
  reports: {
    list: (physicianId: string) => req<MonthlyReport[]>('GET', `/reports?physicianId=${encodeURIComponent(physicianId)}`),
    upsert: (r: MonthlyReport) => req<void>('PUT', `/reports/${r.id}`, r),
    delete: (id: string) => req<void>('DELETE', `/reports/${id}`),
  },
  schedules: {
    list: (physicianId: string) => req<Schedule[]>('GET', `/schedules?physicianId=${encodeURIComponent(physicianId)}`),
    upsert: (s: Schedule) => req<void>('PUT', `/schedules/${s.id}`, s),
    delete: (id: string) => req<void>('DELETE', `/schedules/${id}`),
  },
  manualShifts: {
    list: (physicianId: string) => req<Record<string, string[]>>('GET', `/manual-shifts?physicianId=${encodeURIComponent(physicianId)}`),
    upsert: (physicianId: string, date: string, shiftTypes: string[]) =>
      req<void>('PUT', `/manual-shifts/${date}`, { physicianId, shiftTypes }),
    delete: (physicianId: string, date: string) => req<void>('DELETE', `/manual-shifts/${date}?physicianId=${encodeURIComponent(physicianId)}`),
  },
  settings: {
    get: () => req<Settings>('GET', '/settings'),
    upsert: (s: Settings) => req<void>('PUT', '/settings', s),
  },
  stipendMappings: {
    list: () => req<StipendMapping[]>('GET', '/stipend-mappings'),
    upsert: (m: StipendMapping) => req<void>('PUT', `/stipend-mappings/${m.id}`, m),
    delete: (id: string) => req<void>('DELETE', `/stipend-mappings/${id}`),
  },
  cptRanges: {
    list: () => req<CptRange[]>('GET', '/cpt-ranges'),
    upsert: (r: CptRange) => req<void>('PUT', `/cpt-ranges/${r.id}`, r),
    delete: (id: string) => req<void>('DELETE', `/cpt-ranges/${id}`),
    reset: () => req<CptRange[]>('POST', '/cpt-ranges/reset'),
  },
  expenses: {
    list: (physicianId: string) => req<MonthlyExpenses[]>('GET', `/expenses?physicianId=${encodeURIComponent(physicianId)}`),
    upsert: (r: MonthlyExpenses) => req<void>('PUT', `/expenses/${r.id}`, r),
    delete: (id: string) => req<void>('DELETE', `/expenses/${id}`),
  },
  annualExpenses: {
    list: (physicianId?: string) =>
      fetch(`/api/annual-expenses${physicianId ? `?physicianId=${physicianId}` : ''}`).then(r => r.json()) as Promise<AnnualExpenses[]>,
    upsert: (record: AnnualExpenses) =>
      fetch(`/api/annual-expenses/${record.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) }).then(r => r.json()),
    delete: (id: string) =>
      fetch(`/api/annual-expenses/${id}`, { method: 'DELETE' }).then(r => r.json()),
  },
  db: {
    maintenance: () => req<MaintenanceResult>('POST', '/db/maintenance'),
  },
}
