export interface Physician {
  id: string
  name: string
  createdAt: string
}

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
  physicianId?: string
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
  addOnTags: string[]   // e.g. ['N', 'A'], derived from non-primary CPT codes
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
  physicianId?: string
  year: number
  month: number // 1–12
  filename: string
  uploadDate: string // ISO datetime
  unitDollarValue: number
  paddingMinutes: number
  defaultNoTimeHours: number
  unitCorrection?: number    // manual unit adjustment (positive or negative)
  lineItems: LineItem[]
  workingDayOverrides: Record<string, number> // date -> hours
  dayStipends: Record<string, number>        // date -> additional per-day stipend
  dayNotes?: Record<string, string>          // date -> free-text note
  // date -> group ('FS'|'ROC'|'alhambra') this dayStipends[date] value was
  // auto-populated for by PCR ingestion (see utils/pcrStipendCarveouts.ts) --
  // lets a later re-run find and clear its own prior write before placing a
  // fresh one, instead of leaving a stale duplicate behind.
  autoStipendCarveouts?: Record<string, string>
  stipends: Stipend[]        // additional (manual) stipends (legacy)
  autoSplit?: boolean        // true when created by splitting a multi-month upload
  stipendMappingOverride?: string  // mapping id — overrides date-based auto-selection
  reassignmentLog?: Array<{  // audit trail of service-date reassignments
    fromDate: string
    toDate: string
    caseCount: number
    totalUnits: number
  }>
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
  clinicalDayStart: string // "HH:MM" — attribution cutoff & duration normalization boundary
  shiftHours: Record<string, number>
  holidays: Record<number, string[]> // year -> ["YYYY-MM-DD", ...]
  stipendMappingOverrides?: Record<string, string> // "YYYY-MM" -> mapping id (for months without a report)
  cashCutoffs?: Record<number, string>             // year -> ISO date "YYYY-MM-DD" (end of unit-pay cash period)
  promotedStipendCodes?: string[]                  // shift codes broken out of "Other G"/"Other" into their own column
  hiddenPcrLabels?: { stipend: string[]; expense: string[] } // unmapped PCR labels dismissed from the mapping page's suggestion chips
}

export interface CptRange {
  id: string
  lo: number
  hi: number
  label: string
}

export interface ExpenseEntry {
  id: string
  category: string
  amount: number
  note?: string
}

export interface MonthlyExpenses {
  id: string   // "YYYY-MM"
  year: number
  month: number
  physicianId?: string
  recurring: Record<string, number>  // category key -> monthly amount
  entries: ExpenseEntry[]            // free-form additional entries
}

export interface AnnualExpenses {
  id: string   // "YYYY"
  year: number
  physicianId?: string
  recurring: Record<string, number>  // category key -> annual amount
  entries: ExpenseEntry[]             // free-form business entries
  benefitsEntries?: ExpenseEntry[]    // free-form benefits entries
  retirementEntries?: ExpenseEntry[]  // free-form retirement entries
  otherIncomeEntries?: ExpenseEntry[] // free-form other income entries
}

// Raw revenues/expenses line items extracted from a PCR bundle's income-
// statement pages (separate from the Case Distribution Report's own line
// items). `section` is derived at extraction time from which of the
// statement's own top-level headers (STIPENDS / EXPENSES / OTHER
// PROFESSIONAL INCOME) the line fell under; "other" covers everything else
// (Professional Fees, Operating Reserves, etc) -- stored for completeness
// but not consumed by the stipend-audit or expense-sync features.
export interface PcrStatementLine {
  label: string       // verbatim PCR-printed label, e.g. "SMCS Acute Pain"
  section: 'stipend' | 'expense' | 'otherIncome' | 'other'
  amount: number
}

export interface PcrIncomeStatement {
  id: string   // "YYYY-MM"
  year: number
  month: number
  physicianId?: string
  filename: string
  uploadDate: string
  lines: PcrStatementLine[]
}

// User-configured mapping from a PCR-printed label to one of the app's own
// internal categories -- required because PCR labels are free text that
// varies between report periods, while StipendCalculator's categories
// (mainOrCall/otherG/APS/BR/NIR/ROC/GI/FS/alhambra/other/additional) and
// AnnualExpenses' leaf keys are both fixed, unrelated vocabularies.
export interface PcrCategoryMapping {
  id: string
  label: string   // matched as a case-insensitive substring against the PCR's own
                    // printed line label (not an exact match) -- e.g. "Acute Pain"
                    // matches the real printed label "SMCS Acute Pain"
  section: 'stipend' | 'expense'
  targetKey: string  // stipend: a StipendCalculator group key; expense: an
                      // AnnualExpenses leaf key, or a free-form category
                      // name routed into its entries[]
}
