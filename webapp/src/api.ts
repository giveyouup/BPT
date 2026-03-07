import type { MonthlyReport, Schedule, Settings, StipendMapping } from './types'

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
  reports: {
    list: () => req<MonthlyReport[]>('GET', '/reports'),
    upsert: (r: MonthlyReport) => req<void>('PUT', `/reports/${r.id}`, r),
    delete: (id: string) => req<void>('DELETE', `/reports/${id}`),
  },
  schedules: {
    list: () => req<Schedule[]>('GET', '/schedules'),
    upsert: (s: Schedule) => req<void>('PUT', `/schedules/${s.id}`, s),
    delete: (id: string) => req<void>('DELETE', `/schedules/${id}`),
  },
  manualShifts: {
    list: () => req<Record<string, string[]>>('GET', '/manual-shifts'),
    upsert: (date: string, shiftTypes: string[]) =>
      req<void>('PUT', `/manual-shifts/${date}`, { shiftTypes }),
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
}
