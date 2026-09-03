import { useState, useCallback, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseXlsx, detectMonthYear, detectMonthYearFromBuffer, isRawXlsx, exportCleanXlsx, netOutVoidPairs } from '../utils/xlsxParser'
import { api } from '../api'
import type { PcrPdfSection, PcrPdfUnitInfo, PcrPdfPrintedTotals, SchedulePdfResult, SchedulePdfRow } from '../api'
import { exportStipendMappings } from '../utils/exportXlsx'
import { parseICS } from '../utils/icsParser'
import { parseStipendMappings } from '../utils/stipendMappingParser'
import type { ParsedStipendSheet } from '../utils/stipendMappingParser'
import { parseShiftSummary, shiftBadgeClass } from '../utils/shiftUtils'
import { getWeekendPairs, buildDayList, parseScheduleText } from '../utils/schedulePaste'
import type { ParseScheduleResult } from '../utils/schedulePaste'
import { formatMonthYear, formatDateFull, lastDayOfMonth, MONTH_ABBREVS, getMonthName } from '../utils/dateUtils'
import { useData } from '../context/DataContext'
import type { LineItem, ShiftEntry, Schedule, StipendMapping, StipendRate } from '../types'
import { applyPcrStipendCarveouts } from '../utils/pcrStipendCarveouts'

function genId() { return `sched-${Date.now()}-${Math.random().toString(36).slice(2)}` }

// Fuzzy match between a physician's stored full name and a name extracted
// from a PDF (usually just a surname, e.g. "Osmani" or "187 - OSMANI, BIJAN").
// Bidirectional substring on name tokens so it works whichever string is the
// terser one. Used both to auto-suggest a match and to warn when the
// currently-selected extraction doesn't look like the active physician.
function namesLikelyMatch(physicianName: string, extractedName: string): boolean {
  if (!physicianName || !extractedName) return false
  const allTokens = physicianName.toLowerCase().split(/\s+/).filter(Boolean)
  // Prefer tokens longer than 2 chars (avoids a lone initial like "A."
  // substring-matching almost anything); fall back to all tokens only if
  // every one is that short (e.g. a physician named "Jo Le").
  const tokens = allTokens.filter((t) => t.length > 2)
  const useTokens = tokens.length > 0 ? tokens : allTokens
  // PCR doctor names are formatted "NNN - SURNAME, FIRSTNAME" -- when a comma
  // is present, compare only against the part before it (the surname).
  // Otherwise two different physicians who happen to share a first name
  // would falsely "match" just because the first name also appears in the
  // string (e.g. "Bijan Smith" vs "187 - OSMANI, BIJAN").
  const commaIdx = extractedName.indexOf(',')
  const compareAgainst = (commaIdx >= 0 ? extractedName.slice(0, commaIdx) : extractedName).toLowerCase()
  return useTokens.some((t) => compareAgainst.includes(t) || t.includes(compareAgainst))
}

// First letter of a name's first token, when there IS a first token to take
// it from (a two-plus-word name like "Andrew Brown" or "A. Brown" -- a
// bare one-word name like "Brown" or "Osmani" carries no initial info).
// Used only to break ties between rows that already matched on surname.
function firstInitial(name: string): string | null {
  const tokens = name.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 2) return null
  const first = tokens[0].replace(/\.$/, '')
  return first ? first[0].toLowerCase() : null
}

// Schedule-grid rows disambiguate same-surname physicians with a leading
// first initial (e.g. "A. Brown" vs "M. Brown"), but `namesLikelyMatch`
// alone only compares surnames, so both rows "match" a physician named
// just "Brown" -- or even "Andrew Brown", since it OR-matches on any token
// and never required the first name to agree. This narrows a physician's
// candidate rows to one when their own name's initial agrees with exactly
// one candidate's -- deliberately only a *tie-breaker*: it's never applied
// unless there's already more than one surname match, so a physician whose
// recorded first name doesn't match a grid nickname's initial (rare, but
// possible) still gets their one real row when there's no other candidate
// to confuse it with.
function resolveRowMatches(physicianName: string, rows: SchedulePdfRow[]): SchedulePdfRow[] {
  const candidates = rows.filter((r) => namesLikelyMatch(physicianName, r.name))
  if (candidates.length <= 1) return candidates
  const physicianInitial = firstInitial(physicianName)
  if (!physicianInitial) return candidates
  const narrowed = candidates.filter((r) => firstInitial(r.name) === physicianInitial)
  return narrowed.length === 1 ? narrowed : candidates
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

const PICKER_YEARS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 3 + i)
const SEL_CLS = 'bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500'

function stipendDateRange(m: StipendMapping, nextM: StipendMapping | null): string {
  const [y, mo] = m.effectiveDate.split('-').map(Number)
  const from = formatMonthYear(y, mo)
  if (m.endDate) {
    const [ey, emo] = m.endDate.split('-').map(Number)
    return `${from} – ${formatMonthYear(ey, emo)}`
  }
  if (!nextM) return `${from} – present`
  const [ny, nmo] = nextM.effectiveDate.split('-').map(Number)
  const endMo = nmo === 1 ? 12 : nmo - 1
  const endY = nmo === 1 ? ny - 1 : ny
  return `${from} – ${formatMonthYear(endY, endMo)}`
}

