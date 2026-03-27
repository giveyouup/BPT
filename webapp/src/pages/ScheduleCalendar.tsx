import { useState, useRef, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { useData } from '../context/DataContext'
import {
  shiftBadgeClass, isOffDayShift, resolveShiftAlias, computeFederalHolidays,
  isVacationShift, isHolidayOffShift, isPostcallShift,
} from '../utils/shiftUtils'
import { getMonthName, formatDateFull, lastDayOfMonth } from '../utils/dateUtils'
import { generateICS, downloadICS } from '../utils/generateICS'
import type { ICSEvent } from '../utils/generateICS'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function buildCalendarCells(year: number, month: number): string[] {
  const firstDow = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const prevYear  = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const daysInPrev = new Date(prevYear, prevMonth, 0).getDate()
  const nextYear  = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const cells: string[] = []
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysInPrev - i
    cells.push(`${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  let nd = 1
  while (cells.length % 7 !== 0) {
    cells.push(`${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nd).padStart(2, '0')}`)
    nd++
  }
  return cells
}

function ShiftStatCard({
  label, count, sub, accent = 'text-gray-100', large = false,
  borderClass = 'border-gray-800', bgClass = 'bg-gray-900',
}: {
  label: string
  count: number
  sub?: string
  accent?: string
  large?: boolean
  borderClass?: string
  bgClass?: string
}) {
  return (
    <div className={`${bgClass} rounded-xl border ${borderClass} px-4 py-3`}>
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`font-bold ${accent} ${large ? 'text-3xl' : 'text-2xl'}`}>{count}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{sub}</p>}
    </div>
  )
}

export default function ScheduleCalendar() {
  const { schedules, saveManualShift, deleteManualShift, settings } = useData()
  const location = useLocation()
  const navState = location.state as { year?: number; month?: number } | null

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const [year, setYear] = useState(navState?.year ?? now.getFullYear())
  const [month, setMonth] = useState(navState?.month ?? now.getMonth() + 1)
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month')
  const [summaryYear, setSummaryYear] = useState(now.getFullYear())
  const [summaryView, setSummaryView] = useState<'cards' | 'chart'>('cards')
  const [chartGroup, setChartGroup] = useState<'G' | 'Special' | 'FS' | 'Other'>('G')
  const [popover, setPopover] = useState<{ date: string; input: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── ICS export ────────────────────────────────────────────────────────────
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportStart, setExportStart] = useState('')
  const [exportEnd,   setExportEnd]   = useState('')
  const [xResolutions, setXResolutions] = useState<Record<string, 'H' | 'V' | 'Postcall'>>({})

  const openExportModal = () => {
    const pad = (n: number) => String(n).padStart(2, '0')
    setExportStart(`${year}-${pad(month)}-01`)
    setExportEnd(lastDayOfMonth(year, month))
    setXResolutions({})
    setShowExportModal(true)
  }

  useEffect(() => {
    if (popover) setTimeout(() => inputRef.current?.focus(), 0)
  }, [popover?.date])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopover(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  // Derive manual overrides from the pseudo-schedule injected by DataContext
  const manualOverrides: Record<string, string[]> = {}
  const manualSched = schedules.find(s => s.id === 'manual_shifts')
  if (manualSched) {
    for (const entry of manualSched.entries) manualOverrides[entry.date] = entry.shiftTypes
  }

  function uploadedShift(date: string): string[] {
    let result: string[] = []
    for (const sched of schedules) {
      if (sched.id === 'manual_shifts') continue
      const entry = sched.entries.find(e => e.date === date)
      if (entry) result = entry.shiftTypes
    }
    return result
  }

  function effectiveShift(date: string): string[] {
    return manualOverrides[date] ?? uploadedShift(date)
  }

  /** Returns the display label for a shift on a given date.
   *  X following a G1/G2 day is shown as "Postcall". */
  function displayShift(date: string, shift: string): string {
    if (shift.trim().toUpperCase() !== 'X') return shift
    const [y, m, d] = date.split('-').map(Number)
    const prev = new Date(y, m - 1, d - 1)
    const prevStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
    const hasPrevG1G2 = effectiveShift(prevStr).some(s => { const v = s.trim().toUpperCase(); return v === 'G1' || v === 'G2' })
    return hasPrevG1G2 ? 'Postcall' : shift
  }

  async function handleSave() {
    if (!popover) return
    const shiftTypes = popover.input.trim().split(/[\s,/]+/).map(s => s.trim()).filter(Boolean)
    await saveManualShift(popover.date, shiftTypes)
    setPopover(null)
  }

  async function handleRevert() {
    if (!popover) return
    await deleteManualShift(popover.date)
    setPopover(null)
  }

  // ── Year range for summary dropdown ──────────────────────────────────────
  const summaryYears = useMemo(() => {
    const years = new Set<number>()
    years.add(now.getFullYear())
    for (const sched of schedules) {
      for (const entry of sched.entries) {
        const y = parseInt(entry.date.slice(0, 4))
        if (!isNaN(y)) years.add(y)
      }
    }
    return [...years].sort((a, b) => b - a)
  }, [schedules])

  // ── Year-wide shift summary ───────────────────────────────────────────────
  const yearSummary = useMemo(() => {
    const prefix = `${summaryYear}-`
    const holidayList: string[] = settings.holidays[summaryYear] ?? computeFederalHolidays(summaryYear)

    const manualS = schedules.find(s => s.id === 'manual_shifts')
    const ov: Record<string, string[]> = {}
    if (manualS) for (const e of manualS.entries) ov[e.date] = e.shiftTypes

    const eff = (date: string): string[] => {
      if (ov[date] !== undefined) return ov[date]
      let result: string[] = []
      for (const sched of schedules) {
        if (sched.id === 'manual_shifts') continue
        const entry = sched.entries.find(e => e.date === date)
        if (entry) result = entry.shiftTypes
      }
      return result
    }

    const allDates = new Set<string>()
    for (const sched of schedules)
      for (const entry of sched.entries)
        if (entry.date.startsWith(prefix)) allDates.add(entry.date)

    let totalWorking = 0, weekdayWorking = 0, weekendWorking = 0, holidayWorking = 0
    let daysOff = 0, vacation = 0, holidayOff = 0, postcall = 0
    const byShift = new Map<string, { total: number; wd: number; we: number }>()

    for (const date of allDates) {
      const rawShifts = eff(date)
      if (rawShifts.length === 0) continue

      // Resolve X → Postcall when the previous calendar day had G1/G2
      const shifts = rawShifts.map(s => {
        if (s.trim().toUpperCase() !== 'X') return s
        const [y, m, d] = date.split('-').map(Number)
        const prev = new Date(y, m - 1, d - 1)
        const prevStr = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
        return eff(prevStr).some(p => { const v = p.trim().toUpperCase(); return v === 'G1' || v === 'G2' })
          ? 'Postcall'
          : s
      })

      const allOff = shifts.every(s => isOffDayShift(s))
      const [y, m, d] = date.split('-').map(Number)
      const dow = new Date(y, m - 1, d).getDay()
      const isWeekendDay = dow === 0 || dow === 6
      const isOnHoliday = holidayList.includes(date)
      const isWE = isWeekendDay || isOnHoliday

      if (allOff) {
        daysOff++
        if (shifts.some(isVacationShift)) vacation++
        if (shifts.some(isHolidayOffShift)) holidayOff++
        if (shifts.some(isPostcallShift)) postcall++
      } else {
        totalWorking++
        if (isOnHoliday) holidayWorking++
        else if (isWeekendDay) weekendWorking++
        else weekdayWorking++

        for (const raw of shifts) {
          if (isOffDayShift(raw)) continue
          const canonical = resolveShiftAlias(raw.toUpperCase())
          if (!byShift.has(canonical)) byShift.set(canonical, { total: 0, wd: 0, we: 0 })
          const e = byShift.get(canonical)!
          e.total++
          if (isWE) e.we++; else e.wd++
        }
      }
    }

    return { totalWorking, weekdayWorking, weekendWorking, holidayWorking, daysOff, vacation, holidayOff, postcall, byShift }
  }, [summaryYear, schedules, settings])

  // Group shift entries for display rows
  const shiftEntries = [...yearSummary.byShift.entries()]
  const g1g2       = shiftEntries.filter(([s]) => /^G[12]$/.test(s)).sort(([a], [b]) => a.localeCompare(b))
  const apsEntries = shiftEntries.filter(([s]) => s === 'APS')
  const gHigh      = shiftEntries
    .filter(([s]) => { const m = s.match(/^G(\d+)$/); return !!m && parseInt(m[1]) >= 3 })
    .sort(([a], [b]) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
  const nirShifts  = shiftEntries.filter(([s]) => s === 'NIR')
  const brShifts   = shiftEntries.filter(([s]) => s === 'BR')
  const rocShifts  = shiftEntries.filter(([s]) => s === 'ROC')
  const ccShifts   = shiftEntries.filter(([s]) => s === 'CC')
  const giShifts   = shiftEntries.filter(([s]) => s === 'GI')
  const endoShifts = shiftEntries.filter(([s]) => s === 'ENDO')
  const fsShifts   = shiftEntries.filter(([s]) => s.startsWith('FS')).sort(([a], [b]) => a.localeCompare(b))

  const specialShifts = [...nirShifts, ...brShifts, ...rocShifts, ...ccShifts, ...giShifts, ...endoShifts]
  const knownSet = new Set([...g1g2, ...apsEntries, ...gHigh, ...specialShifts, ...fsShifts].map(([s]) => s))
  const otherShifts = shiftEntries.filter(([s]) => !knownSet.has(s)).sort(([a], [b]) => a.localeCompare(b))

  // FS aggregate
  const fsTotal = fsShifts.reduce((acc, [, d]) => acc + d.total, 0)
  const fsWd    = fsShifts.reduce((acc, [, d]) => acc + d.wd, 0)
  const fsWe    = fsShifts.reduce((acc, [, d]) => acc + d.we, 0)

  const wdWeStr = (wd: number, we: number) => `${wd} WD · ${we} WE`

  const chartData = useMemo(() => ({
    G: [
      ...g1g2.map(([s, d]) => ({ shift: s, Weekday: d.wd, Weekend: d.we })),
      ...gHigh.map(([s, d]) => ({ shift: s, Weekday: d.wd, Weekend: d.we })),
    ],
    Special: specialShifts.map(([s, d]) => ({ shift: s, Weekday: d.wd, Weekend: d.we })),
    FS: fsShifts.map(([s, d]) => ({ shift: s, Weekday: d.wd, Weekend: d.we })),
    Other: otherShifts.map(([s, d]) => ({ shift: s, Weekday: d.wd, Weekend: d.we })),
  }), [yearSummary]) // eslint-disable-line react-hooks/exhaustive-deps

  const chartTabs = useMemo(() => ([
    { key: 'G'       as const, label: 'G Shifts', available: [...g1g2, ...apsEntries, ...gHigh].length > 0 },
    { key: 'Special' as const, label: 'Special',  available: specialShifts.length > 0 },
    { key: 'FS'      as const, label: 'FS',       available: fsShifts.length > 0 },
    { key: 'Other'   as const, label: 'Other',    available: otherShifts.length > 0 },
  ].filter(t => t.available)), [yearSummary]) // eslint-disable-line react-hooks/exhaustive-deps

  const cells = buildCalendarCells(year, month)

  // ── Export entries (recomputed when modal open or date range changes) ──────
  const exportEntries = useMemo(() => {
    if (!showExportModal || !exportStart || !exportEnd || exportStart > exportEnd) return []
    const result: { date: string; rawShift: string; autoLabel: string | null }[] = []
    const cur = new Date(exportStart + 'T12:00:00')
    const end = new Date(exportEnd + 'T12:00:00')
    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10)
      for (const shift of effectiveShift(dateStr)) {
        const u = shift.trim().toUpperCase()
        if (u === '\\') continue
        if (u === 'X') {
          const prev = new Date(cur); prev.setDate(prev.getDate() - 1)
          const prevStr = prev.toISOString().slice(0, 10)
          const hasPrevG1G2 = effectiveShift(prevStr).some(s => { const v = s.trim().toUpperCase(); return v === 'G1' || v === 'G2' })
          result.push({ date: dateStr, rawShift: shift, autoLabel: hasPrevG1G2 ? 'Postcall' : null })
        } else {
          result.push({ date: dateStr, rawShift: shift, autoLabel: shift })
        }
      }
      cur.setDate(cur.getDate() + 1)
    }
    return result
  }, [showExportModal, exportStart, exportEnd, schedules]) // eslint-disable-line react-hooks/exhaustive-deps

  const unresolvedXDates = useMemo(
    () => exportEntries.filter(e => e.autoLabel === null).map(e => e.date),
    [exportEntries],
  )

  const allResolved = unresolvedXDates.every(d => xResolutions[d])

  const handleExportDownload = () => {
    const events: ICSEvent[] = exportEntries.map(e => ({
      date: e.date,
      title: e.autoLabel ?? xResolutions[e.date] ?? e.rawShift,
    }))
    const filename = exportStart === exportEnd
      ? `schedule-${exportStart}.ics`
      : `schedule-${exportStart}-to-${exportEnd}.ics`
    downloadICS(filename, generateICS(events))
    setShowExportModal(false)
  }

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6">
        {/* Row 1: title + year nav + Today + view toggle */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="text-2xl font-bold text-gray-100">Schedule</h2>
          <div className="flex items-center gap-1 ml-4">
            <button
              onClick={() => setYear(y => y - 1)}
              className="p-1.5 rounded-md text-gray-400 hover:bg-gray-800 hover:text-gray-100 transition-colors"
              aria-label="Previous year"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-semibold text-gray-200 w-12 text-center">{year}</span>
            <button
              onClick={() => setYear(y => y + 1)}
              className="p-1.5 rounded-md text-gray-400 hover:bg-gray-800 hover:text-gray-100 transition-colors"
              aria-label="Next year"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button
              onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1) }}
              className="ml-2 px-2.5 py-1 text-xs rounded-md text-gray-500 hover:bg-gray-800 hover:text-gray-200 border border-gray-800 transition-colors"
            >
              Today
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={openExportModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export .ics
            </button>
            <div className="flex items-center gap-0.5 bg-gray-900 border border-gray-800 rounded-lg p-0.5">
              {(['month', 'year'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setViewMode(v)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize ${
                    viewMode === v ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: month pills — only in month view */}
        {viewMode === 'month' && (
          <div className="flex gap-1 flex-wrap">
            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((abbr, i) => {
              const m = i + 1
              const isActive = m === month
              return (
                <button
                  key={m}
                  onClick={() => setMonth(m)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-500 hover:bg-gray-800 hover:text-gray-200'
                  }`}
                >
                  {abbr}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Month view ── */}
      {viewMode === 'month' && (
        <>
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-visible" onClick={() => setPopover(null)}>
            <div className="grid grid-cols-7 border-b border-gray-800">
              {DOW.map(d => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((date, i) => {
                const col = i % 7
                const row = Math.floor(i / 7)
                const totalRows = Math.floor(cells.length / 7)
                const isLastRow = row === totalRows - 1
                const isLastCol = col === 6
                const currentMonthPrefix = `${year}-${String(month).padStart(2, '0')}-`
                const isAdjacent = !date.startsWith(currentMonthPrefix)

                const shifts = effectiveShift(date)
                const isOverride = !!manualOverrides[date]
                const isToday = date === todayStr
                const isOpen = popover?.date === date
                const isOffDay = shifts.length > 0 && shifts.every(isOffDayShift)
                const dayNum = parseInt(date.split('-')[2])
                const uploaded = uploadedShift(date)
                const popoverY = row >= totalRows - 2 ? 'bottom-full mb-1' : 'top-full mt-1'
                const popoverX = col >= 5 ? 'right-0' : 'left-0'

                if (isAdjacent) {
                  return (
                    <div
                      key={date}
                      className={`min-h-[72px] p-1.5 opacity-35
                        ${isLastCol ? '' : 'border-r border-gray-800'}
                        ${isLastRow ? '' : 'border-b border-gray-800'}
                        bg-gray-950/30
                      `}
                    >
                      <div className="mb-1">
                        <span className="text-xs font-semibold text-gray-600">{dayNum}</span>
                      </div>
                      <div className="flex flex-wrap gap-0.5">
                        {shifts.map(st => {
                          const label = displayShift(date, st)
                          return <span key={st} className={`text-[10px] font-mono px-1 py-0.5 rounded leading-tight break-all ${shiftBadgeClass(label)}`}>{label}</span>
                        })}
                      </div>
                    </div>
                  )
                }

                return (
                  <div
                    key={date}
                    className={`relative min-h-[72px] p-1.5 cursor-pointer transition-colors
                      ${isLastCol ? '' : 'border-r border-gray-800'}
                      ${isLastRow ? '' : 'border-b border-gray-800'}
                      ${isOpen ? 'bg-indigo-950/50 ring-1 ring-inset ring-indigo-500/40 z-10' : isOffDay ? 'bg-emerald-950/30 hover:bg-emerald-950/50' : 'hover:bg-gray-800/50'}
                      ${isOverride && !isOpen ? 'ring-1 ring-inset ring-amber-500/50' : ''}
                    `}
                    onClick={e => {
                      e.stopPropagation()
                      if (isOpen) { setPopover(null); return }
                      setPopover({ date, input: effectiveShift(date).join(' ') })
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-semibold w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-indigo-600 text-white' : 'text-gray-500'}`}>
                        {dayNum}
                      </span>
                      {isOverride && (
                        <span title="Manual override" className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 ring-1 ring-amber-300/30" />
                      )}
                    </div>
                    <div className="flex flex-wrap gap-0.5">
                      {shifts.map(st => {
                        const label = displayShift(date, st)
                        return <span key={st} className={`text-[10px] font-mono px-1 py-0.5 rounded leading-tight break-all ${shiftBadgeClass(label)}`}>{label}</span>
                      })}
                    </div>
                    {isOpen && (
                      <div
                        className={`absolute ${popoverY} ${popoverX} z-50 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-3`}
                        onClick={e => e.stopPropagation()}
                      >
                        <p className="text-xs font-semibold text-gray-200 mb-2">{formatDateFull(date)}</p>
                        <p className="text-[10px] text-gray-600 mb-2">
                          {isOverride
                            ? `Uploaded: ${uploaded.join(' ') || '(none)'}`
                            : uploaded.length > 0
                              ? `From schedule: ${uploaded.join(' ')}`
                              : 'No uploaded schedule for this day'}
                        </p>
                        <input
                          ref={inputRef}
                          type="text"
                          value={popover.input}
                          onChange={e => setPopover(p => p ? { ...p, input: e.target.value } : null)}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleSave() }}
                          placeholder="Leave blank to mark as no shift"
                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mb-2.5"
                        />
                        <div className="flex items-center gap-1.5">
                          <button onClick={handleSave} className="flex-1 px-2 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 transition-colors font-medium">Save</button>
                          {isOverride && (
                            <button onClick={handleRevert} className="px-2 py-1.5 text-xs text-amber-400 hover:text-amber-300 border border-gray-700 rounded-md transition-colors" title="Remove override and restore uploaded schedule">Revert</button>
                          )}
                          <button onClick={() => setPopover(null)} className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex items-center gap-5 mt-3 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Manual override
            </span>
            <span className="text-gray-700">Click any day to edit · Multiple shifts space-separated · Leave blank and save to mark as no shift · Revert removes the override entirely</span>
          </div>
        </>
      )}

      {/* ── Year view ── */}
      {viewMode === 'year' && (
        <>
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            onClick={() => setPopover(null)}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
              const miniCells = buildCalendarCells(year, m)
              const totalRows = Math.floor(miniCells.length / 7)
              const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]

              return (
                <div key={m} className="bg-gray-900 rounded-xl border border-gray-800 overflow-visible">
                  {/* Month name + jump-to-month-view link */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
                    <span className="text-xs font-semibold text-gray-300">{monthAbbr}</span>
                    <button
                      onClick={e => { e.stopPropagation(); setMonth(m); setViewMode('month') }}
                      className="text-[10px] text-indigo-500 hover:text-indigo-300 transition-colors"
                    >
                      Details →
                    </button>
                  </div>
                  {/* DOW headers */}
                  <div className="grid grid-cols-7 border-b border-gray-800">
                    {DOW.map(d => (
                      <div key={d} className="py-1 text-center text-[9px] font-semibold text-gray-700 uppercase">{d[0]}</div>
                    ))}
                  </div>
                  {/* Day cells */}
                  <div className="grid grid-cols-7">
                    {miniCells.map((date, i) => {
                      const col = i % 7
                      const row = Math.floor(i / 7)
                      const isLastRow = row === totalRows - 1
                      const isLastCol = col === 6

                      if (!date) {
                        return (
                          <div
                            key={`empty-${i}`}
                            className={`min-h-[38px] bg-gray-950/30 ${isLastCol ? '' : 'border-r border-gray-800'} ${isLastRow ? '' : 'border-b border-gray-800'}`}
                          />
                        )
                      }

                      const shifts = effectiveShift(date)
                      const isOverride = !!manualOverrides[date]
                      const isToday = date === todayStr
                      const isOpen = popover?.date === date
                      const isOffDay = shifts.length > 0 && shifts.every(isOffDayShift)
                      const dayNum = parseInt(date.split('-')[2])
                      const uploaded = uploadedShift(date)
                      const popoverY = row >= totalRows - 2 ? 'bottom-full mb-1' : 'top-full mt-1'
                      const popoverX = col >= 4 ? 'right-0' : 'left-0'

                      return (
                        <div
                          key={date}
                          className={`relative min-h-[38px] p-0.5 cursor-pointer transition-colors
                            ${isLastCol ? '' : 'border-r border-gray-800'}
                            ${isLastRow ? '' : 'border-b border-gray-800'}
                            ${isOpen ? 'bg-indigo-950/50 ring-1 ring-inset ring-indigo-500/40 z-10' : isOffDay ? 'bg-emerald-950/30 hover:bg-emerald-950/50' : 'hover:bg-gray-800/50'}
                            ${isOverride && !isOpen ? 'ring-1 ring-inset ring-amber-500/50' : ''}
                          `}
                          onClick={e => {
                            e.stopPropagation()
                            if (isOpen) { setPopover(null); return }
                            setPopover({ date, input: effectiveShift(date).join(' ') })
                          }}
                        >
                          <div className="flex items-center justify-between mb-0.5">
                            <span className={`text-[9px] font-semibold w-4 h-4 flex items-center justify-center rounded-full leading-none ${isToday ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}>
                              {dayNum}
                            </span>
                            {isOverride && <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />}
                          </div>
                          <div className="flex flex-wrap gap-px">
                            {shifts.map(st => {
                              const label = displayShift(date, st)
                              return <span key={st} className={`text-[8px] font-mono px-0.5 rounded leading-tight break-all ${shiftBadgeClass(label)}`}>{label}</span>
                            })}
                          </div>
                          {isOpen && (
                            <div
                              className={`absolute ${popoverY} ${popoverX} z-50 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-3`}
                              onClick={e => e.stopPropagation()}
                            >
                              <p className="text-xs font-semibold text-gray-200 mb-2">{formatDateFull(date)}</p>
                              <p className="text-[10px] text-gray-600 mb-2">
                                {isOverride
                                  ? `Uploaded: ${uploaded.join(' ') || '(none)'}`
                                  : uploaded.length > 0
                                    ? `From schedule: ${uploaded.join(' ')}`
                                    : 'No uploaded schedule for this day'}
                              </p>
                              <input
                                ref={inputRef}
                                type="text"
                                value={popover.input}
                                onChange={e => setPopover(p => p ? { ...p, input: e.target.value } : null)}
                                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleSave() }}
                                placeholder="Leave blank to mark as no shift"
                                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mb-2.5"
                              />
                              <div className="flex items-center gap-1.5">
                                <button onClick={handleSave} className="flex-1 px-2 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 transition-colors font-medium">Save</button>
                                {isOverride && (
                                  <button onClick={handleRevert} className="px-2 py-1.5 text-xs text-amber-400 hover:text-amber-300 border border-gray-700 rounded-md transition-colors" title="Remove override and restore uploaded schedule">Revert</button>
                                )}
                                <button onClick={() => setPopover(null)} className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-5 mt-3 text-xs text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Manual override
            </span>
            <span className="text-gray-700">Click any day to edit · Click Details → to jump to that month</span>
          </div>
        </>
      )}

      {/* ── Shift Summary ──────────────────────────────────────────────────── */}
      <div className="mt-10 pt-8 border-t border-gray-800">
        <div className="max-w-4xl">
          {/* Section header with year dropdown + view toggle */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Shift Summary
            </h3>
            <select
              value={summaryYear}
              onChange={e => setSummaryYear(Number(e.target.value))}
              className="bg-gray-900 border border-gray-700 text-gray-300 text-xs rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {summaryYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-0.5 bg-gray-900 border border-gray-800 rounded-lg p-0.5">
              {(['cards', 'chart'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setSummaryView(v)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    summaryView === v
                      ? 'bg-gray-700 text-gray-100'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {v === 'cards' ? 'Cards' : 'Chart'}
                </button>
              ))}
            </div>
          </div>

          {/* Row 1: Summary totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
            <ShiftStatCard
              label="Total Shifts"
              count={yearSummary.totalWorking}
              accent="text-indigo-400"
              borderClass="border-indigo-500/30"
              bgClass="bg-indigo-950/20"
              large
            />
            <ShiftStatCard
              label="Weekday"
              count={yearSummary.weekdayWorking}
              accent="text-gray-200"
              large
            />
            <ShiftStatCard
              label="Weekend / Holiday"
              count={yearSummary.weekendWorking + yearSummary.holidayWorking}
              accent="text-rose-400"
              large
              sub={[
                yearSummary.weekendWorking > 0 ? `${yearSummary.weekendWorking} weekend` : '',
                yearSummary.holidayWorking > 0 ? `${yearSummary.holidayWorking} holiday` : '',
              ].filter(Boolean).join(' · ') || undefined}
            />
            <ShiftStatCard
              label="Days Off"
              count={yearSummary.daysOff}
              accent="text-gray-500"
              large
              sub={[
                yearSummary.vacation > 0    ? `${yearSummary.vacation} V`        : '',
                yearSummary.postcall > 0    ? `${yearSummary.postcall} postcall` : '',
                yearSummary.holidayOff > 0  ? `${yearSummary.holidayOff} H`      : '',
              ].filter(Boolean).join(' · ') || undefined}
            />
          </div>

          {/* Distribution bar */}
          {yearSummary.totalWorking > 0 && (() => {
            const segments = [
              { label: 'G1/G2',   count: g1g2.reduce((s, [, d]) => s + d.total, 0),          color: 'bg-rose-500' },
              { label: 'APS',     count: apsEntries.reduce((s, [, d]) => s + d.total, 0),     color: 'bg-amber-500' },
              { label: 'G3+',     count: gHigh.reduce((s, [, d]) => s + d.total, 0),          color: 'bg-rose-300' },
              { label: 'Special', count: specialShifts.reduce((s, [, d]) => s + d.total, 0),  color: 'bg-indigo-400' },
              { label: 'FS',      count: fsTotal,                                              color: 'bg-teal-400' },
              { label: 'Other',   count: otherShifts.reduce((s, [, d]) => s + d.total, 0),    color: 'bg-gray-400' },
              { label: 'Days Off', count: yearSummary.daysOff,                                 color: 'bg-gray-700' },
            ].filter(s => s.count > 0)
            const total = segments.reduce((s, seg) => s + seg.count, 0)
            return (
              <div className="mt-4 mb-2">
                <div className="flex rounded-md overflow-hidden h-2.5">
                  {segments.map(seg => (
                    <div
                      key={seg.label}
                      title={`${seg.label}: ${seg.count}`}
                      style={{ width: `${(seg.count / total) * 100}%` }}
                      className={seg.color}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  {segments.map(seg => (
                    <span key={seg.label} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                      <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${seg.color}`} />
                      {seg.label} <span className="text-gray-400 font-medium">{seg.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* ── Chart view ──────────────────────────────────────────────── */}
          {summaryView === 'chart' && chartTabs.length > 0 && (
            <div className="mt-4">
              {/* Group sub-tabs */}
              <div className="flex gap-1 mb-4">
                {chartTabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setChartGroup(tab.key)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      chartGroup === tab.key
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-500 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {chartData[chartGroup]?.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData[chartGroup]} barCategoryGap="35%" margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                    <XAxis
                      dataKey="shift"
                      tick={{ fill: '#9ca3af', fontSize: 11, fontFamily: 'monospace' }}
                      axisLine={false} tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: '#6b7280', fontSize: 11 }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 }}
                      labelStyle={{ color: '#f9fafb', fontWeight: 600, marginBottom: 4 }}
                      itemStyle={{ color: '#d1d5db' }}
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11, color: '#6b7280', paddingTop: 8 }}
                      iconType="square" iconSize={8}
                    />
                    <Bar dataKey="Weekday" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Weekend" stackId="a" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-gray-600 py-8 text-center">No {chartGroup} shift data for {summaryYear}</p>
              )}
            </div>
          )}

          {/* ── Cards view ──────────────────────────────────────────────── */}
          {summaryView === 'cards' && (
            <>

          {/* Row 2: G1, G2, APS */}
          {(g1g2.length > 0 || apsEntries.length > 0) && (
            <>
              <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-wider mt-5 mb-2">Primary Call &amp; APS</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-2">
                {g1g2.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-rose-400"
                    borderClass="border-rose-500/40"
                    bgClass="bg-rose-950/20"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
                {apsEntries.map(([, data]) => (
                  <ShiftStatCard
                    key="APS"
                    label="APS"
                    count={data.total}
                    accent="text-amber-400"
                    borderClass="border-amber-500/40"
                    bgClass="bg-amber-950/20"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
              </div>
            </>
          )}

          {/* Row 3: G3+ */}
          {gHigh.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-wider mt-5 mb-2">Extended Call</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-2">
                {gHigh.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-rose-300"
                    borderClass="border-rose-400/30"
                    bgClass="bg-rose-950/10"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
              </div>
            </>
          )}

          {/* Row 4: Special Shifts — NIR, BR, ROC, CC, GI, Endo */}
          {specialShifts.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-wider mt-5 mb-2">Special Shifts</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-2">
                {nirShifts.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-amber-300"
                    borderClass="border-amber-400/40"
                    bgClass="bg-amber-950/15"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
                {brShifts.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-orange-400"
                    borderClass="border-orange-500/40"
                    bgClass="bg-orange-950/20"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
                {rocShifts.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-cyan-400"
                    borderClass="border-cyan-500/40"
                    bgClass="bg-cyan-950/20"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
                {ccShifts.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-sky-400"
                    borderClass="border-sky-500/40"
                    bgClass="bg-sky-950/20"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
                {giShifts.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-purple-400"
                    borderClass="border-purple-500/40"
                    bgClass="bg-purple-950/20"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
                {endoShifts.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-emerald-400"
                    borderClass="border-emerald-500/40"
                    bgClass="bg-emerald-950/20"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
              </div>
            </>
          )}

          {/* Row 5: FS shifts + other unclassified */}
          {(fsShifts.length > 0 || otherShifts.length > 0) && (
            <>
              <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-wider mt-5 mb-2">
                {fsShifts.length > 0 && otherShifts.length === 0 ? 'FS Shifts' : fsShifts.length > 0 ? 'FS & Other Shifts' : 'Other Shifts'}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {/* FS (All) aggregate — only show if more than one distinct FS type */}
                {fsShifts.length > 1 && (
                  <ShiftStatCard
                    label="FS (All)"
                    count={fsTotal}
                    accent="text-yellow-400"
                    borderClass="border-yellow-500/40"
                    bgClass="bg-yellow-950/20"
                    sub={wdWeStr(fsWd, fsWe)}
                  />
                )}
                {fsShifts.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-yellow-400"
                    borderClass="border-yellow-500/40"
                    bgClass="bg-yellow-950/20"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
                {otherShifts.map(([shift, data]) => (
                  <ShiftStatCard
                    key={shift}
                    label={shift}
                    count={data.total}
                    accent="text-gray-400"
                    sub={wdWeStr(data.wd, data.we)}
                  />
                ))}
              </div>
            </>
          )}
            </>
          )}
        </div>
      </div>

      {/* ── Export .ics modal ── */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowExportModal(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-100">Export Schedule</h3>
              <button onClick={() => setShowExportModal(false)} className="text-gray-600 hover:text-gray-300 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">From</label>
                <input
                  type="date"
                  value={exportStart}
                  onChange={e => { setExportStart(e.target.value); setXResolutions({}) }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1.5">To</label>
                <input
                  type="date"
                  value={exportEnd}
                  onChange={e => { setExportEnd(e.target.value); setXResolutions({}) }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* X resolution */}
            {unresolvedXDates.length > 0 && (
              <div className="mb-5 flex-1 overflow-y-auto">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Resolve "X" days</p>
                <div className="space-y-2">
                  {unresolvedXDates.map(date => (
                    <div key={date} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                      <span className="text-xs text-gray-300">{formatDateFull(date)}</span>
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

            <p className="text-xs text-gray-500 mb-4">
              {exportEntries.length} event{exportEntries.length !== 1 ? 's' : ''} will be exported
            </p>

            <button
              onClick={handleExportDownload}
              disabled={exportEntries.length === 0 || !allResolved}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Download .ics
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
