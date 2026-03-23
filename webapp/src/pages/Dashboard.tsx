import React, { useState, useMemo, useEffect, useRef } from 'react'
import { exportDashboardMonth } from '../utils/exportXlsx'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { computeCalendarMonthWorkingDays, computeCalendarYearStats, projectRemainingDays } from '../utils/calculations'
import type { MonthProjection } from '../utils/calculations'
import {
  formatCurrency, formatHours, formatMonthYear, formatDateShort, getMonthName,
} from '../utils/dateUtils'
import { shiftBadgeClass, isOffDayShift } from '../utils/shiftUtils'
import { getCptCategory } from '../utils/cptLookup'
import type { WorkingDayStats } from '../types'


function weekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const day = date.getDay()
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

interface WeekBucket { key: string; label: string; hours: number; days: number }

function groupByWeek(workingDays: WorkingDayStats[]): WeekBucket[] {
  const map = new Map<string, { hours: number; days: number; min: string; max: string }>()
  for (const day of workingDays) {
    const key = weekStart(day.date)
    if (!map.has(key)) map.set(key, { hours: 0, days: 0, min: day.date, max: day.date })
    const w = map.get(key)!
    w.hours += day.hours
    w.days++
    if (day.date < w.min) w.min = day.date
    if (day.date > w.max) w.max = day.date
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      key,
      label: v.min === v.max ? formatDateShort(v.min) : `${formatDateShort(v.min)} – ${formatDateShort(v.max)}`,
      hours: v.hours,
      days: v.days,
    }))
}