function MonthPicker({ value, onChange, placeholder = 'Select' }: {
  value: string
  onChange: (val: string) => void
  placeholder?: string
}) {
  const yr = value ? parseInt(value.slice(0, 4)) : ''
  const mo = value ? parseInt(value.slice(5, 7)) : ''
  const setYr = (y: string) => {
    if (!y) { onChange(''); return }
    onChange(`${y}-${String(mo || 1).padStart(2, '0')}`)
  }
  const setMo = (m: string) => {
    if (!m) { onChange(''); return }
    onChange(`${yr || new Date().getFullYear()}-${String(m).padStart(2, '0')}`)
  }
  return (
    <div className="flex items-center gap-1">
      <select value={mo} onChange={(e) => setMo(e.target.value)} className={SEL_CLS}>
        <option value="">{placeholder}</option>
        {MONTH_ABBREVS.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
      </select>
      <select value={yr} onChange={(e) => setYr(e.target.value)} className={SEL_CLS}>
        <option value="">{placeholder}</option>
        {PICKER_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  )
}

// ─── PCR Upload ───────────────────────────────────────────────────────────────

function PcrUploadTab() {
  const navigate = useNavigate()
  const { reports, schedules, settings, saveReport, physicians, activePhysicianId, savePcrIncomeStatement, pcrCategoryMappings, stipendMappings } = useData()
  const activePhysician = physicians.find(p => p.id === activePhysicianId)

  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<LineItem[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [wasRaw, setWasRaw] = useState(false)

  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [unitValue, setUnitValue] = useState('32.00')
  const [unitCorrection, setUnitCorrection] = useState('0')
  const [paddingMins, setPaddingMins] = useState(String(settings.defaultPaddingMinutes))
  const [noTimeHours, setNoTimeHours] = useState(String(settings.defaultNoTimeHours))
  const [saving, setSaving] = useState(false)
  const [showConflict, setShowConflict] = useState(false)
  const [multiMonthMode, setMultiMonthMode] = useState<'none' | 'prompt' | 'split' | 'single'>('none')

  // ── PDF import (server-side OCR) ──────────────────────────────────────────
  const [pdfSections, setPdfSections] = useState<PcrPdfSection[] | null>(null)
  const [selectedSectionIdx, setSelectedSectionIdx] = useState(0)
  const [pageRangeInput, setPageRangeInput] = useState('')
  const [pdfBusy, setPdfBusy] = useState<'detecting' | 'extracting' | null>(null)
  // $/unit + unit correction auto-detected from a bundled "Physician 12
  // Month Summary" / "Corrections" page, if the PDF included one -- null
  // means no such page was found (the common case), so the fields stay
  // exactly as manual as they are today.
  const [detectedUnitInfo, setDetectedUnitInfo] = useState<PcrPdfUnitInfo | null>(null)
  // The source PDF's own printed "Total for <doctor>" subtotal row, when
  // found -- used as a spot-check against our own computed sums in the
  // preview. null for xlsx uploads and for any PDF where that row wasn't
  // found/didn't parse (never blocks the upload, it's advisory only).
  const [printedTotals, setPrintedTotals] = useState<PcrPdfPrintedTotals | null>(null)
  // Count of months auto-saved from the PDF's own income-statement pages
  // (revenues/stipends/expenses breakdown), if any were found -- feeds the
  // stipend-audit and expense-sync features. null when none were found
  // (the common case for a bare line-items-only PDF, or for xlsx uploads).
  const [incomeStatementMonthsSaved, setIncomeStatementMonthsSaved] = useState<number | null>(null)

  // Applies parsed line items the same way regardless of source (xlsx or PDF):
  // detect month/year, prefill $/unit from an existing report, and flag
  // multi-month uploads for the split prompt. `checkMultiMonth` is false for
  // PDFs -- a PDF page range is always a single Case Distribution Report for
  // one month, so the split prompt doesn't apply (unlike an xlsx export,
  // which can span an arbitrary date range).
  const applyParsedItems = useCallback((
    items: LineItem[],
    detected: { month: number; year: number } | null,
    checkMultiMonth = true,
  ) => {
    if (detected) {
      setMonth(detected.month)
      setYear(detected.year)
      const existingId = `${detected.year}-${String(detected.month).padStart(2, '0')}`
      const existingReport = reports.find((r) => r.id === existingId)
      if (existingReport) {
        setUnitValue((existingReport.unitDollarValue ?? 0).toFixed(2))
        setUnitCorrection(String(existingReport.unitCorrection ?? 0))
      }
    }
    setParsed(items)
    if (checkMultiMonth) {
      const distinctMonths = new Set(items.map((li) => li.serviceDate.slice(0, 7)))
      if (distinctMonths.size >= 3) setMultiMonthMode('prompt')
    }
  }, [reports])

  // Parse "MM/DD/YYYY" or "M/D/YYYY" (as found in the PDF's criteria line)
  const monthYearFromCriteriaDate = (s: string | undefined): { month: number; year: number } | null => {
    const m = s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    return m ? { month: parseInt(m[1]), year: parseInt(m[3]) } : null
  }

  const resetUploadState = () => {
    setParseError(null)
    setParsed(null)
    setWasRaw(false)
    setShowConflict(false)
    setMultiMonthMode('none')
    setPdfSections(null)
    setPdfBusy(null)
    setDetectedUnitInfo(null)
    setPrintedTotals(null)
    setIncomeStatementMonthsSaved(null)
  }

  const handleXlsxFile = useCallback(async (f: File) => {
    try {
      const buffer = await f.arrayBuffer()
      const detected = detectMonthYear(f.name) ?? detectMonthYearFromBuffer(buffer)
      const raw = isRawXlsx(buffer)
      setWasRaw(raw)
      const items = parseXlsx(buffer)
      applyParsedItems(items, detected)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse file')
    }
  }, [applyParsedItems])

  const handlePdfFile = useCallback(async (f: File) => {
    setPdfBusy('detecting')
    try {
      const { sections } = await api.pcrPdf.detect(f)
      if (sections.length === 0) {
        setParseError('No Case Distribution Report pages found in this PDF.')
        setPdfBusy(null)
        return
      }
      // Prefer the section matching the active physician's name, if any.
      const activeIdx = activePhysician
        ? sections.findIndex((s) => namesLikelyMatch(activePhysician.name, s.doctorName))
        : -1
      const idx = activeIdx >= 0 ? activeIdx : 0
      setSelectedSectionIdx(idx)
      setPageRangeInput(`${sections[idx].startPage}-${sections[idx].endPage}`)
      setPdfSections(sections)
      setPdfBusy(null)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to scan PDF')
      setPdfBusy(null)
    }
  }, [activePhysician])

  const handleParsePdfPages = async () => {
    if (!file) return
    setPdfBusy('extracting')
    setParseError(null)
    try {
      const result = await api.pcrPdf.extract(file, pageRangeInput)
      const items = netOutVoidPairs(result.lineItems)
      const detected = detectMonthYear(file.name) ?? monthYearFromCriteriaDate(result.criteria.date_from)
      applyParsedItems(items, detected, false)
      setDetectedUnitInfo(result.unitInfo)
      setPrintedTotals(result.printedTotals)
      // Only auto-fill from the PDF's own summary page when there's no
      // existing report for that month to preserve -- a manually-verified
      // $/unit or correction is never silently overwritten by a fresh OCR
      // read (the confirmation form still shows a diff warning below).
      if (result.unitInfo && detected) {
        const existingId = `${detected.year}-${String(detected.month).padStart(2, '0')}`
        if (!reports.some((r) => r.id === existingId)) {
          setUnitValue(result.unitInfo.unitDollarValue.toFixed(2))
          setUnitCorrection(String(result.unitInfo.unitCorrection))
        }
      }
      // Auto-save any income-statement (revenues/stipends/expenses) months
      // found in the same PDF -- feeds the PCR stipend audit and expense
      // sync features. Each PDF re-states every prior month too, so this
      // naturally backfills/cross-checks earlier months as later ones are
      // uploaded, same as the line items above.
      if (result.incomeStatement.length > 0) {
        for (const month of result.incomeStatement) {
          const statement = {
            id: `${month.year}-${String(month.month).padStart(2, '0')}`,
            year: month.year,
            month: month.month,
            filename: file.name,
            uploadDate: new Date().toISOString(),
            lines: month.lines,
          }
          await savePcrIncomeStatement(statement)
          // Fort Sutter / ROC / Alhambra are paid as a lump monthly amount on the
          // PCR rather than computed per-shift -- carry that amount into the
          // "Additional Stipend" entry for the source month (one month prior,
          // per the PCR's payout lag) so it doesn't need to be typed in by hand.
          const carveoutReport = applyPcrStipendCarveouts(statement, pcrCategoryMappings, reports, schedules, activePhysicianId, settings, stipendMappings)
          if (carveoutReport) await saveReport(carveoutReport)
        }
        setIncomeStatementMonthsSaved(result.incomeStatement.length)
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to extract PDF pages')
    } finally {
      setPdfBusy(null)
    }
  }

  const handleFile = useCallback((f: File) => {
    setFile(f)
    resetUploadState()
    if (f.name.toLowerCase().endsWith('.pdf')) {
      handlePdfFile(f)
    } else {
      handleXlsxFile(f)
    }
  }, [handlePdfFile, handleXlsxFile])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const reportId = `${year}-${String(month).padStart(2, '0')}`
  const existing = reports.find((r) => r.id === reportId)

  const selectedSection = pdfSections?.[selectedSectionIdx]
  const pdfDoctorMismatch = !!(
    selectedSection && activePhysician && !namesLikelyMatch(activePhysician.name, selectedSection.doctorName)
  )

  const totalUnits = parsed ? parsed.reduce((s, li) => s + li.totalDistributableUnits, 0) : 0
  const distributableUnitsSum = parsed ? parsed.reduce((s, li) => s + li.timeUnits, 0) : 0
  const uniqueTickets = parsed ? new Set(parsed.map((li) => li.ticketNum)).size : 0
  const serviceDates = parsed ? [...new Set(parsed.map((li) => li.serviceDate))].sort() : []

  // Spot-checks against the source PDF's own printed "Total for <doctor>"
  // row -- catches silent OCR errors (a misread digit, a dropped row) that
  // wouldn't otherwise be visible until much later. Advisory only: doesn't
  // block saving, since a genuine mismatch might also mean the PDF's own
  // print rounds differently, not that our OCR is wrong.
  const totalUnitsMatch = printedTotals
    ? Math.abs(totalUnits - printedTotals.totalDistribUnits) < 0.01
    : null
  const distributableUnitsMatch = printedTotals
    ? Math.abs(distributableUnitsSum - printedTotals.distributableUnits) < 0.01
    : null

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const crossMonthCount = parsed
    ? parsed.filter((li) => !li.serviceDate.startsWith(monthPrefix)).length
    : 0

  const handleSave = async () => {
    if (!parsed || saving) return
    if (existing && !showConflict) {
      setShowConflict(true)
      return
    }
    setSaving(true)
    setShowConflict(false)
    const report = {
      id: reportId,
      year,
      month,
      filename: file!.name,
      uploadDate: new Date().toISOString(),
      unitDollarValue: parseFloat(unitValue) || 32,
      paddingMinutes: parseInt(paddingMins) || 30,
      defaultNoTimeHours: parseFloat(noTimeHours) || 4,
      unitCorrection: parseFloat(unitCorrection) || undefined,
      lineItems: parsed,
      workingDayOverrides: existing?.workingDayOverrides ?? {},
      dayStipends: existing?.dayStipends ?? {},
      dayNotes: existing?.dayNotes ?? {},
      stipends: existing?.stipends ?? [],
    }
    await saveReport(report)
    setSaving(false)
    navigate(`/month/${reportId}`)
  }

  // ── Multi-month split ─────────────────────────────────────────────────────
  const splitGroups = useMemo(() => {
    if (!parsed || multiMonthMode === 'none' || multiMonthMode === 'single') return null
    const groups = new Map<string, LineItem[]>()
    for (const li of parsed) {
      const ym = li.serviceDate.slice(0, 7)
      if (!groups.has(ym)) groups.set(ym, [])
      groups.get(ym)!.push(li)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [parsed, multiMonthMode])

  const handleSplitSave = async () => {
    if (!splitGroups || !file || saving) return
    setSaving(true)
    try {
      for (const [ym, items] of splitGroups) {
        const [y, m] = ym.split('-').map(Number)
        const existingReport = reports.find((r) => r.id === ym)
        await saveReport({
          id: ym,
          year: y,
          month: m,
          filename: file.name,
          uploadDate: new Date().toISOString(),
          unitDollarValue: parseFloat(unitValue) || 32,
          paddingMinutes: parseInt(paddingMins) || 30,
          defaultNoTimeHours: parseFloat(noTimeHours) || 4,
          // Deliberately not the form's `unitCorrection` field here -- a
          // correction is specific to one month's own summary/corrections
          // page, and this single form value would otherwise get applied
          // to every month in a multi-month split. Each split month keeps
          // whatever correction it already had.
          unitCorrection: existingReport?.unitCorrection,
          lineItems: items,
          workingDayOverrides: existingReport?.workingDayOverrides ?? {},
          dayStipends: existingReport?.dayStipends ?? {},
          dayNotes: existingReport?.dayNotes ?? {},
          stipends: existingReport?.stipends ?? [],
          autoSplit: true,
        })
      }
      navigate('/')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <div>
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg px-4 py-3 mb-5">
        <p className="text-xs font-semibold text-gray-400 mb-1">Expected format</p>
        <p className="text-xs text-gray-500">
          You can upload a PDF of the Case Distribution Report — it's read with OCR. For cleaner, faster
          results, upload the Excel export instead, available on request from the CASE office.
        </p>
      </div>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors mb-6 ${
          dragging
            ? 'border-indigo-500 bg-indigo-500/5'
            : file
            ? 'border-emerald-600 bg-emerald-500/5'
            : 'border-gray-700 hover:border-indigo-600 hover:bg-gray-800/50'
        }`}
      >
        {file ? (
          <div>
            <div className="w-10 h-10 bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-200">{file.name}</p>
            <button onClick={() => { setFile(null); resetUploadState() }}
              className="text-xs text-gray-500 hover:text-gray-300 mt-1">Remove</button>
          </div>
        ) : (
          <div>
            <svg className="w-10 h-10 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gray-400 mb-1">Drop your .xlsx or .pdf file here</p>
            <label className="cursor-pointer">
              <span className="text-xs text-indigo-400 font-medium hover:text-indigo-300">or click to browse</span>
              <input type="file" accept=".xlsx,.xls,.pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            </label>
          </div>
        )}
      </div>

      {pdfBusy === 'detecting' && (
        <div className="flex items-center gap-2 bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 mb-6 text-sm text-gray-400">
          <svg className="w-4 h-4 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Scanning pages for the Case Distribution Report…
        </div>
      )}

      {pdfSections && !parsed && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-6 space-y-4">
          <p className="text-sm font-semibold text-gray-200">
            {pdfSections.length === 1 ? 'Detected report pages' : `Detected ${pdfSections.length} report sections`}
          </p>
          {pdfSections.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Doctor / Section</label>
              <select
                value={selectedSectionIdx}
                onChange={(e) => {
                  const idx = parseInt(e.target.value)
                  setSelectedSectionIdx(idx)
                  setPageRangeInput(`${pdfSections[idx].startPage}-${pdfSections[idx].endPage}`)
                }}
                className={inputCls}
              >
                {pdfSections.map((s, i) => (
                  <option key={i} value={i}>
                    {s.doctorName || '(unlabeled)'} — pages {s.startPage}–{s.endPage}
                  </option>
                ))}
              </select>
            </div>
          )}
          {pdfSections.length === 1 && (
            <p className="text-xs text-gray-500">
              {pdfSections[0].doctorName || '(doctor name not detected)'} — pages {pdfSections[0].startPage}–{pdfSections[0].endPage}
            </p>
          )}
          {pdfDoctorMismatch && (
            <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-300">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                The detected doctor ("{selectedSection?.doctorName || 'unlabeled'}") doesn't look like a match for{' '}
                <strong>{activePhysician?.name}</strong>, who this will be saved under. Double-check the section
                before parsing.
              </span>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">
              Pages to parse <span className="text-gray-600 font-normal">(edit if the detected range looks wrong)</span>
            </label>
            <input
              type="text"
              value={pageRangeInput}
              onChange={(e) => setPageRangeInput(e.target.value)}
              placeholder="e.g. 6-10"
              className={inputCls}
            />
          </div>
          <button
            onClick={handleParsePdfPages}
            disabled={!pageRangeInput || pdfBusy === 'extracting'}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {pdfBusy === 'extracting' && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {pdfBusy === 'extracting' ? 'Reading pages (OCR)…' : 'Parse Pages'}
          </button>
        </div>
      )}

      {parseError && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 mb-6 text-sm text-red-400">
          {parseError}
        </div>
      )}

      {parsed && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl px-4 py-4 mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Preview</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-xs text-gray-500">Line Items</p>
              <p className="text-lg font-bold text-gray-100">{parsed.length}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Unique Cases</p>
              <p className="text-lg font-bold text-gray-100">{uniqueTickets}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Units</p>
              <p className="text-lg font-bold text-indigo-400 flex items-center gap-1.5">
                {totalUnits.toFixed(2)}
                {totalUnitsMatch !== null && (
                  totalUnitsMatch ? (
                    <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <title>Matches the PDF's printed total</title>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <title>Does not match the PDF's printed total</title>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )
                )}
              </p>
            </div>
          </div>

          {printedTotals && (
            <div className={`flex items-start gap-2 rounded-lg px-3 py-2 mb-3 text-xs ${
              totalUnitsMatch && distributableUnitsMatch
                ? 'bg-emerald-900/20 border border-emerald-700/40 text-emerald-300'
                : 'bg-red-900/20 border border-red-700/50 text-red-300'
            }`}>
              {totalUnitsMatch && distributableUnitsMatch ? (
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <div>
                {totalUnitsMatch && distributableUnitsMatch ? (
                  <span>Matches the PDF's own printed "Total for" row — Total Units {printedTotals.totalDistribUnits.toFixed(2)}, Distributable Time Units {printedTotals.distributableUnits.toFixed(2)}.</span>
                ) : (
                  <>
                    <span className="font-semibold">Mismatch against the PDF's own printed "Total for" row — double-check before saving:</span>
                    <ul className="list-disc pl-4 mt-1 space-y-0.5">
                      {!totalUnitsMatch && (
                        <li>Total Units: computed {totalUnits.toFixed(2)}, PDF says {printedTotals.totalDistribUnits.toFixed(2)}</li>
                      )}
                      {!distributableUnitsMatch && (
                        <li>Distributable Time Units: computed {distributableUnitsSum.toFixed(2)}, PDF says {printedTotals.distributableUnits.toFixed(2)}</li>
                      )}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          {incomeStatementMonthsSaved !== null && (
            <p className="text-xs text-emerald-500">
              ✓ Also found and saved {incomeStatementMonthsSaved} month{incomeStatementMonthsSaved !== 1 ? 's' : ''} of
              income-statement data (revenues, stipends, expenses) for the stipend audit and expense tracking.
            </p>
          )}

          {serviceDates.length > 0 && (
            <p className="text-xs text-gray-500">
              Service dates: {serviceDates[0]} → {serviceDates[serviceDates.length - 1]}
              {' '}({serviceDates.length} days)
            </p>
          )}
          {crossMonthCount > 0 && (
            <p className="text-xs text-amber-500 mt-1">
              {crossMonthCount} line item{crossMonthCount !== 1 ? 's' : ''} with service dates outside {getMonthName(month)} {year}.
            </p>
          )}
          {wasRaw && parsed && (
            <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="text-xs text-gray-400">Raw format detected —</span>
              <button
                onClick={() => {
                  const base = file!.name.replace(/\.[^.]+$/, '')
                  exportCleanXlsx(parsed, `${base}_clean.xlsx`)
                }}
                className="text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
              >
                Download cleaned .xlsx
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Multi-month prompt ────────────────────────────────────────────── */}
      {multiMonthMode === 'prompt' && splitGroups && (
        <div className="bg-indigo-950/40 border border-indigo-700/50 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3 mb-4">
            <svg className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-indigo-300 mb-0.5">Multi-month data detected</p>
              <p className="text-xs text-indigo-400/70">
                This file spans {splitGroups.length} months. Split into separate monthly reports, or import as a single report.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setMultiMonthMode('split')}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Split into {splitGroups.length} monthly reports
            </button>
            <button
              onClick={() => setMultiMonthMode('single')}
              className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg border border-gray-700 transition-colors"
            >
              Import as single report
            </button>
          </div>
        </div>
      )}

      {/* ── Split mode preview ────────────────────────────────────────────── */}
      {multiMonthMode === 'split' && splitGroups && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Split Preview</p>
            <button onClick={() => setMultiMonthMode('prompt')} className="text-xs text-gray-600 hover:text-gray-400">← Back</button>
          </div>
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="border-b border-gray-800">
                {['Month', 'Line Items', 'Tickets', 'Units', 'Status'].map((h) => (
                  <th key={h} className="pb-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {splitGroups.map(([ym, items]) => {
                const [y, m] = ym.split('-').map(Number)
                const tickets = new Set(items.map((li) => li.ticketNum)).size
                const units = items.reduce((s, li) => s + li.totalDistributableUnits, 0)
                const hasExisting = reports.some((r) => r.id === ym)
                return (
                  <tr key={ym} className="border-b border-gray-800/50">
                    <td className="py-2 pr-4 font-medium text-gray-200">{getMonthName(m)} {y}</td>
                    <td className="py-2 pr-4 text-gray-400">{items.length}</td>
                    <td className="py-2 pr-4 text-gray-400">{tickets}</td>
                    <td className="py-2 pr-4 text-indigo-400">{units.toFixed(2)}</td>
                    <td className="py-2">
                      {hasExisting
                        ? <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400">Will replace</span>
                        : <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400">New</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-xs text-gray-600 mb-4">
            Manual overrides (day hours, stipends, unit corrections) are preserved for months that already have reports.
          </p>
        </div>
      )}

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        {/* Month/year picker — hidden in split mode since each report gets its own */}
        {multiMonthMode !== 'split' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Month</label>
            <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))} className={inputCls}>
              {MONTH_ABBREVS.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Year</label>
            <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value))} className={inputCls} />
          </div>
        </div>
        )}

        <div className={multiMonthMode === 'split' ? '' : 'grid grid-cols-2 gap-4'}>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Dollar Value per Unit ($)</label>
            <input type="number" step="0.01" value={unitValue}
              onChange={(e) => setUnitValue(e.target.value)} placeholder="32.00" className={inputCls} />
          </div>
          {/* Unit correction is month-specific (tied to that month's own
              summary/corrections page) -- meaningless as a single value
              applied across every month in a split, so it's hidden there;
              each split month keeps whatever correction it already had. */}
          {multiMonthMode !== 'split' && (
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Unit Correction</label>
              <input type="number" step="0.01" value={unitCorrection}
                onChange={(e) => setUnitCorrection(e.target.value)} placeholder="0" className={inputCls} />
            </div>
          )}
        </div>

        {detectedUnitInfo && (
          detectedUnitInfo.reconciled ? (
            <p className="text-xs text-emerald-500">
              ✓ $/unit and unit correction auto-filled from this PDF's Physician 12 Month Summary page.
            </p>
          ) : (
            <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-300">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                Couldn't fully validate $/unit against this PDF's summary page (the computed rate didn't
                reconcile to the cent) — double-check the value above against the PDF before saving.
              </span>
            </div>
          )
        )}

        {detectedUnitInfo && (
          Math.abs((parseFloat(unitValue) || 0) - detectedUnitInfo.unitDollarValue) > 0.001 ||
          Math.abs((parseFloat(unitCorrection) || 0) - detectedUnitInfo.unitCorrection) > 0.001
        ) && (
          <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-300">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1">
              This PDF's summary page reports $/unit = ${detectedUnitInfo.unitDollarValue.toFixed(2)} and unit
              correction = {detectedUnitInfo.unitCorrection}, which differs from what's filled in above
              {existing ? ' (kept from the existing report for this month)' : ''}.{' '}
              <button
                onClick={() => {
                  setUnitValue(detectedUnitInfo.unitDollarValue.toFixed(2))
                  setUnitCorrection(String(detectedUnitInfo.unitCorrection))
                }}
                className="text-amber-200 underline underline-offset-2 hover:text-amber-100"
              >
                Use the PDF's values
              </button>
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Hours Padding (minutes)</label>
            <input type="number" value={paddingMins} onChange={(e) => setPaddingMins(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5">Default Hours (no-time days)</label>
            <input type="number" step="0.5" value={noTimeHours} onChange={(e) => setNoTimeHours(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Conflict modal */}
        {showConflict && existing && parsed && (
          <div className="bg-gray-800 border border-amber-700/60 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-semibold text-amber-300">
                A report for {formatMonthYear(year, month)} already exists
              </p>
            </div>

            {/* Line item comparison */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div />
              <div className="text-center font-semibold text-gray-500 uppercase tracking-wider">Current</div>
              <div className="text-center font-semibold text-gray-500 uppercase tracking-wider">New</div>
              {(() => {
                const oldCases = new Set(existing.lineItems.map(li => li.ticketNum)).size
                const newCases = new Set(parsed.map(li => li.ticketNum)).size
                const oldUnits = existing.lineItems.reduce((s, li) => s + li.totalDistributableUnits, 0)
                const newUnits = parsed.reduce((s, li) => s + li.totalDistributableUnits, 0)
                const oldDates = existing.lineItems.map(li => li.serviceDate).sort()
                const newDates = parsed.map(li => li.serviceDate).sort()
                const oldRange = oldDates.length ? `${formatDateFull(oldDates[0])} – ${formatDateFull(oldDates[oldDates.length - 1])}` : '—'
                const newRange = newDates.length ? `${formatDateFull(newDates[0])} – ${formatDateFull(newDates[newDates.length - 1])}` : '—'
                const rows = [
                  { label: 'Cases', old: String(oldCases), new_: String(newCases), changed: oldCases !== newCases },
                  { label: 'Line items', old: String(existing.lineItems.length), new_: String(parsed.length), changed: existing.lineItems.length !== parsed.length },
                  { label: 'Total units', old: oldUnits.toFixed(2), new_: newUnits.toFixed(2), changed: Math.abs(oldUnits - newUnits) > 0.001 },
                  { label: 'Date range', old: oldRange, new_: newRange, changed: oldRange !== newRange },
                ]
                return rows.map(r => (
                  <>
                    <div key={`${r.label}-l`} className="text-gray-500 flex items-center">{r.label}</div>
                    <div key={`${r.label}-o`} className={`text-center ${r.changed ? 'text-gray-400' : 'text-gray-600'}`}>{r.old}</div>
                    <div key={`${r.label}-n`} className={`text-center font-medium ${r.changed ? 'text-amber-300' : 'text-gray-600'}`}>{r.new_}</div>
                  </>
                ))
              })()}
            </div>

            {/* Manual adjustments that will be preserved */}
            {(() => {
              const overrideCount = Object.keys(existing.workingDayOverrides ?? {}).length
              const stipendCount = Object.keys(existing.dayStipends ?? {}).length
              const hasCorrection = !!existing.unitCorrection
              const hasLegacyStipends = (existing.stipends ?? []).length > 0
              const items = [
                overrideCount > 0 && `${overrideCount} day hour override${overrideCount !== 1 ? 's' : ''}`,
                stipendCount > 0 && `${stipendCount} day stipend${stipendCount !== 1 ? 's' : ''}`,
                hasCorrection && `unit correction (${existing.unitCorrection! > 0 ? '+' : ''}${existing.unitCorrection})`,
                hasLegacyStipends && `${existing.stipends.length} additional stipend${existing.stipends.length !== 1 ? 's' : ''}`,
              ].filter(Boolean) as string[]
              if (items.length === 0) return null
              return (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Preserved from existing report</p>
                  {items.map(item => (
                    <div key={item} className="flex items-center gap-2 text-xs text-emerald-400">
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* $/unit warning if form value differs from existing */}
            {Math.abs((parseFloat(unitValue) || 32) - existing.unitDollarValue) > 0.001 && (
              <div className="flex items-center gap-2 text-xs text-amber-500">
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                $/unit will change from ${existing.unitDollarValue.toFixed(2)} → ${(parseFloat(unitValue) || 32).toFixed(2)}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40">
                {saving ? 'Saving…' : 'Replace Line Items'}
              </button>
              <button onClick={() => setShowConflict(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!showConflict && multiMonthMode !== 'split' && (
          <div className="space-y-2">
            <button
              onClick={handleSave}
              disabled={!parsed || saving || multiMonthMode === 'prompt'}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : `Save ${formatMonthYear(year, month)} Report`}
            </button>
          </div>
        )}
        {multiMonthMode === 'split' && (
          <div className="space-y-2">
            <button
              onClick={handleSplitSave}
              disabled={!splitGroups || saving}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : `Save ${splitGroups?.length ?? 0} Monthly Reports`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Schedule Upload ──────────────────────────────────────────────────────────

interface ConflictEntry {
  date: string
  currentShifts: string[]
  newShifts: string[]
  accept: boolean
}

function ScheduleUploadTab() {
  const { schedules, saveSchedule, deleteSchedule, physicians, activePhysicianId } = useData()
  const activePhysician = physicians.find(p => p.id === activePhysicianId)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsedEvents, setParsedEvents] = useState<Array<{ date: string; summary: string }> | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [showRangeModal, setShowRangeModal] = useState(false)

  const [conflicts, setConflicts] = useState<ConflictEntry[]>([])
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [pendingEntries, setPendingEntries] = useState<ShiftEntry[]>([])
  const [isDuplicate, setIsDuplicate] = useState(false)

  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // ── PDF import (server-side text extraction) ──────────────────────────────
  const [pdfParsing, setPdfParsing] = useState(false)
  const [pdfResult, setPdfResult] = useState<SchedulePdfResult | null>(null)
  const [pdfMonthYear, setPdfMonthYear] = useState('')
  const [pdfSelectedRow, setPdfSelectedRow] = useState(0)
  const [pdfXResolutions, setPdfXResolutions] = useState<Record<string, 'H' | 'V' | 'Postcall'>>({})

  const resetFile = () => {
    setFile(null)
    setParsedEvents(null)
    setPdfResult(null)
    setPdfXResolutions({})
  }

  const handleIcsFile = useCallback(async (f: File) => {
    try {
      const text = await f.text()
      const events = parseICS(text)
      if (events.length === 0) {
        setParseError('No all-day events found in this ICS file.')
        return
      }
      setParsedEvents(events)
      // Default date range to span of events
      const dates = events.map((e) => e.date).sort()
      setRangeStart(dates[0])
      setRangeEnd(dates[dates.length - 1])
      setShowRangeModal(true)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse ICS file')
    }
  }, [])

  const handleSchedulePdfFile = useCallback(async (f: File) => {
    setPdfParsing(true)
    try {
      const result = await api.schedulePdf.parse(f)
      setPdfResult(result)
      if (result.month && result.year) {
        setPdfMonthYear(`${result.year}-${String(result.month).padStart(2, '0')}`)
      }
      // Best-guess row match against the active physician's name (surname-style
      // tokens, since PDF rows are typically just a surname -- unless the
      // physician's own name carries a first initial that resolves a
      // same-surname collision down to one row, e.g. "Andrew Brown" against
      // "A. Brown" / "M. Brown").
      let bestIdx = 0
      if (activePhysician) {
        const resolved = resolveRowMatches(activePhysician.name, result.rows)
        const idx = resolved.length > 0 ? result.rows.indexOf(resolved[0]) : -1
        if (idx >= 0) bestIdx = idx
      }
      setPdfSelectedRow(bestIdx)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse schedule PDF')
    } finally {
      setPdfParsing(false)
    }
  }, [activePhysician])

  const handleFile = useCallback((f: File) => {
    resetFile()
    setFile(f)
    setParseError(null)
    setSaved(false)
    if (f.name.toLowerCase().endsWith('.pdf')) {
      handleSchedulePdfFile(f)
    } else {
      handleIcsFile(f)
    }
  }, [handleSchedulePdfFile, handleIcsFile])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const filteredEvents = parsedEvents?.filter(
    (e) => (!rangeStart || e.date >= rangeStart) && (!rangeEnd || e.date <= rangeEnd)
  ) ?? []

  const selectedPdfRow = pdfResult?.rows[pdfSelectedRow]
  const pdfRowMismatch = !!(
    selectedPdfRow && activePhysician && !namesLikelyMatch(activePhysician.name, selectedPdfRow.name)
  )
  // A bare surname can match more than one row (e.g. "Brown" matching both
  // "A. Brown" and "M. Brown") -- the auto-select above just picks the
  // first one, so warn even when the currently-selected row does match,
  // since it might be the wrong one of several. Only still-ambiguous
  // candidates are reported here -- if the physician's own name carries a
  // first initial that already resolved this down to one row, there's
  // nothing to warn about.
  const pdfMultipleRowMatches = useMemo(() => {
    if (!pdfResult || !activePhysician) return []
    return resolveRowMatches(activePhysician.name, pdfResult.rows)
  }, [pdfResult, activePhysician])

  // Day-by-day {date, shift} list for the selected PDF row, remapped to the
  // confirmed month/year (so overriding a misdetected month needs no
  // re-parse) and with blank cells dropped before any further processing.
  const pdfDayList = useMemo(() => {
    if (!pdfResult || !pdfMonthYear) return []
    const row = pdfResult.rows[pdfSelectedRow]
    if (!row) return []
    const [y, m] = pdfMonthYear.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    return row.shifts
      .slice(0, daysInMonth)
      .map((shift, i) => ({
        date: `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
        shift,
      }))
      .filter((e) => e.shift.trim() !== '')
  }, [pdfResult, pdfMonthYear, pdfSelectedRow])

  // If the confirmed month has more days than the PDF had columns for (e.g.
  // the month was overridden after a misdetection), the trailing day(s) have
  // no source data at all -- flag it rather than silently dropping them.
  const pdfMonthLongerThanDetected = useMemo(() => {
    if (!pdfResult || !pdfMonthYear) return false
    const row = pdfResult.rows[pdfSelectedRow]
    if (!row) return false
    const [y, m] = pdfMonthYear.split('-').map(Number)
    return new Date(y, m, 0).getDate() > row.shifts.length
  }, [pdfResult, pdfMonthYear, pdfSelectedRow])

  // "X" is ambiguous shorthand (holiday/vacation/postcall) -- same resolution
  // logic as Grid Paste: auto-resolve to Postcall if the previous day was a
  // G1/G2 call shift (checked against this same row first, then stored
  // schedules), otherwise the user must pick one below.
  const pdfXEntries = useMemo(() => {
    const parsedMap = new Map(pdfDayList.map((e) => [e.date, e.shift]))
    const storedMap = new Map<string, string[]>()
    for (const sched of [...schedules].filter((s) => s.id !== 'manual_shifts').sort((a, b) => a.uploadDate.localeCompare(b.uploadDate)))
      for (const entry of sched.entries)
        storedMap.set(entry.date, entry.shiftTypes)

    return pdfDayList
      .filter((e) => e.shift.trim().toUpperCase() === 'X')
      .map((e) => {
        const [y, m, d] = e.date.split('-').map(Number)
        const prev = new Date(y, m - 1, d - 1)
        const prevStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
        const prevShift = parsedMap.get(prevStr)
        const prevShifts = prevShift ? [prevShift] : (storedMap.get(prevStr) ?? [])
        const isPostcall = prevShifts.some((s) => { const v = s.trim().toUpperCase(); return v === 'G1' || v === 'G2' })
        return { date: e.date, autoLabel: isPostcall ? 'Postcall' as const : null }
      })
  }, [pdfDayList, schedules])

  const pdfUnresolvedXDates = useMemo(
    () => pdfXEntries.filter((x) => x.autoLabel === null).map((x) => x.date),
    [pdfXEntries],
  )
  const pdfAllXResolved = pdfUnresolvedXDates.every((d) => pdfXResolutions[d])

  function pdfResolvedShift(e: { date: string; shift: string }): string {
    if (e.shift.trim().toUpperCase() !== 'X') return e.shift
    const xe = pdfXEntries.find((x) => x.date === e.date)
    return xe?.autoLabel ?? pdfXResolutions[e.date] ?? e.shift
  }

  // Conflict/duplicate detection + save -- shared by both the ICS and PDF
  // import paths (each just builds newEntries differently upstream).
  const reviewAndSave = (newEntries: ShiftEntry[]) => {
    const existingMap = new Map<string, string[]>()
    const sortedExisting = [...schedules].sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
    for (const sched of sortedExisting) {
      for (const entry of sched.entries) {
        existingMap.set(entry.date, entry.shiftTypes)
      }
    }

    const detected: ConflictEntry[] = []
    for (const entry of newEntries) {
      const current = existingMap.get(entry.date)
      const currentSorted = current ? [...current].sort().join(',') : ''
      const newSorted = [...entry.shiftTypes].sort().join(',')
      if (current && currentSorted !== newSorted) {
        detected.push({
          date: entry.date,
          currentShifts: current,
          newShifts: entry.shiftTypes,
          accept: true,
        })
      }
    }

    setPendingEntries(newEntries)

    // Detect pure duplicate: all new entries match existing exactly, nothing new
    const allMatch = newEntries.length > 0 && newEntries.every((e) => {
      const current = existingMap.get(e.date)
      if (!current) return false
      return [...e.shiftTypes].sort().join(',') === [...current].sort().join(',')
    })
    const hasNewDates = newEntries.some((e) => !existingMap.has(e.date))
    if (allMatch && !hasNewDates && detected.length === 0) {
      setIsDuplicate(true)
      return
    }

    if (detected.length > 0) {
      setConflicts(detected)
      setShowConflictModal(true)
    } else {
      doSave(newEntries, [])
    }
  }

  const handleReviewImport = () => {
    setShowRangeModal(false)
    // Group multiple events per date into shiftTypes[]
    const byDate = new Map<string, string[]>()
    for (const e of filteredEvents) {
      if (!byDate.has(e.date)) byDate.set(e.date, [])
      byDate.get(e.date)!.push(...parseShiftSummary(e.summary))
    }
    const newEntries: ShiftEntry[] = [...byDate.entries()].map(([date, shiftTypes]) => ({ date, shiftTypes }))
    reviewAndSave(newEntries)
  }

  const handlePdfImport = () => {
    const newEntries: ShiftEntry[] = pdfDayList.map((e) => ({
      date: e.date,
      shiftTypes: parseShiftSummary(pdfResolvedShift(e)),
    }))
    reviewAndSave(newEntries)
  }

  const doSave = async (entries: ShiftEntry[], rejectedDates: string[]) => {
    if (saving) return
    setSaving(true)
    try {
      const finalEntries = entries.filter((e) => !rejectedDates.includes(e.date))
      const schedule: Schedule = {
        id: genId(),
        filename: file!.name,
        uploadDate: new Date().toISOString(),
        entries: finalEntries,
      }
      await saveSchedule(schedule)
      setSaved(true)
      setShowConflictModal(false)
      resetFile()
    } finally {
      setSaving(false)
    }
  }

  const handleApplyConflicts = async () => {
    const rejected = conflicts.filter((c) => !c.accept).map((c) => c.date)
    await doSave(pendingEntries, rejected)
  }

  const existingSchedules = schedules.filter((s) => s.id !== 'manual_shifts')

  return (
    <div>
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg px-4 py-3 mb-5">
        <p className="text-xs font-semibold text-gray-400 mb-1">Expected format</p>
        <p className="text-xs text-gray-500">
          Upload the monthly schedule grid PDF — you'll pick your row and confirm the month before
          importing. Alternatively, upload an .ics file exported from your calendar app, with shifts as
          all-day events (title containing the shift code, e.g. G1, G2, APS, V).
        </p>
      </div>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors mb-6 ${
          dragging
            ? 'border-indigo-500 bg-indigo-500/5'
            : file && !saved
            ? 'border-emerald-600 bg-emerald-500/5'
            : 'border-gray-700 hover:border-indigo-600 hover:bg-gray-800/50'
        }`}
      >
        {file && !saved ? (
          <div>
            <div className="w-10 h-10 bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-200">{file.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {pdfResult ? `${pdfResult.rows.length} physician row(s) found` : `${parsedEvents?.length ?? 0} events parsed`}
            </p>
            <button onClick={resetFile}
              className="text-xs text-gray-500 hover:text-gray-300 mt-1">Remove</button>
          </div>
        ) : (
          <div>
            <svg className="w-10 h-10 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-gray-400 mb-1">Drop your .ics or .pdf schedule file here</p>
            <label className="cursor-pointer">
              <span className="text-xs text-indigo-400 font-medium hover:text-indigo-300">or click to browse</span>
              <input type="file" accept=".ics,.pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            </label>
          </div>
        )}
      </div>

      {pdfParsing && (
        <div className="flex items-center gap-2 bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-3 mb-6 text-sm text-gray-400">
          <svg className="w-4 h-4 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Reading schedule PDF…
        </div>
      )}

      {pdfResult && !saved && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-6 space-y-4">
          <p className="text-sm font-semibold text-gray-200">Confirm import</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Month</label>
              <MonthPicker value={pdfMonthYear} onChange={setPdfMonthYear} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-1.5">Physician row</label>
              <select
                value={pdfSelectedRow}
                onChange={(e) => setPdfSelectedRow(parseInt(e.target.value))}
                className={`${SEL_CLS} w-full`}
              >
                {pdfResult.rows.map((r, i) => (
                  <option key={i} value={i}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            {pdfMonthYear
              ? `${pdfDayList.length} day${pdfDayList.length !== 1 ? 's' : ''} with a shift assigned.`
              : 'Select a month above to continue.'}
          </p>

          {pdfMonthLongerThanDetected && (
            <p className="text-xs text-amber-400">
              The selected month has more days than this PDF's grid had columns for — the last day(s)
              of the month won't be imported since there's no source data for them.
            </p>
          )}

          {pdfRowMismatch && (
            <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-300">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                The selected row ("{selectedPdfRow?.name}") doesn't look like a match for{' '}
                <strong>{activePhysician?.name}</strong>, who this will be saved under. Double-check the row
                before importing.
              </span>
            </div>
          )}

          {!pdfRowMismatch && pdfMultipleRowMatches.length > 1 && (
            <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2 text-xs text-amber-300">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                {pdfMultipleRowMatches.length} rows in this grid look like a possible match for{' '}
                <strong>{activePhysician?.name}</strong> ({pdfMultipleRowMatches.map((r) => `"${r.name}"`).join(', ')}).
                Confirm the physician row above is the right one before importing.
              </span>
            </div>
          )}

          {pdfUnresolvedXDates.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-gray-800">
              <p className="text-xs font-semibold text-amber-400">
                {pdfUnresolvedXDates.length} "X" day{pdfUnresolvedXDates.length !== 1 ? 's' : ''} need clarification
              </p>
              {pdfUnresolvedXDates.map((date) => (
                <div key={date} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-400">{formatDateFull(date)}</span>
                  <select
                    value={pdfXResolutions[date] ?? ''}
                    onChange={(e) => setPdfXResolutions((prev) => ({ ...prev, [date]: e.target.value as 'H' | 'V' | 'Postcall' }))}
                    className={SEL_CLS}
                  >
                    <option value="">Choose…</option>
                    <option value="H">Holiday</option>
                    <option value="V">Vacation</option>
                    <option value="Postcall">Postcall</option>
                  </select>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={handlePdfImport}
            disabled={pdfDayList.length === 0 || !pdfAllXResolved || saving}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Import'}
          </button>
        </div>
      )}

      {saved && (
        <div className="bg-emerald-900/30 border border-emerald-800 rounded-lg px-4 py-3 mb-6 text-sm text-emerald-400">
          Schedule imported successfully.
        </div>
      )}

      {isDuplicate && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg px-4 py-4 mb-6">
          <div className="flex items-start gap-3">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-300 mb-1">Duplicate schedule detected</p>
              <p className="text-xs text-amber-400/80 mb-3">
                All {pendingEntries.length} entries in this file are identical to shifts already imported.
                No new or changed dates were found — importing would create a redundant record.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setIsDuplicate(false); doSave(pendingEntries, []) }}
                  disabled={saving}
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white text-xs rounded-md font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Import Anyway
                </button>
                <button
                  onClick={() => { setIsDuplicate(false); resetFile() }}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {parseError && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 mb-6 text-sm text-red-400">
          {parseError}
        </div>
      )}

      {/* Existing schedules */}
      {existingSchedules.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300">Imported Schedules</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['File', 'Imported', 'Entries'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {[...existingSchedules].reverse().map((s) => (
                <tr key={s.id} className="border-b border-gray-800">
                  <td className="px-4 py-3 text-gray-300">{s.filename}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(s.uploadDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{s.entries.length}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={async () => {
                        if (!confirm('Remove this schedule? Shift data will be lost.')) return
                        await deleteSchedule(s.id)
                      }}
                      className="text-gray-700 hover:text-red-400 text-xs"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Date range modal */}
      {showRangeModal && parsedEvents && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-base font-semibold text-gray-100 mb-1">Select Date Range</h3>
            <p className="text-xs text-gray-500 mb-4">
              {parsedEvents.length} events found. Choose which dates to import.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">From</label>
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">To</label>
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-5">
              {filteredEvents.length} events in selected range
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowRangeModal(false); handleReviewImport() }}
                disabled={filteredEvents.length === 0}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40"
              >
                Review Import
              </button>
              <button
                onClick={() => { setShowRangeModal(false); resetFile() }}
                className="px-4 py-2 text-gray-400 hover:text-gray-200 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict resolution modal */}
      {showConflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
            <h3 className="text-base font-semibold text-gray-100 mb-1">Resolve Conflicts</h3>
            <p className="text-xs text-gray-500 mb-4">
              {conflicts.length} date{conflicts.length !== 1 ? 's' : ''} already have shift assignments.
              Choose which changes to apply.
            </p>
            <div className="flex-1 overflow-y-auto mb-4">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="border-b border-gray-800">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Current</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">New</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Accept</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((c, i) => (
                    <tr key={c.date} className="border-b border-gray-800">
                      <td className="px-3 py-2.5 text-gray-300">{formatDateFull(c.date)}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">{c.currentShifts.join(', ')}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs bg-indigo-900/40 text-indigo-400 px-2 py-0.5 rounded">{c.newShifts.join(', ')}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={c.accept}
                          onChange={(e) =>
                            setConflicts((prev) =>
                              prev.map((x, j) => j === i ? { ...x, accept: e.target.checked } : x)
                            )
                          }
                          className="accent-indigo-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 border-t border-gray-800 pt-4">
              <button
                onClick={() => setConflicts((prev) => prev.map((c) => ({ ...c, accept: true })))}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Accept all
              </button>
              <button
                onClick={() => setConflicts((prev) => prev.map((c) => ({ ...c, accept: false })))}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Reject all
              </button>
              <div className="flex-1" />
              <button
                onClick={() => { setShowConflictModal(false); resetFile() }}
                disabled={saving}
                className="px-4 py-2 text-gray-400 hover:text-gray-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyConflicts}
                disabled={saving}
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Apply Selected Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Stipend Rates Upload ─────────────────────────────────────────────────────

function StipendRatesTab() {
  const { stipendMappings: ctxMappings, saveStipendMapping, deleteStipendMapping } = useData()

  // Sort descending (newest first) for display
  const existingMappings = [...ctxMappings].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))

  // ── Upload state ──────────────────────────────────────────────────────────
  const today = new Date()
  const defaultUploadMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsedSheets, setParsedSheets] = useState<ParsedStipendSheet[] | null>(null)
  // Per-sheet effective month overrides (keyed by sheetName): YYYY-MM
  const [sheetDates, setSheetDates] = useState<Record<string, string>>({})
  const [parseError, setParseError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // ── Edit state ────────────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<StipendMapping | null>(null)

  const handleFile = useCallback(async (f: File) => {
    setFile(f); setParsedSheets(null); setSheetDates({}); setParseError(null); setSaved(false)
    try {
      const sheets = parseStipendMappings(await f.arrayBuffer())
      if (sheets.length === 0) {
        setParseError('No valid shift→amount rows found. Expected 2-column spreadsheet (shift name, dollar amount).')
        return
      }
      setParsedSheets(sheets)
      // Pre-fill detected dates; fallback to current month
      const dates: Record<string, string> = {}
      sheets.forEach((s) => {
        dates[s.sheetName] = s.detectedDate ? s.detectedDate.slice(0, 7) : defaultUploadMonth
      })
      setSheetDates(dates)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Failed to parse file')
    }
  }, [defaultUploadMonth])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) handleFile(f)
  }, [handleFile])

  const handleSave = async () => {
    if (!parsedSheets || !file) return
    const uploadDate = new Date().toISOString()
    for (const sheet of parsedSheets) {
      const month = sheetDates[sheet.sheetName] ?? defaultUploadMonth
      // Use sheet name stripped of the leading YYYY-MM prefix as the mapping name
      const strippedName = sheet.sheetName.replace(/^\d{4}-\d{2}\s*/, '').trim()
      const mapping: StipendMapping = {
        id: genId(),
        name: strippedName || sheet.sheetName,
        filename: file.name,
        uploadDate,
        effectiveDate: month + '-01',
        rates: sheet.rates,
      }
      await saveStipendMapping(mapping)
    }
    setSaved(true); setFile(null); setParsedSheets(null); setSheetDates({})
  }

  const expandMapping = (m: StipendMapping) => {
    setExpandedId(m.id)
    setDraft({ ...m, rates: m.rates.map((r) => ({ ...r })) })
  }

  const collapseMapping = () => { setExpandedId(null); setDraft(null) }

  const saveDraft = async () => {
    if (!draft) return
    await saveStipendMapping(draft)
    collapseMapping()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this stipend schedule? This cannot be undone.')) return
    await deleteStipendMapping(id)
    if (expandedId === id) collapseMapping()
  }

  const updateRate = (idx: number, field: keyof StipendRate, value: string | number) => {
    if (!draft) return
    setDraft({ ...draft, rates: draft.rates.map((r, i) => i === idx ? { ...r, [field]: value } : r) })
  }

  return (
    <div>
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg px-4 py-3 mb-5">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-xs font-semibold text-gray-400">Expected format</p>
          <div className="relative group">
            <button
              type="button"
              className="w-4 h-4 rounded-full border border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-300 transition-colors flex items-center justify-center text-[10px] font-bold leading-none"
              tabIndex={-1}
            >
              i
            </button>
            <div className="absolute left-0 top-6 z-50 hidden group-hover:block w-72 bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-xl text-xs text-gray-300 space-y-2">
              <p className="font-semibold text-gray-200 mb-1">Rate Key Format</p>
              <p>Each row has a <span className="font-mono text-indigo-300">shiftType</span> key and a dollar amount. Keys are case-insensitive.</p>
              <div className="space-y-1">
                <p className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">Weekday / Weekend variants</p>
                <p>Append <span className="font-mono text-amber-300">_weekday</span> or <span className="font-mono text-amber-300">_weekend</span> to a shift name to set day-type-specific rates (e.g. <span className="font-mono text-gray-400">G1_weekday</span>, <span className="font-mono text-gray-400">G1_weekend</span>). If only a plain key exists it applies to both.</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">Call shifts (G1 / G2)</p>
                <p>Always resolved using <span className="font-mono text-amber-300">_weekday</span> / <span className="font-mono text-amber-300">_weekend</span> suffix based on federal holiday calendar.</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">GI / ENDO</p>
                <p><span className="font-mono text-gray-400">ENDO</span> is an alias for <span className="font-mono text-gray-400">GI</span>. GI always uses the <span className="font-mono text-amber-300">_weekend</span> rate regardless of day.</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-gray-400 uppercase tracking-wide text-[10px]">Fixed-hour shifts</p>
                <p><span className="font-mono text-gray-400">APS</span>, <span className="font-mono text-gray-400">BR</span>, and <span className="font-mono text-gray-400">NIR</span> support plain or <span className="font-mono text-amber-300">_weekday</span>/<span className="font-mono text-amber-300">_weekend</span> variants.</p>
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          2-column Excel (.xlsx) spreadsheet. Column A: shift type key (e.g., G1_weekday, G1_weekend, APS, BR, NIR, GI).
          Column B: dollar amount per shift day. Set the effective month after upload to control which
          pay periods these rates apply to.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors mb-6 ${
          dragging ? 'border-indigo-500 bg-indigo-500/5'
          : file && !saved ? 'border-emerald-600 bg-emerald-500/5'
          : 'border-gray-700 hover:border-indigo-600 hover:bg-gray-800/50'
        }`}
      >
        {file && !saved ? (
          <div>
            <div className="w-10 h-10 bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-200">{file.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {parsedSheets
                ? parsedSheets.length === 1
                  ? `${parsedSheets[0].rates.length} shift rates found`
                  : `${parsedSheets.length} schedules · ${parsedSheets.reduce((n, s) => n + s.rates.length, 0)} rates total`
                : '0 shift rates found'}
            </p>
            <button onClick={() => { setFile(null); setParsedSheets(null); setSheetDates({}) }}
              className="text-xs text-gray-500 hover:text-gray-300 mt-1">Remove</button>
          </div>
        ) : (
          <div>
            <svg className="w-10 h-10 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-gray-400 mb-1">Drop your stipend rates .xlsx file here</p>
            <label className="cursor-pointer">
              <span className="text-xs text-indigo-400 font-medium hover:text-indigo-300">or click to browse</span>
              <input type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            </label>
          </div>
        )}
      </div>

      {saved && (
        <div className="bg-emerald-900/30 border border-emerald-800 rounded-lg px-4 py-3 mb-6 text-sm text-emerald-400">
          Stipend rates saved successfully.
        </div>
      )}

      {parseError && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 mb-6 text-sm text-red-400">
          {parseError}
        </div>
      )}

      {parsedSheets && (
        <div className="space-y-3 mb-6">
          {parsedSheets.map((sheet) => (
            <div key={sheet.sheetName} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
              {parsedSheets.length > 1 && (
                <p className="text-xs font-semibold text-gray-300 mb-3 truncate">{sheet.sheetName}</p>
              )}
              <div className="flex items-center gap-4 mb-3 flex-wrap">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Effective from</p>
                <MonthPicker
                  value={sheetDates[sheet.sheetName] ?? defaultUploadMonth}
                  onChange={(v) => setSheetDates((prev) => ({ ...prev, [sheet.sheetName]: v || defaultUploadMonth }))}
                />
                {sheet.detectedDate && (
                  <p className="text-xs text-indigo-400">auto-detected from sheet name</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto">
                {sheet.rates.map((r) => (
                  <div key={r.shiftType} className="flex justify-between text-xs py-1 px-2 rounded hover:bg-gray-800">
                    <span className="font-mono text-gray-400">{r.shiftType}</span>
                    <span className="text-emerald-400">${r.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button
            onClick={handleSave}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            {parsedSheets.length === 1 ? 'Save Stipend Rates' : `Save All ${parsedSheets.length} Rate Schedules`}
          </button>
        </div>
      )}

      {/* Saved rate schedules */}
      {existingMappings.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-300">Saved Stipend Rate Schedules</h3>
            <button
              onClick={() => exportStipendMappings(existingMappings)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              title="Export all rate schedules to Excel"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export
            </button>
          </div>
          <div className="divide-y divide-gray-800">
            {existingMappings.map((m, i) => {
              const isExpanded = expandedId === m.id
              const isCurrent = i === 0
              // nextM is the later-effective mapping (lower index in descending sort = earlier index = i-1)
              const nextM = existingMappings[i - 1] ?? null

              return (
                <div key={m.id}>
                  {/* Row header */}
                  <button
                    onClick={() => isExpanded ? collapseMapping() : expandMapping(m)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors text-left"
                  >
                    <svg
                      className={`w-3 h-3 text-gray-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-medium text-gray-200">{m.name || m.filename}</span>
                    <span className="text-xs text-gray-600 mx-1">·</span>
                    <span className="text-xs text-gray-500 flex-1">{stipendDateRange(m, nextM)}</span>
                    {isCurrent && (
                      <span className="text-xs px-1.5 py-0.5 bg-indigo-900/40 text-indigo-400 rounded">current</span>
                    )}
                    <span className="text-xs text-gray-700 ml-2">{m.rates.length} rates</span>
                  </button>

                  {/* Expanded editor */}
                  {isExpanded && draft?.id === m.id && (
                    <div className="border-t border-gray-800 p-4">
                      {/* Name + dates */}
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Name</label>
                          <input
                            type="text"
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            placeholder="e.g. 2025 Rates"
                            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Effective from</label>
                          <MonthPicker
                            value={draft.effectiveDate.slice(0, 7)}
                            onChange={(v) => setDraft({ ...draft, effectiveDate: v ? v + '-01' : draft.effectiveDate })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                            Till <span className="font-normal text-gray-600 normal-case">(blank = ongoing)</span>
                          </label>
                          <div className="flex items-center gap-2">
                            <MonthPicker
                              value={draft.endDate ? draft.endDate.slice(0, 7) : ''}
                              onChange={(v) => setDraft({ ...draft, endDate: v ? lastDayOfMonth(...v.split('-').map(Number) as [number, number]) : undefined })}
                              placeholder="—"
                            />
                            {draft.endDate && (
                              <button
                                onClick={() => setDraft({ ...draft, endDate: undefined })}
                                className="text-gray-600 hover:text-gray-400"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Rates table */}
                      <table className="w-full text-sm mb-3">
                        <thead>
                          <tr className="border-b border-gray-800">
                            <th className="pb-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Shift Type</th>
                            <th className="pb-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider pl-4">Amount</th>
                            <th className="pb-2 w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {draft.rates.map((rate, ri) => (
                            <tr key={ri} className="border-b border-gray-800/50">
                              <td className="py-1.5 pr-4">
                                <input
                                  value={rate.shiftType}
                                  onChange={(e) => updateRate(ri, 'shiftType', e.target.value)}
                                  placeholder="e.g. G1_weekend"
                                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full"
                                />
                              </td>
                              <td className="py-1.5 pl-4 pr-4">
                                <div className="flex items-center gap-1">
                                  <span className="text-gray-500 text-xs">$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={rate.amount}
                                    onChange={(e) => updateRate(ri, 'amount', parseFloat(e.target.value) || 0)}
                                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-28"
                                  />
                                </div>
                              </td>
                              <td className="py-1.5">
                                <button
                                  onClick={() => setDraft({ ...draft, rates: draft.rates.filter((_, j) => j !== ri) })}
                                  className="text-gray-700 hover:text-red-400 transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <button
                        onClick={() => setDraft({ ...draft, rates: [...draft.rates, { shiftType: '', amount: 0 }] })}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-medium mb-4"
                      >
                        + Add Rate
                      </button>

                      <div className="flex items-center gap-3 border-t border-gray-800 pt-4">
                        <button
                          onClick={saveDraft}
                          className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-500 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={collapseMapping}
                          className="px-4 py-1.5 text-gray-400 hover:text-gray-200 text-xs font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="ml-auto text-xs text-red-500 hover:text-red-400 font-medium"
                        >
                          Delete Schedule
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Grid Paste ───────────────────────────────────────────────────────────────

function SchedulePasteTab() {
  const { schedules, saveSchedule } = useData()

  const now = new Date()
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const [year, setYear]   = useState(nextMonthDate.getFullYear())
  const [month, setMonth] = useState(nextMonthDate.getMonth() + 1)
  const [activeWeekends, setActiveWeekends] = useState<Set<string>>(new Set())
  const [pasteText, setPasteText]           = useState('')
  const [parseResult, setParseResult]       = useState<ParseScheduleResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const [conflicts,         setConflicts]         = useState<ConflictEntry[]>([])
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [pendingEntries,    setPendingEntries]    = useState<ShiftEntry[]>([])
  const [isDuplicate,       setIsDuplicate]       = useState(false)
  const [xResolutions, setXResolutions] = useState<Record<string, 'H' | 'V' | 'Postcall'>>({})

  const weekendPairs = useMemo(() => getWeekendPairs(year, month), [year, month])

  const activeWeekendDates = useMemo(() => {
    const dates = new Set<string>()
    for (const key of activeWeekends) {
      const pair = weekendPairs.find(p => p.dates[0] === key)
      if (pair) pair.dates.forEach(d => dates.add(d))
    }
    return dates
  }, [activeWeekends, weekendPairs])

  const dayList = useMemo(
    () => buildDayList(year, month, activeWeekendDates),
    [year, month, activeWeekendDates],
  )

  // Re-parse whenever any input changes; clear X resolutions on any change
  useEffect(() => {
    setXResolutions({})
    if (!pasteText.trim()) { setParseResult(null); return }
    setParseResult(parseScheduleText(year, month, activeWeekendDates, pasteText))
  }, [pasteText, year, month, activeWeekendDates])

  // For each X in the parse result, determine if it auto-resolves to Postcall
  // (previous calendar day = G1/G2 in this paste or in stored schedules)
  const xEntries = useMemo(() => {
    if (!parseResult?.entries) return []
    const parsedMap = new Map(parseResult.entries.map(e => [e.date, e.shift]))
    const storedMap = new Map<string, string[]>()
    for (const sched of [...schedules].filter(s => s.id !== 'manual_shifts').sort((a, b) => a.uploadDate.localeCompare(b.uploadDate)))
      for (const entry of sched.entries)
        storedMap.set(entry.date, entry.shiftTypes)

    return parseResult.entries
      .filter(e => e.shift.trim().toUpperCase() === 'X')
      .map(e => {
        const [y, m, d] = e.date.split('-').map(Number)
        const prev = new Date(y, m - 1, d - 1)
        const prevStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
        const prevShift = parsedMap.get(prevStr)
        const prevShifts = prevShift ? [prevShift] : (storedMap.get(prevStr) ?? [])
        const isPostcall = prevShifts.some(s => { const v = s.trim().toUpperCase(); return v === 'G1' || v === 'G2' })
        return { date: e.date, autoLabel: isPostcall ? 'Postcall' as const : null }
      })
  }, [parseResult, schedules])

  const unresolvedXDates = useMemo(
    () => xEntries.filter(x => x.autoLabel === null).map(x => x.date),
    [xEntries],
  )
  const allXResolved = unresolvedXDates.every(d => xResolutions[d])

  // Returns the final label to store/display for an entry (resolves X)
  function resolvedShift(e: { date: string; shift: string }): string {
    if (e.shift.trim().toUpperCase() !== 'X') return e.shift
    const xe = xEntries.find(x => x.date === e.date)
    return xe?.autoLabel ?? xResolutions[e.date] ?? e.shift
  }

  const toggleWeekend = (key: string) => {
    setActiveWeekends(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const reset = () => {
    setPasteText(''); setParseResult(null); setActiveWeekends(new Set())
    setConflicts([]); setPendingEntries([]); setIsDuplicate(false); setXResolutions({})
  }

  const doSave = async (entries: ShiftEntry[], rejectedDates: string[]) => {
    if (saving) return
    setSaving(true)
    try {
      const finalEntries = entries.filter(e => !rejectedDates.includes(e.date))
      await saveSchedule({
        id: genId(),
        filename: `Grid Paste — ${MONTH_ABBREVS[month - 1]} ${year}`,
        uploadDate: new Date().toISOString(),
        entries: finalEntries,
      })
      setSaved(true)
      setShowConflictModal(false)
      reset()
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => {
    if (!parseResult?.entries.length || parseResult.error || saving) return

    // Resolve X entries to their final labels before storing
    const newEntries: ShiftEntry[] = parseResult.entries.map(e => ({
      date: e.date, shiftTypes: [resolvedShift(e)],
    }))

    // Build effective existing map (last schedule wins per date, matching uploadedShift logic)
    const existingMap = new Map<string, string[]>()
    const sorted = [...schedules]
      .filter(s => s.id !== 'manual_shifts')
      .sort((a, b) => a.uploadDate.localeCompare(b.uploadDate))
    for (const sched of sorted)
      for (const entry of sched.entries)
        existingMap.set(entry.date, entry.shiftTypes)

    // Detect conflicts (existing date with different shift)
    const detected: ConflictEntry[] = []
    for (const entry of newEntries) {
      const current = existingMap.get(entry.date)
      if (current && [...current].sort().join(',') !== [...entry.shiftTypes].sort().join(',')) {
        detected.push({ date: entry.date, currentShifts: current, newShifts: entry.shiftTypes, accept: true })
      }
    }

    // Detect pure duplicate (all new entries match existing exactly, nothing net-new)
    const allMatch = newEntries.every(e => {
      const cur = existingMap.get(e.date)
      return cur && [...e.shiftTypes].sort().join(',') === [...cur].sort().join(',')
    })
    const hasNewDates = newEntries.some(e => !existingMap.has(e.date))

    setPendingEntries(newEntries)

    if (allMatch && !hasNewDates && detected.length === 0) {
      setIsDuplicate(true)
      return
    }

    if (detected.length > 0) {
      setConflicts(detected)
      setShowConflictModal(true)
    } else {
      doSave(newEntries, [])
    }
  }

  const handleApplyConflicts = async () => {
    const rejected = conflicts.filter(c => !c.accept).map(c => c.date)
    await doSave(pendingEntries, rejected)
  }

  const monthStr = `${year}-${String(month).padStart(2, '0')}`

  return (
    <div className="space-y-6">
      {saved && (
        <div className="bg-emerald-900/30 border border-emerald-800 rounded-lg px-4 py-3 text-sm text-emerald-400">
          Schedule saved — {MONTH_ABBREVS[month - 1]} {year} entries imported.
        </div>
      )}

      {isDuplicate && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg px-4 py-4">
          <div className="flex items-start gap-3">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-300 mb-1">Duplicate schedule detected</p>
              <p className="text-xs text-amber-400/80 mb-3">
                All {pendingEntries.length} entries are identical to shifts already imported. No new or changed dates were found.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setIsDuplicate(false); doSave(pendingEntries, []) }}
                  disabled={saving}
                  className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white text-xs rounded-md font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Import Anyway
                </button>
                <button
                  onClick={() => { setIsDuplicate(false); reset() }}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 1 — Month */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Step 1 — Select Month</p>
        <MonthPicker
          value={monthStr}
          onChange={v => {
            if (!v) return
            const [y, m] = v.split('-').map(Number)
            setYear(y); setMonth(m)
            reset(); setSaved(false)
          }}
        />
      </div>

      {/* Step 2 — Active weekends */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Step 2 — Active Weekends</p>
        <p className="text-xs text-gray-600 mb-3">
          Toggle each weekend block that appears in the schedule grid, including "\" (blocked) entries.
        </p>
        {weekendPairs.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {weekendPairs.map(pair => {
              const key = pair.dates[0]
              const isActive = activeWeekends.has(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleWeekend(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    isActive
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                  }`}
                >
                  {MONTH_ABBREVS[month - 1]} {pair.label}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-600">No weekends in this month.</p>
        )}
        <p className="text-xs text-gray-600 mt-2">
          Expected entries: <span className={`font-mono ${parseResult?.error ? 'text-red-400' : 'text-gray-400'}`}>{dayList.length}</span>
        </p>
      </div>

      {/* Step 3 — Paste */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Step 3 — Paste Your Row</p>
        <textarea
          value={pasteText}
          onChange={e => { setPasteText(e.target.value); setSaved(false) }}
          placeholder="Paste the row from the schedule grid here…"
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
        {pasteText.trim() && (
          <div className="mt-1.5">
            {parseResult?.error ? (
              <p className="text-xs text-red-400">{parseResult.error}</p>
            ) : parseResult && parseResult.entries.length > 0 ? (
              <p className="text-xs text-emerald-400">✓ {parseResult.entries.length} shift entries parsed</p>
            ) : null}
          </div>
        )}
      </div>

      {/* Preview table */}
      {parseResult && !parseResult.error && parseResult.entries.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Preview</p>
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                <tr>
                  {['Date', 'Day', 'Shift'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parseResult.entries.map(e => {
                  const dow = new Date(e.date + 'T12:00:00').getDay()
                  const dowStr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]
                  const label = resolvedShift(e)
                  const isUnresolved = e.shift.trim().toUpperCase() === 'X' && label === e.shift
                  return (
                    <tr key={e.date} className="border-b border-gray-800/50">
                      <td className="px-4 py-2 text-xs text-gray-300">{formatDateFull(e.date)}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{dowStr}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isUnresolved ? 'bg-amber-900/40 text-amber-400' : shiftBadgeClass(label)}`}>{label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* X resolution — shown when any X entries need a label */}
      {unresolvedXDates.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Clarify these "X" days to proceed</p>
          </div>
          <div className="space-y-2">
            {unresolvedXDates.map(date => (
              <div key={date} className="flex items-center justify-between bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
                <span className="text-xs text-amber-200">{formatDateFull(date)}</span>
                <div className="flex items-center gap-1">
                  {(['H', 'V', 'Postcall'] as const).map(opt => (
                    <button
                      key={opt}
                      onClick={() => setXResolutions(prev => ({ ...prev, [date]: opt }))}
                      className={`px-2 py-0.5 text-xs rounded transition-colors ${
                        xResolutions[date] === opt
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <button
          onClick={handleSave}
          disabled={!parseResult?.entries.length || !!parseResult?.error || saving || !allXResolved}
          className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : `Save ${MONTH_ABBREVS[month - 1]} ${year} Schedule`}
        </button>
      </div>

      {/* Conflict modal */}
      {showConflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
            <h3 className="text-base font-semibold text-gray-100 mb-1">Resolve Conflicts</h3>
            <p className="text-xs text-gray-500 mb-4">
              {conflicts.length} date{conflicts.length !== 1 ? 's' : ''} already have shift assignments. Choose which to overwrite.
            </p>
            <div className="flex-1 overflow-y-auto mb-4">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="border-b border-gray-800">
                    {['Date', 'Current', 'New', 'Accept'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((c, i) => (
                    <tr key={c.date} className="border-b border-gray-800">
                      <td className="px-3 py-2.5 text-gray-300">{formatDateFull(c.date)}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">{c.currentShifts.join(', ')}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs bg-indigo-900/40 text-indigo-400 px-2 py-0.5 rounded">{c.newShifts.join(', ')}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={c.accept}
                          onChange={e => setConflicts(prev => prev.map((x, j) => j === i ? { ...x, accept: e.target.checked } : x))}
                          className="accent-indigo-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 border-t border-gray-800 pt-4">
              <button onClick={() => setConflicts(p => p.map(c => ({ ...c, accept: true })))} className="text-xs text-indigo-400 hover:text-indigo-300">Accept all</button>
              <button onClick={() => setConflicts(p => p.map(c => ({ ...c, accept: false })))} className="text-xs text-gray-500 hover:text-gray-300">Reject all</button>
              <div className="flex-1" />
              <button onClick={() => setShowConflictModal(false)} className="px-4 py-2 text-gray-400 hover:text-gray-200 text-sm">Cancel</button>
              <button onClick={handleApplyConflicts} className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors">
                Apply Selected Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Upload page ─────────────────────────────────────────────────────────

export default function Upload() {
  const [tab, setTab] = useState<'pcr' | 'schedule' | 'paste' | 'stipend'>('pcr')

  const tabCls = (t: typeof tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? 'border-indigo-500 text-indigo-400'
        : 'border-transparent text-gray-500 hover:text-gray-300'
    }`

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-100 mb-6">Upload Data</h2>

      <div className="flex border-b border-gray-800 mb-6">
        <button className={tabCls('pcr')} onClick={() => setTab('pcr')}>PCR Report</button>
        <button className={tabCls('schedule')} onClick={() => setTab('schedule')}>Schedule Upload</button>
        <button className={tabCls('paste')} onClick={() => setTab('paste')}>Grid Paste</button>
        <button className={tabCls('stipend')} onClick={() => setTab('stipend')}>Stipend Rates</button>
      </div>

      {tab === 'pcr' && <PcrUploadTab />}
      {tab === 'schedule' && <ScheduleUploadTab />}
      {tab === 'paste' && <SchedulePasteTab />}
      {tab === 'stipend' && <StipendRatesTab />}
    </div>
  )
}
