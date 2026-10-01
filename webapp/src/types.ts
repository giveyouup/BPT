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
  // PDF (OCR) uploads only: cells the parser doubted (cleared as each is
  // reviewed/edited), plus where the row sits in the source PDF so a crop can
  // be rendered for comparison.
  flags?: OcrFlag[]
  srcPage?: number   // 0-indexed page in the source PDF
  srcTop?: number    // row top, in PDF points
  reviewed?: boolean // a person has checked/edited this row's cells (set when a flag is cleared or a cell is edited)
}

export interface OcrFlag {
  field: 'ticketNum' | 'unitValue' | 'distributionValue' | 'startTime' | 'endTime' | 'totalTime' | 'timeUnits' | 'totalDistributableUnits'
  reason: 'repaired' | 'invariant' | 'low-confidence'
  raw: string          // what the OCR actually read
  conf: number | null  // tesseract confidence (0-100)
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
  sourcePdf?: string // stored source PDF, relative to the server's pdfs/ dir (PDF uploads only)
  uploadDate: string // ISO datetime
  unitDollarValue: number
  // Derived, never saved: precise $/unit implied by the month's income-statement
  // Professional Fees (see utils/unitRate.ts). Pay math uses it; the printed
  // two-decimal unitDollarValue above is what's shown and entered.
  effectiveUnitValue?: number
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
  cashCutoffs?: Record<number, string>             // year -> ISO date "YYYY-MM-DD" (end of unit-pay cash period) -- only read when cashUnitPayMode for that year is 'cutoff'
  // Per-year choice for how Cash view computes Unit Pay: 'reports' sums each
  // month's whole PCR report (same mechanism Accrual view already uses,
  // ignoring individual line items' own service dates -- a report can
  // legitimately contain lines dated outside its own month); 'cutoff' uses
  // the cashCutoffs-driven date-window logic. A year with no entry here
  // defaults to 'cutoff' if it already has a cashCutoffs value (preserves
  // prior behavior for years already calibrated), else 'reports' (see
  // resolveCashUnitPayMode in utils/calculations.ts -- use it rather than
  // reading this field directly, to keep that fallback in one place).
  cashUnitPayMode?: Record<number, 'reports' | 'cutoff'>
  promotedStipendCodes?: string[]                  // shift codes broken out of "Other G"/"Other" into their own column
  hiddenPcrLabels?: { stipend: string[]; expense: string[]; otherIncome?: string[] } // unmapped PCR labels dismissed from the mapping page's suggestion chips
  // User-customized row order on the PCR Income Statement page, keyed by
  // group id ("expense:business" | "expense:benefits" | "expense:healthInsurance"
  // | "expense:retirement" | "expense:unmapped" | "stipend"). Each value is an
  // ordered list of item ids -- a leaf category key for the fixed expense
  // groups, or the raw PCR label text for the stipend and unmapped groups
  // (which have no stable key of their own). Items not yet in the list fall
  // back to the page's own default order and are appended after it.
  pcrRowOrder?: Record<string, string[]>
  // Custom (free-form) expense categories dismissed from the "Sync from PCR"
  // panel's "no PCR mapping yet" reminder -- for a category that's
  // deliberately hand-managed and was never meant to sync from the PCR.
  // Keyed by category name, not by PCR label (see hiddenPcrLabels above),
  // since this reminder starts from the category and asks "is there a
  // mapping for it?", the reverse direction of an unmapped PCR label.
  dismissedUnmappedCategories?: string[]
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
  cashCompEntries?: ExpenseEntry[]    // free-form Cash Reimbursements entries
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
  // Hand corrections (see utils/pcrStatementEdits.ts). `ocr` holds what the
  // parser originally read, present only while this line differs from it;
  // `added` marks a line typed in by hand that the PDF never had. Both make a
  // line survive a re-upload of the same month.
  ocr?: { label: string; section: 'stipend' | 'expense' | 'otherIncome' | 'other'; amount: number }
  added?: boolean
}

export interface PcrIncomeStatement {
  id: string   // "YYYY-MM"
  year: number
  month: number
  physicianId?: string
  filename: string
  uploadDate: string
  lines: PcrStatementLine[]
  // Original-OCR identities ("section|label|n") of lines deleted by hand, so a
  // re-upload doesn't bring them back.
  deletedKeys?: string[]
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
  section: 'stipend' | 'expense' | 'otherIncome'
  targetKey: string  // stipend: a StipendCalculator group key; expense: an
                      // AnnualExpenses leaf key, or a free-form category
                      // name routed into its entries[]; otherIncome: a
                      // free-form category name routed into
                      // AnnualExpenses.otherIncomeEntries[] (that section has
                      // no fixed leaves at all, unlike expense)
}
