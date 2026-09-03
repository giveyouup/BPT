import type { MonthlyReport, Schedule, Settings, StipendMapping, CptRange, Physician, MonthlyExpenses, AnnualExpenses, LineItem, PcrIncomeStatement, PcrCategoryMapping } from './types'

export interface PcrPdfSection {
  startPage: number
  endPage: number
  doctorName: string
}

export interface PcrPdfDetectResult {
  pageCount: number
  sections: PcrPdfSection[]
}

export interface PcrPdfUnitInfo {
  unitDollarValue: number
  unitCorrection: number
  reconciled: boolean
}

export interface PcrPdfPrintedTotals {
  distributableUnits: number
  totalDistribUnits: number
}

export interface PcrPdfStatementLine {
  label: string
  section: 'stipend' | 'expense' | 'otherIncome' | 'other'
  amount: number
}

export interface PcrPdfIncomeStatementMonth {
  year: number
  month: number
  lines: PcrPdfStatementLine[]
}

export interface PcrPdfExtractResult {
  doctorName: string
  criteria: Record<string, string>
  lineItems: LineItem[]
  unitInfo: PcrPdfUnitInfo | null
  printedTotals: PcrPdfPrintedTotals | null
  incomeStatement: PcrPdfIncomeStatementMonth[]
}

export interface SchedulePdfRow {
  name: string
  shifts: string[]
}

export interface SchedulePdfResult {
  month: number | null
  year: number | null
  sourcePage: number
  rows: SchedulePdfRow[]
}

async function reqForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch('/api' + url, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || `API POST ${url}: ${res.status}`)
  }
  return res.json() as Promise<T>
}

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
    delete: (id: string, physicianId: string) => req<void>('DELETE', `/reports/${id}?physicianId=${encodeURIComponent(physicianId)}`),
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
    delete: (id: string, physicianId: string) => req<void>('DELETE', `/expenses/${id}?physicianId=${encodeURIComponent(physicianId)}`),
  },
  annualExpenses: {
    list: (physicianId?: string) =>
      fetch(`/api/annual-expenses${physicianId ? `?physicianId=${physicianId}` : ''}`).then(r => r.json()) as Promise<AnnualExpenses[]>,
    upsert: (record: AnnualExpenses) =>
      fetch(`/api/annual-expenses/${record.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) }).then(r => r.json()),
    delete: (id: string, physicianId: string) =>
      fetch(`/api/annual-expenses/${id}?physicianId=${encodeURIComponent(physicianId)}`, { method: 'DELETE' }).then(r => r.json()),
  },
  pcrIncomeStatements: {
    list: (physicianId?: string) =>
      req<PcrIncomeStatement[]>('GET', `/pcr-income-statements${physicianId ? `?physicianId=${encodeURIComponent(physicianId)}` : ''}`),
    upsert: (record: PcrIncomeStatement) => req<void>('PUT', `/pcr-income-statements/${record.id}`, record),
    delete: (id: string, physicianId: string) => req<void>('DELETE', `/pcr-income-statements/${id}?physicianId=${encodeURIComponent(physicianId)}`),
  },
  pcrCategoryMappings: {
    list: () => req<PcrCategoryMapping[]>('GET', '/pcr-category-mappings'),
    upsert: (m: PcrCategoryMapping) => req<void>('PUT', `/pcr-category-mappings/${m.id}`, m),
    delete: (id: string) => req<void>('DELETE', `/pcr-category-mappings/${id}`),
    reset: (section: 'stipend' | 'expense') => req<PcrCategoryMapping[]>('POST', `/pcr-category-mappings/reset?section=${section}`),
  },
  db: {
    maintenance: () => req<MaintenanceResult>('POST', '/db/maintenance'),
  },
  pcrPdf: {
    detect: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return reqForm<PcrPdfDetectResult>('/pcr-pdf/detect', form)
    },
    extract: (file: File, pages: string) => {
      const form = new FormData()
      form.append('file', file)
      form.append('pages', pages)
      return reqForm<PcrPdfExtractResult>('/pcr-pdf/extract', form)
    },
  },
  schedulePdf: {
    parse: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return reqForm<SchedulePdfResult>('/schedule-pdf/parse', form)
    },
  },
}
