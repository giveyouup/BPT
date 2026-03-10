import { useState, useRef, useEffect } from 'react'
import { useData } from '../context/DataContext'
import { shiftBadgeClass } from '../utils/shiftUtils'
import { getMonthName, formatDateFull } from '../utils/dateUtils'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function buildCalendarCells(year: number, month: number): (string | null)[] {
  const firstDow = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: (string | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export default function ScheduleCalendar() {
  const { schedules, saveManualShift } = useData()

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [popover, setPopover] = useState<{ date: string; input: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (popover) setTimeout(() => inputRef.current?.focus(), 0)
  }, [popover?.date])

  // Close popover on Escape globally
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

  // Uploaded (non-manual) shift for a date — last schedule wins
  function uploadedShift(date: string): string[] {
    let result: string[] = []
    for (const sched of schedules) {
      if (sched.id === 'manual_shifts') continue
      const entry = sched.entries.find(e => e.date === date)
      if (entry) result = entry.shiftTypes
    }
    return result
  }

  // Effective shift: manual override takes priority
  function effectiveShift(date: string): string[] {
    return manualOverrides[date] ?? uploadedShift(date)
  }

  async function handleSave() {
    if (!popover) return
    const shiftTypes = popover.input.trim().split(/[\s,/]+/).map(s => s.trim()).filter(Boolean)
    await saveManualShift(popover.date, shiftTypes)
    setPopover(null)
  }

  async function handleClear() {
    if (!popover) return
    await saveManualShift(popover.date, [])
    setPopover(null)
  }

  const cells = buildCalendarCells(year, month)

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h2 className="text-2xl font-bold text-gray-100">Schedule</h2>
        <div className="flex items-center gap-1 ml-4">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded-md text-gray-400 hover:bg-gray-800 hover:text-gray-100 transition-colors"
            aria-label="Previous month"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-gray-200 w-36 text-center">
            {getMonthName(month)} {year}
          </span>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded-md text-gray-400 hover:bg-gray-800 hover:text-gray-100 transition-colors"
            aria-label="Next month"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1) }}
            className="ml-1 px-2.5 py-1 text-xs rounded-md text-gray-500 hover:bg-gray-800 hover:text-gray-200 border border-gray-800 transition-colors"
          >
            Today
          </button>
        </div>
      </div>

      {/* Calendar */}
      {/* Clicking outside a popover closes it */}
      <div
        className="bg-gray-900 rounded-xl border border-gray-800 overflow-visible"
        onClick={() => setPopover(null)}
      >
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 border-b border-gray-800">
          {DOW.map(d => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {cells.map((date, i) => {
            const col = i % 7
            const row = Math.floor(i / 7)
            const totalRows = Math.floor(cells.length / 7)
            const isLastRow = row === totalRows - 1
            const isLastCol = col === 6

            if (!date) {
              return (
                <div
                  key={`empty-${i}`}
                  className={`min-h-[72px] bg-gray-950/30 ${isLastCol ? '' : 'border-r border-gray-800'} ${isLastRow ? '' : 'border-b border-gray-800'}`}
                />
              )
            }

            const shifts = effectiveShift(date)
            const isOverride = !!manualOverrides[date]
            const isToday = date === todayStr
            const isOpen = popover?.date === date
            const dayNum = parseInt(date.split('-')[2])
            const uploaded = uploadedShift(date)

            // Popover opens upward for bottom rows, rightward for last col
            const popoverY = row >= totalRows - 2 ? 'bottom-full mb-1' : 'top-full mt-1'
            const popoverX = col >= 5 ? 'right-0' : 'left-0'

            return (
              <div
                key={date}
                className={`relative min-h-[72px] p-1.5 cursor-pointer transition-colors
                  ${isLastCol ? '' : 'border-r border-gray-800'}
                  ${isLastRow ? '' : 'border-b border-gray-800'}
                  ${isOpen ? 'bg-indigo-950/50 ring-1 ring-inset ring-indigo-500/40 z-10' : 'hover:bg-gray-800/50'}
                  ${isOverride && !isOpen ? 'ring-1 ring-inset ring-amber-500/25' : ''}
                `}
                onClick={e => {
                  e.stopPropagation()
                  if (isOpen) { setPopover(null); return }
                  setPopover({ date, input: effectiveShift(date).join(' ') })
                }}
              >
                {/* Date number + override indicator */}
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold w-5 h-5 flex items-center justify-center rounded-full
                    ${isToday ? 'bg-indigo-600 text-white' : 'text-gray-500'}`}
                  >
                    {dayNum}
                  </span>
                  {isOverride && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                  )}
                </div>

                {/* Shift badges */}
                <div className="flex flex-wrap gap-0.5">
                  {shifts.map(st => (
                    <span key={st} className={`text-[10px] font-mono px-1 py-0.5 rounded leading-tight ${shiftBadgeClass(st)}`}>
                      {st}
                    </span>
                  ))}
                </div>

                {/* Popover */}
                {isOpen && (
                  <div
                    className={`absolute ${popoverY} ${popoverX} z-50 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-3`}
                    onClick={e => e.stopPropagation()}
                  >
                    <p className="text-xs font-semibold text-gray-200 mb-2">{formatDateFull(date)}</p>

                    {/* Show what the uploaded schedule says */}
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
                      onKeyDown={e => {
                        e.stopPropagation()
                        if (e.key === 'Enter') handleSave()
                      }}
                      placeholder="e.g. G1 or APS NIR"
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mb-2.5"
                    />

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleSave}
                        className="flex-1 px-2 py-1.5 bg-indigo-600 text-white text-xs rounded-md hover:bg-indigo-500 transition-colors font-medium"
                      >
                        Save
                      </button>
                      {isOverride && (
                        <button
                          onClick={handleClear}
                          className="px-2 py-1.5 text-xs text-amber-400 hover:text-amber-300 border border-gray-700 rounded-md transition-colors"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        onClick={() => setPopover(null)}
                        className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-3 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Manual override
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-indigo-600 inline-flex items-center justify-center text-white text-[10px] font-semibold">9</span>
          Today
        </span>
        <span className="text-gray-700">Click any day to edit · Enter multiple shifts separated by spaces</span>
      </div>
    </div>
  )
}
