export interface ICSEvent {
  date: string   // "YYYY-MM-DD"
  title: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function fmtDate(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

/** Returns the next calendar day as YYYYMMDD (needed for DTEND of all-day events). */
function nextDayFmt(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + 1)
  return `${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`
}

function esc(str: string): string {
  return str.replace(/[,;\\]/g, c => `\\${c}`)
}

export function generateICS(events: ICSEvent[]): string {
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'
  let uid = 0

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PCR Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:pcr-${fmtDate(ev.date)}-${++uid}@pcr-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${fmtDate(ev.date)}`,
      `DTEND;VALUE=DATE:${nextDayFmt(ev.date)}`,
      `SUMMARY:${esc(ev.title)}`,
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function downloadICS(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