export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { reports, schedules: allSchedules, settings, stipendMappings: allMappings, cptRanges, saveReport, saveManualShift, deleteManualShift } = useData()

  const incomingDate = (location.state as { date?: string } | null)?.date ?? null

  const years = [...new Set(reports.map((r) => r.year))].sort((a, b) => b - a)
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    if (incomingDate) return parseInt(incomingDate.slice(0, 4))
    return years[0] ?? new Date().getFullYear()
  })

  const yearStats = useMemo(
    () => computeCalendarYearStats(selectedYear, reports, allSchedules, settings, allMappings),
    [selectedYear, reports, allSchedules, settings, allMappings]
  )
  const [selectedId, setSelectedId] = useState<string>('')
  const [editingDayDate, setEditingDayDate] = useState<string | null>(null)
  const [dayStipendInput, setDayStipendInput] = useState('')
  const [editingHoursDate, setEditingHoursDate] = useState<string | null>(null)
  const [hoursInput, setHoursInput] = useState('')
  const [hideCompensation, setHideCompensation] = useState(true)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(incomingDate)
  const [shiftPopover, setShiftPopover] = useState<{ date: string; input: string; x: number; y: number } | null>(null)
  const [showProjection, setShowProjection] = useState(false)
  const [projRateInput, setProjRateInput] = useState('')
  const shiftInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (shiftPopover) setTimeout(() => shiftInputRef.current?.focus(), 0)
  }, [shiftPopover?.date])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShiftPopover(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // When navigating here with a pre-selected date, pick the correct month tab
  useEffect(() => {
    if (!incomingDate || yearStats.length === 0) return
    const month = parseInt(incomingDate.slice(5, 7))
    const match = yearStats.find(s => s.month === month)
    if (match) setSelectedId(match.id)
  }, [yearStats, incomingDate])

  // Reset projection when the selected month changes
  useEffect(() => {
    setShowProjection(false)
    setProjRateInput('')
  }, [selectedId])

  const saveDayStipend = async (date: string) => {
    if (!selStats) return
    const report = reports.find((r) => r.id === selStats.id)
    if (!report) return
    const amount = parseFloat(dayStipendInput)
    const dayStipends = { ...report.dayStipends }
    if (!isNaN(amount) && amount > 0) {
      dayStipends[date] = amount
    } else {
      delete dayStipends[date]
    }
    await saveReport({ ...report, dayStipends })
    setEditingDayDate(null)
  }
  const saveHoursOverride = async (date: string) => {
    if (!selStats) return
    const report = reports.find((r) => r.id === selStats.id)
    if (!report) return
    const hours = parseFloat(hoursInput)
    const workingDayOverrides = { ...report.workingDayOverrides }
    if (!isNaN(hours) && hours >= 0) {
      workingDayOverrides[date] = hours
    } else {
      delete workingDayOverrides[date]
    }
    await saveReport({ ...report, workingDayOverrides })
    setEditingHoursDate(null)
  }

  const handleShiftSave = async (date: string) => {
    if (!shiftPopover) return
    const shiftTypes = shiftPopover.input.trim().split(/[\s,/]+/).map(s => s.trim()).filter(Boolean)
    await saveManualShift(date, shiftTypes)
    setShiftPopover(null)
  }

  const handleShiftRevert = async (date: string) => {
    await deleteManualShift(date)
    setShiftPopover(null)
  }

  // Set of dates that have a manual shift override
  const manualOverrideDates = useMemo(() => {
    const manual = allSchedules.find(s => s.id === 'manual_shifts')
    return manual ? new Set(manual.entries.map(e => e.date)) : new Set<string>()
  }, [allSchedules])

  // ── Projection ──────────────────────────────────────────────────────────────
  const priorYearStats = useMemo(
    () => computeCalendarYearStats(selectedYear - 1, reports, allSchedules, settings, allMappings),
    [selectedYear, reports, allSchedules, settings, allMappings]
  )

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8">
        <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-200 mb-2">No reports yet</h2>
        <p className="text-gray-500 mb-6 max-w-sm">
          Upload your first monthly PCR spreadsheet to start tracking your production and compensation.
        </p>
        <button
          onClick={() => navigate('/upload')}
          className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
        >
          Upload First Report
        </button>
      </div>
    )
  }

  const ytdUnits = yearStats.reduce((s, m) => s + m.totalDistributableUnits, 0)
  const ytdCompensation = yearStats.reduce((s, m) => s + m.totalCompensation, 0)
  const ytdHours = yearStats.reduce((s, m) => s + m.totalHours, 0)

  // selStats: prefer selectedId if it's in the selected year, else last month of selected year
  const selStats =
    yearStats.find((s) => s.id === selectedId) ?? yearStats[yearStats.length - 1]
  const effectiveRate = selStats && selStats.totalDistributableUnits > 0
    ? selStats.unitCompensation / selStats.totalDistributableUnits
    : null

  // Aggregate working days for the selected calendar month across ALL reports and schedules
  const monthDays = computeCalendarMonthWorkingDays(selStats.year, selStats.month, reports, allSchedules, settings, allMappings)
  const monthHours = monthDays.reduce((s, d) => s + d.hours, 0)
  const prodDays = monthDays.filter((d) => d.hasProduction)
  const noProdDays = monthDays.filter((d) => !d.hasProduction)
  const weeks = groupByWeek(monthDays)
  // maxWeekHours computed after weekProjHours (see below)

  // Projection computed values
  const today = new Date()
  const curYear = today.getFullYear()
  const curMonth = today.getMonth() + 1
  const prevYear  = curMonth === 1 ? curYear - 1 : curYear
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1
  const isProjectableMonth = (
    (selStats.year === curYear  && selStats.month === curMonth) ||
    (selStats.year === prevYear && selStats.month === prevMonth)
  )
  const dataCutoff = monthDays.reduce((max, d) => d.hasProduction && d.date > max ? d.date : max, '')
  const remainingDays = monthDays.filter(
    (d) => !d.hasProduction && d.shiftTypes.some((s) => !isOffDayShift(s)) && d.date > dataCutoff
  )
  const ytdRate = (() => {
    const u = yearStats.reduce((s, m) => s + m.totalDistributableUnits, 0)
    const p = yearStats.reduce((s, m) => s + m.unitCompensation, 0)
    return u > 0 ? p / u : 0
  })()
  const projRate = projRateInput !== '' && !isNaN(parseFloat(projRateInput))
    ? parseFloat(projRateInput)
    : ytdRate
  const projection: MonthProjection | null = showProjection && remainingDays.length > 0
    ? projectRemainingDays(remainingDays, yearStats, priorYearStats, projRate, settings.shiftHours)
    : null

  // Lookup maps derived from projection (empty when projection is off)
  const projByDate = new Map(projection?.days.map((d) => [d.date, d]) ?? [])
  const weekProjHours = new Map<string, number>()       // projected hours per week key
  const weekRemainingBaseHours = new Map<string, number>() // placeholder hours already in w.hours that we replace
  if (projection) {
    for (const dayProj of projection.days) {
      const key = weekStart(dayProj.date)
      weekProjHours.set(key, (weekProjHours.get(key) ?? 0) + dayProj.projectedHours)
    }
    for (const day of remainingDays) {
      const key = weekStart(day.date)
      weekRemainingBaseHours.set(key, (weekRemainingBaseHours.get(key) ?? 0) + day.hours)
    }
  }
  const maxWeekHours = Math.max(...weeks.map((w) => {
    const base = weekRemainingBaseHours.get(w.key) ?? 0
    const proj = weekProjHours.get(w.key) ?? 0
    return w.hours - base + proj
  }), 1)

  return (
    <>
    <div className="p-4 md:p-8">
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">{selectedYear} Overview</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {yearStats.length} month{yearStats.length !== 1 ? 's' : ''} uploaded
          </p>
        </div>
        {years.length > 1 && (
          <div className="flex gap-2 ml-4">
            {years.map((y) => (
              <button key={y} onClick={() => setSelectedYear(y)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  y === selectedYear ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}>
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* YTD pulse strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 bg-gray-900 rounded-xl border border-gray-800 divide-y sm:divide-y-0 sm:divide-x divide-gray-800 mb-6">
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">YTD Units</p>
          <p className="text-xl font-bold text-indigo-400 mt-1">{ytdUnits.toFixed(1)}</p>
          <p className="text-xs text-gray-600 mt-0.5">{yearStats.length} months</p>
        </div>
        <div className="px-6 py-4 sm:flex-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">YTD Compensation</p>
            <button onClick={() => setHideCompensation((h) => !h)} className="text-gray-600 hover:text-gray-400 transition-colors" aria-label={hideCompensation ? 'Show' : 'Hide'}>
              {hideCompensation ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-xl font-bold text-emerald-400 mt-1">{hideCompensation ? '••••••' : formatCurrency(ytdCompensation)}</p>
          <p className="text-xs text-gray-600 mt-0.5">Units + stipends</p>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">YTD Hours</p>
          <p className="text-xl font-bold text-gray-100 mt-1">{formatHours(ytdHours)}</p>
          <p className="text-xs text-gray-600 mt-0.5">{yearStats.reduce((s, m) => s + m.daysWorked, 0)} days worked</p>
        </div>
      </div>

      {/* Month selector + weekly hours panel */}
      {selStats && (
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden mb-6">
        {/* Month tabs */}
        <div className="border-b border-gray-800 px-4 py-3 flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider mr-2">Month</span>
          {yearStats
            .slice()
            .reverse()
            .map((s) => (
              <button
                key={s.id}
                onClick={() => { setSelectedId(s.id); setSelectedWeek(null); setSelectedDayDate(null) }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  s.id === selStats.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                {getMonthName(s.month).slice(0, 3)}
              </button>
            ))}
          {isProjectableMonth && remainingDays.length > 0 && (
            <button
              onClick={() => setShowProjection((v) => !v)}
              title={showProjection ? 'Hide projection' : `Project ${remainingDays.length} unprocessed day${remainingDays.length !== 1 ? 's' : ''}`}
              className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                showProjection
                  ? 'bg-amber-900/30 border-amber-700/50 text-amber-300'
                  : 'border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
              }`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Project
            </button>
          )}
        </div>

        {/* Selected month summary */}
        {(() => {
          const projUnits   = projection ? selStats.totalDistributableUnits + projection.totalProjectedUnits : null
          const projUnitPay = projection ? selStats.unitCompensation + projection.totalProjectedUnitPay : null
          // selStats.totalStipends already includes ALL scheduled days (production + non-production)
          const projTotal   = projection ? (selStats.unitCompensation + projection.totalProjectedUnitPay + selStats.totalStipends) : null
          const items = [
            {
              label: 'Cases',
              value: String(selStats.totalCases),
              sub: projection ? `${selStats.totalCases} recorded` : undefined,
              proj: false,
            },
            {
              label: 'Units',
              value: projUnits != null ? `~${projUnits.toFixed(1)}` : selStats.totalDistributableUnits.toFixed(2),
              sub: projection ? `actual: ${selStats.totalDistributableUnits.toFixed(1)} + ~${projection.totalProjectedUnits.toFixed(1)} proj` : undefined,
              proj: !!projection,
            },
            {
              label: '$/Unit',
              value: projection ? `$${projRate.toFixed(2)}` : (effectiveRate != null ? `$${effectiveRate.toFixed(2)} avg` : '—'),
              sub: projection ? 'YTD avg · editable below' : undefined,
              proj: !!projection,
            },
            {
              label: 'Unit Pay',
              value: projUnitPay != null ? `~${formatCurrency(projUnitPay)}` : formatCurrency(selStats.unitCompensation),
              sub: projection ? `actual: ${formatCurrency(selStats.unitCompensation)}` : undefined,
              proj: !!projection,
            },
            {
              label: 'Stipends',
              value: formatCurrency(selStats.totalStipends),
              sub: projection ? 'full month · exact' : undefined,
              proj: false,
            },
            {
              label: 'Total Pay',
              value: projTotal != null ? `~${formatCurrency(projTotal)}` : formatCurrency(selStats.totalCompensation),
              sub: projection ? `actual: ${formatCurrency(selStats.totalCompensation)}` : undefined,
              proj: !!projection,
            },
          ]
          return (
            <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-gray-800 border-b border-gray-800">
              {items.map((item) => (
                <div key={item.label} className="px-5 py-4">
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className={`text-base font-semibold mt-0.5 ${item.proj ? 'text-amber-400' : 'text-gray-100'}`}>
                    {item.value}
                  </p>
                  {item.sub && <p className="text-[10px] text-gray-600 mt-0.5">{item.sub}</p>}
                </div>
              ))}
            </div>
          )
        })()}

        {/* Projection banner */}
        {showProjection && projection && (
          <div className="border-b border-gray-800 px-5 py-3 bg-amber-950/20">
            <div className="flex items-center gap-4 flex-wrap text-xs">
              <span className="text-amber-500 font-medium flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Projection
              </span>
              <span className="text-gray-500">
                {projection.days.length} unprocessed {projection.days.length === 1 ? 'day' : 'days'} · ~{projection.totalProjectedUnits.toFixed(1)} units
              </span>
              <span className="text-gray-700">·</span>
              <span className="text-gray-600">
                {projection.currentYearDays > 0 && `${projection.currentYearDays}d current yr`}
                {projection.currentYearDays > 0 && projection.priorYearDays > 0 && ' + '}
                {projection.priorYearDays > 0 && `${projection.priorYearDays}d prior yr`}
                {projection.currentYearDays > 0 && projection.priorYearDays > 0 && ' (weighted)'}
              </span>
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-gray-600 uppercase tracking-wider text-[10px]">$/unit</span>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">$</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={ytdRate.toFixed(2)}
                    value={projRateInput}
                    onChange={(e) => setProjRateInput(e.target.value)}
                    className="w-20 bg-gray-800 border border-gray-700 rounded pl-5 pr-2 py-1 text-gray-300 focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Weekly hours */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-300">
              Hours by Week — {formatMonthYear(selStats.year, selStats.month)}
            </h3>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>{prodDays.length} worked</span>
              {noProdDays.length > 0 && (
                <span className="text-gray-600">{noProdDays.length} no production</span>
              )}
              <span>&middot;</span>
              <span className="font-medium text-gray-300">{formatHours(monthHours)} total</span>
              <button
                onClick={() => exportDashboardMonth(monthDays, selStats.cases, selStats.year, selStats.month)}
                title="Export to Excel"
                className="text-gray-600 hover:text-gray-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
              </button>
              <button
                onClick={() => navigate(`/month/${selStats.id}`)}
                className="text-indigo-400 font-medium hover:text-indigo-300"
              >
                View details →
              </button>
            </div>
          </div>

          {weeks.length === 0 ? (
            <p className="text-sm text-gray-500 py-2">No working days in {formatMonthYear(selStats.year, selStats.month)}.</p>
          ) : (
            <div className="space-y-1.5">
              {weeks.map((w) => {
                const isSelected = selectedWeek === w.key
                const isDimmed = selectedWeek !== null && !isSelected
                return (
                  <button
                    key={w.key}
                    onClick={() => setSelectedWeek(isSelected ? null : w.key)}
                    className={`w-full flex items-center gap-3 rounded-lg px-2 py-1 transition-colors text-left ${
                      isSelected ? 'bg-sky-950/60 ring-1 ring-sky-500/40' : 'hover:bg-gray-800/50'
                    } ${isDimmed ? 'opacity-40' : ''}`}
                  >
                    {/* Date label: desktop always visible, mobile hidden */}
                    <span className={`hidden sm:block text-xs w-32 flex-shrink-0 ${isSelected ? 'text-sky-300 font-medium' : 'text-gray-500'}`}>{w.label}</span>
                    {/* Bar: layered so date can overlay on mobile when selected */}
                    {(() => {
                      const projHrs   = weekProjHours.get(w.key) ?? 0
                      const actualHrs = w.hours - (weekRemainingBaseHours.get(w.key) ?? 0)
                      const actualPct = (actualHrs / maxWeekHours) * 100
                      const projPct   = (projHrs   / maxWeekHours) * 100
                      return (
                        <div className="flex-1 relative h-4">
                          <div className="absolute inset-0 bg-gray-800 rounded-full" />
                          {actualHrs > 0 && (
                            <div
                              className={`absolute inset-y-0 left-0 transition-all ${isSelected ? 'bg-sky-400' : 'bg-sky-500'}`}
                              style={{ width: `${actualPct}%`, borderRadius: projHrs > 0 ? '9999px 0 0 9999px' : '9999px' }}
                            />
                          )}
                          {projHrs > 0 && (
                            <div
                              className="absolute inset-y-0 bg-amber-500/70 transition-all"
                              style={{ left: `${actualPct}%`, width: `${projPct}%`, borderRadius: actualHrs > 0 ? '0 9999px 9999px 0' : '9999px' }}
                            />
                          )}
                          {isSelected && (
                            <span className="sm:hidden absolute inset-0 flex items-center pl-2 text-xs font-medium text-white/90 whitespace-nowrap">
                              {w.label}
                            </span>
                          )}
                        </div>
                      )
                    })()}
                    <span className={`text-xs font-semibold w-14 text-right flex-shrink-0 ${isSelected ? 'text-sky-300' : 'text-gray-200'}`}>
                      {(() => {
                        const projHrs = weekProjHours.get(w.key) ?? 0
                        const baseHrs = weekRemainingBaseHours.get(w.key) ?? 0
                        return projHrs > 0
                          ? <span className="text-amber-400">~{formatHours(w.hours - baseHrs + projHrs)}</span>
                          : formatHours(w.hours)
                      })()}
                    </span>
                    <span className="text-xs text-gray-600 w-10 flex-shrink-0">{w.days}d</span>
                  </button>
                )
              })}
              <div className="flex items-center gap-3 pt-2 border-t border-gray-800">
                <span className="text-xs font-semibold text-gray-500 sm:w-32 flex-shrink-0">Total</span>
                <div className="flex-1" />
                <span className="text-xs font-bold text-gray-100 w-14 text-right flex-shrink-0">
                  {(() => {
                    const totalProjHrs = [...weekProjHours.values()].reduce((s, v) => s + v, 0)
                    const totalBaseHrs = [...weekRemainingBaseHours.values()].reduce((s, v) => s + v, 0)
                    return totalProjHrs > 0
                      ? <span className="text-amber-400">~{formatHours(monthHours - totalBaseHrs + totalProjHrs)}</span>
                      : formatHours(monthHours)
                  })()}
                </span>
                <span className="text-xs text-gray-600 w-10 flex-shrink-0">{monthDays.length}d</span>
              </div>

              {/* Day-by-day shift detail */}
              {monthDays.some((d) => d.shiftTypes.length > 0) && (
                <div className="mt-4 pt-4 border-t border-gray-800 relative">
                  {/* Option B: right-edge fade on mobile to hint at horizontal scroll */}
                  <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-gray-900 to-transparent sm:hidden z-20" />
                <div className="overflow-x-auto">
                  <table className="text-xs min-w-max sm:w-full">
                    <thead>
                      <tr>
                        {([
                          ['Date',     'w-14 text-left',  false],
                          ['Shift',    'w-16 text-left',  false],
                          ['Start',    'w-12 text-left',  false],
                          ['End',      'w-12 text-left',  false],
                          ['Cases',    'w-14 text-left',  true ],
                          ['Units',    'w-12 text-right', true ],
                          ['Units/hr', 'w-14 text-right', true ],
                          ['Unit Pay', 'w-16 text-right', true ],
                          ['Stipend',  'w-16 text-right', true ],
                          ["Add'l",    'w-20 text-right', true ],
                          ['$/hr',     'w-12 text-right', false],
                          ['Total',    'w-16 text-right', false],
                          ['Hours',    'w-14 text-right', true ],
                        ] as [string, string, boolean][]).map(([label, cls, mobileHide], i) => (
                          <th key={label} className={`pb-1 font-semibold text-gray-600 uppercase tracking-wider ${cls}${i === 0 ? ' sticky left-0 bg-gray-900' : i === 1 ? ' sticky left-14 bg-gray-900' : ''}${mobileHide ? ' hidden sm:table-cell' : ''}`}>{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                    {monthDays.filter((d) => !selectedWeek || weekStart(d.date) === selectedWeek).map((day) => {
                      const dayProj = projByDate.get(day.date) ?? null
                      const isProj  = dayProj !== null && !day.hasProduction
                      const unitsPerHr  = day.hours > 0 && day.totalUnits > 0 ? day.totalUnits / day.hours : null
                      const dollarPerHr = day.hours > 0 && day.totalDayPay > 0 ? day.totalDayPay / day.hours : null
                      const projUnitsPerHr  = isProj && dayProj!.projectedHours > 0 ? dayProj!.projectedUnits / dayProj!.projectedHours : null
                      const projDollarPerHr = isProj && dayProj!.projectedHours > 0 ? dayProj!.projectedTotal / dayProj!.projectedHours : null
                      const rowBg = isProj
                        ? 'bg-amber-950/10 border-l-2 border-l-amber-800/40'
                        : (!day.hasProduction ? 'opacity-50' : '')
                      const isExpanded = selectedDayDate === day.date
                      const dayCases = selStats.cases.filter((c) => c.serviceDate === day.date)
                      return (
                        <React.Fragment key={day.date}>
                        <tr
                          className={`${rowBg} cursor-pointer ${isExpanded ? 'bg-indigo-950/30' : (!isProj ? 'hover:bg-gray-800/40' : 'hover:bg-amber-950/20')} transition-colors`}
                          onClick={() => setSelectedDayDate(isExpanded ? null : day.date)}
                        >
                          <td className={`py-1 text-gray-500 sticky left-0 ${isExpanded ? 'bg-indigo-950/60' : isProj ? 'bg-amber-950/20' : 'bg-gray-900'}`}>{formatDateShort(day.date)}</td>
                          <td
                            className={`py-1 sticky left-14 z-10 ${isExpanded ? 'bg-indigo-950/60' : isProj ? 'bg-amber-950/20' : 'bg-gray-900'}`}
                            onClick={e => e.stopPropagation()}
                          >
                            <button
                              className="flex flex-wrap items-center gap-0.5 hover:opacity-75 transition-opacity"
                              onClick={e => {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                setShiftPopover({ date: day.date, input: day.shiftTypes.join(' '), x: rect.left, y: rect.bottom + 4 })
                              }}
                            >
                              {day.shiftTypes.length > 0
                                ? day.shiftTypes.map((st) => (
                                    <span key={st} className={`font-mono px-1.5 py-0.5 rounded ${shiftBadgeClass(st)}`}>{st}</span>
                                  ))
                                : <span className="text-gray-700 text-[10px] px-1">+</span>
                              }
                              {manualOverrideDates.has(day.date) && (
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Manual override" />
                              )}
                            </button>
                          </td>
                          <td className="py-1 text-gray-500 pr-3">{day.firstStartTime ?? '—'}</td>
                          <td className="py-1 text-gray-500 pr-3">{day.lastEndTime ?? '—'}</td>
                          <td className="py-1 pr-3 hidden sm:table-cell">
                            {day.caseCount > 0
                              ? <span className="text-gray-500">{day.caseCount} cases</span>
                              : isProj
                                ? <span className="text-amber-600 flex items-center gap-0.5">
                                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    proj
                                  </span>
                                : <span className="text-gray-600">no prod.</span>
                            }
                          </td>
                          <td className="py-1 text-right pr-3 hidden sm:table-cell">
                            {isProj
                              ? <span className="text-amber-400">~{dayProj!.projectedUnits.toFixed(2)}</span>
                              : <span className="text-indigo-400">{day.totalUnits > 0 ? day.totalUnits.toFixed(2) : '—'}</span>
                            }
                          </td>
                          <td className="py-1 text-right pr-3 hidden sm:table-cell">
                            {isProj
                              ? <span className="text-amber-400">{projUnitsPerHr != null ? `~${projUnitsPerHr.toFixed(2)}` : '—'}</span>
                              : <span className="text-indigo-300">{unitsPerHr !== null ? unitsPerHr.toFixed(2) : '—'}</span>
                            }
                          </td>
                          <td className="py-1 text-right pr-3 hidden sm:table-cell">
                            {isProj
                              ? <span className="text-amber-400">~{formatCurrency(dayProj!.projectedUnitPay)}</span>
                              : <span className="text-emerald-400">{day.unitPay > 0 ? formatCurrency(day.unitPay) : '—'}</span>
                            }
                          </td>
                          <td className="py-1 text-right pr-3 hidden sm:table-cell">
                            {isProj
                              ? <span className="text-emerald-400">{dayProj!.stipendAmount > 0 ? formatCurrency(dayProj!.stipendAmount) : '—'}</span>
                              : <span className="text-emerald-400">{day.stipendAmount > 0 ? formatCurrency(day.stipendAmount) : '—'}</span>
                            }
                          </td>
                          <td className="py-1 text-right pr-3 hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                            {editingDayDate === day.date ? (
                              <span className="flex items-center justify-end gap-1">
                                <input
                                  type="number" step="0.01" placeholder="0"
                                  value={dayStipendInput}
                                  onChange={(e) => setDayStipendInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveDayStipend(day.date)
                                    if (e.key === 'Escape') setEditingDayDate(null)
                                  }}
                                  className="w-16 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  autoFocus
                                />
                                <button onClick={() => saveDayStipend(day.date)} className="text-indigo-400 hover:text-indigo-300 text-xs">✓</button>
                                <button onClick={() => setEditingDayDate(null)} className="text-gray-600 hover:text-gray-400 text-xs">✕</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => { setEditingDayDate(day.date); setDayStipendInput(day.additionalStipend > 0 ? day.additionalStipend.toFixed(2) : '') }}
                                className="text-right w-full hover:text-indigo-400 transition-colors"
                              >
                                {day.additionalStipend > 0
                                  ? <span className="text-emerald-400">{formatCurrency(day.additionalStipend)}</span>
                                  : <span className="text-gray-700">+</span>}
                              </button>
                            )}
                          </td>
                          <td className="py-1 text-right pr-3">
                            {isProj
                              ? <span className="text-amber-400">{projDollarPerHr != null ? `~$${projDollarPerHr.toFixed(0)}` : '—'}</span>
                              : <span className="text-emerald-300">{dollarPerHr !== null ? `$${dollarPerHr.toFixed(0)}` : '—'}</span>
                            }
                          </td>
                          <td className="py-1 text-right font-medium pr-3">
                            {isProj
                              ? <span className="text-amber-400">~{formatCurrency(dayProj!.projectedTotal)}</span>
                              : <span className="text-gray-200">{day.totalDayPay > 0 ? formatCurrency(day.totalDayPay) : '—'}</span>
                            }
                          </td>
                          <td className="py-1 text-right hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                            {isProj ? (
                              <span className="text-amber-400">~{formatHours(dayProj!.projectedHours)}</span>
                            ) : editingHoursDate === day.date ? (
                              <span className="flex items-center justify-end gap-1">
                                <input
                                  type="number" step="0.5" placeholder="0"
                                  value={hoursInput}
                                  onChange={(e) => setHoursInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveHoursOverride(day.date)
                                    if (e.key === 'Escape') setEditingHoursDate(null)
                                  }}
                                  className="w-14 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  autoFocus
                                />
                                <button onClick={() => saveHoursOverride(day.date)} className="text-indigo-400 hover:text-indigo-300 text-xs">✓</button>
                                <button onClick={() => setEditingHoursDate(null)} className="text-gray-600 hover:text-gray-400 text-xs">✕</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => { setEditingHoursDate(day.date); setHoursInput(day.hours > 0 ? day.hours.toFixed(1) : '') }}
                                className={`group/hrs inline-flex items-center gap-1 hover:text-indigo-400 transition-colors ${day.isOverridden ? 'text-amber-400' : 'text-gray-400'}`}
                              >
                                {day.hours > 0 ? formatHours(day.hours) : '—'}
                                <svg className="w-2.5 h-2.5 opacity-0 group-hover/hrs:opacity-50 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-indigo-950/20">
                            <td colSpan={13} className="pb-3 pt-1 px-2">
                              {/* Mobile-only: show fields hidden from the main row */}
                              <div className="sm:hidden grid grid-cols-3 gap-x-4 gap-y-1 mb-3 text-xs">
                                <div><span className="text-gray-600">Cases</span><span className="ml-1 text-gray-400">{isProj ? '—' : day.caseCount > 0 ? day.caseCount : '—'}</span></div>
                                <div><span className="text-gray-600">Units</span><span className="ml-1 text-indigo-400">{isProj ? `~${dayProj!.projectedUnits.toFixed(2)}` : day.totalUnits > 0 ? day.totalUnits.toFixed(2) : '—'}</span></div>
                                <div><span className="text-gray-600">Hours</span><span className="ml-1 text-gray-400">{isProj ? `~${formatHours(dayProj!.projectedHours)}` : day.hours > 0 ? formatHours(day.hours) : '—'}</span></div>
                                <div><span className="text-gray-600">Unit Pay</span><span className="ml-1 text-emerald-400">{isProj ? `~${formatCurrency(dayProj!.projectedUnitPay)}` : day.unitPay > 0 ? formatCurrency(day.unitPay) : '—'}</span></div>
                                <div><span className="text-gray-600">Stipend</span><span className="ml-1 text-emerald-400">{(isProj ? dayProj!.stipendAmount : day.stipendAmount) > 0 ? formatCurrency(isProj ? dayProj!.stipendAmount : day.stipendAmount) : '—'}</span></div>
                              </div>
                              {dayCases.length === 0 ? (
                                <p className="text-gray-600 italic">No case details available.</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="text-xs min-w-max">
                                    <thead>
                                      <tr className="text-gray-600 uppercase tracking-wider">
                                        <th className="pr-3 pb-1 font-semibold text-left">Ticket</th>
                                        <th className="pr-3 pb-1 font-semibold text-left">Procedure</th>
                                        <th className="pr-3 pb-1 font-semibold text-left">Add-ons</th>
                                        <th className="pr-3 pb-1 font-semibold text-left">Start</th>
                                        <th className="pr-3 pb-1 font-semibold text-left">End</th>
                                        <th className="pr-3 pb-1 font-semibold text-right">Base U</th>
                                        <th className="pr-3 pb-1 font-semibold text-right">Time U</th>
                                        <th className="pr-3 pb-1 font-semibold text-right">Add-on U</th>
                                        <th className="pb-1 font-semibold text-right">Total U</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {dayCases.map((c) => (
                                        <tr key={c.ticketNum} className="border-t border-gray-800/50">
                                          <td className="pr-3 py-0.5 text-gray-400 font-mono">{c.ticketNum}{c.isSplit && <span className="ml-1 text-amber-500 text-[10px]">split</span>}</td>
                                          <td className="pr-3 py-0.5 text-gray-300 max-w-[180px]">{getCptCategory(c.primaryCptAsa, cptRanges) ?? (c.primaryCptAsa || '—')}</td>
                                          <td className="pr-3 py-0.5">
                                            {c.addOnTags.length > 0 ? (
                                              <span className="flex flex-wrap gap-0.5">
                                                {c.addOnTags.map((tag) => (
                                                  <span key={tag} className={`text-[10px] px-1 py-0.5 rounded font-semibold ${
                                                    tag === 'E'   ? 'bg-red-900/40 text-red-400' :
                                                    tag === 'F/U' ? 'bg-amber-900/40 text-amber-400' :
                                                    tag === 'N'   ? 'bg-blue-900/40 text-blue-400' :
                                                    tag === 'A'   ? 'bg-red-900/40 text-red-400' :
                                                    tag === 'Epi' ? 'bg-emerald-900/40 text-emerald-400' :
                                                    tag === 'U'   ? 'bg-indigo-900/40 text-indigo-400' :
                                                    'bg-gray-800 text-gray-400'
                                                  }`}>{tag}</span>
                                                ))}
                                              </span>
                                            ) : (
                                              <span className="text-gray-700">—</span>
                                            )}
                                          </td>
                                          <td className="pr-3 py-0.5 text-gray-500">{c.startTime ?? '—'}</td>
                                          <td className="pr-3 py-0.5 text-gray-500">{c.endTime ?? '—'}</td>
                                          <td className="pr-3 py-0.5 text-right text-indigo-400">{c.primaryDistributionValue.toFixed(1)}</td>
                                          <td className="pr-3 py-0.5 text-right text-indigo-400">{c.primaryTimeUnits.toFixed(1)}</td>
                                          <td className="pr-3 py-0.5 text-right text-indigo-300">{c.addOnUnits > 0 ? c.addOnUnits.toFixed(1) : '—'}</td>
                                          <td className="py-0.5 text-right font-semibold text-indigo-300">{c.totalUnits.toFixed(2)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      )
                    })}
                    </tbody>
                  </table>
                </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )} {/* end selStats && selReport */}

    </div>

    {/* Shift edit popover — portal-rendered to escape overflow:hidden/auto containers */}
    {shiftPopover && createPortal(
      <div
        style={{ position: 'fixed', top: shiftPopover.y, left: shiftPopover.x, zIndex: 9999 }}
        className="w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-3"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-xs font-semibold text-gray-200 mb-2.5">{shiftPopover.date}</p>
        <input
          ref={shiftInputRef}
          type="text"
          value={shiftPopover.input}
          onChange={e => setShiftPopover(p => p ? { ...p, input: e.target.value } : null)}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') handleShiftSave(shiftPopover.date)
            if (e.key === 'Escape') setShiftPopover(null)
          }}
          placeholder="e.g. G1 BR (space-separated)"
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mb-2.5"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleShiftSave(shiftPopover.date)}
            className="flex-1 px-2 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 transition-colors font-medium"
          >Save</button>
          {manualOverrideDates.has(shiftPopover.date) && (
            <button
              onClick={() => handleShiftRevert(shiftPopover.date)}
              className="px-2 py-1.5 text-xs text-amber-400 hover:text-amber-300 border border-gray-700 rounded-md transition-colors"
              title="Remove override and restore uploaded schedule"
            >Revert</button>
          )}
          <button
            onClick={() => setShiftPopover(null)}
            className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >Cancel</button>
        </div>
      </div>,
      document.body
    )}
    </>
  )
}
