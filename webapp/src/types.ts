export interface LineItem {
  incidentId: string
  serviceDate: string // "YYYY-MM-DD"
  ticketNum: string
  cptAsa: string
  modifier: string
  unitValue: number | null
  distributionValue: number
  startTime: string | null // "HH:MM"
  endTime: string | null   // "HH:MM"
  totalTime: string | null // "HH:MM"
  timeUnits: number
  totalDistributableUnits: number
}

export interface ShiftEntry {
  date: string
  shiftTypes: string[]   // e.g. ["G5"], ["APS", "G1"]
  hoursOverride?: number
}

export interface Schedule {
  id: string
  filename: string
  uploadDate: string  // ISO datetime
  entries: ShiftEntry[]
}

export interface StipendRate {
  shiftType: string // e.g. "G1_weekday", "G1_weekend", "APS", "BR"
  amount: number
}

export interface StipendMapping {
  id: string
  name: string          // display name (editable)
  filename: string      // original uploaded filename
  uploadDate: string    // ISO datetime
  effectiveDate: string // "YYYY-MM-DD" — first applicable month
  endDate?: string      // "YYYY-MM-DD" — last applicable month (undefined = open-ended)
  rates: StipendRate[]
}

export interface WorkingDayStats {
  date: string // "YYYY-MM-DD"
  caseCount: number
  hasTimes: boolean
  firstStartTime: string | null
  lastEndTime: string | null
  hours: number
  isOverridden: boolean
  isDefault: boolean
  shiftTypes: string[]    // shift assignments from schedule (can be multiple per day)
  hasProduction: boolean  // false for days with shift but no PCR line items
  additionalStipend: number // manually entered per-day extra stipend
  isCallWeekend: boolean  // G1/G2 on weekend or federal holiday
  totalUnits: number      // sum of distributable units for the day
  unitPay: number         // totalUnits × $/unit (from source report)
  stipendAmount: number   // from applicable StipendMapping for this day's shift
  totalDayPay: number     // unitPay + stipendAmount
}

export interface CaseSummary {
  ticketNum: string
  serviceDate: string
  isSplit: boolean
  primaryCptAsa: string
  primaryModifier: string
  primaryDistributionValue: number
  primaryTimeUnits: number
  addOnUnits: number
  totalUnits: number
  startTime: string | null
  endTime: string | null
  durationMinutes: number | null
  lineCount: number
}

export interface Stipend {
  id: string
  description: string
  amount: number
}

export interface MonthlyReport {
  id: string   // "YYYY-MM"
  year: number
  month: number // 1–12
  filename: string
  uploadDate: string // ISO datetime
  unitDollarValue: number
  paddingMinutes: number
  defaultNoTimeHours: number
  lineItems: LineItem[]
  workingDayOverrides: Record<string, number> // date -> hours
  dayStipends: Record<string, number>        // date -> additional per-day stipend
  stipends: Stipend[]        // additional (manual) stipends (legacy)
}

export interface MonthlyStats {
  id: string
  year: number
  month: number
  totalCases: number
  totalDistributableUnits: number
  unitCompensation: number
  shiftStipends: number      // auto-computed from StipendMapping per working day
  additionalStipends: number // manually added stipends
  totalStipends: number      // shiftStipends + additionalStipends
  totalCompensation: number  // unitCompensation + totalStipends
  totalHours: number
  daysWorked: number
  workingDays: WorkingDayStats[]
  cases: CaseSummary[]
  weekdayCallDays: number
  weekendCallDays: number
}

export interface Settings {
  defaultPaddingMinutes: number
  defaultNoTimeHours: number
  shiftHours: { APS: number; BR: number; NIR: number }
  holidays: Record<number, string[]> // year -> ["YYYY-MM-DD", ...]
}
