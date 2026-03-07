export interface ICSEvent {
  date: string    // "YYYY-MM-DD"
  summary: string
}

export function parseICS(text: string): ICSEvent[] {
  const events: ICSEvent[] = []

  // Unfold lines per ICS spec (CRLF + whitespace = line continuation)
  const unfolded = text.replace(/\r?\n[ \t]/g, '')

  const blocks = unfolded.split(/BEGIN:VEVENT/i)

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]

    // All-day events: DTSTART;VALUE=DATE:YYYYMMDD or DTSTART:YYYYMMDD (no time component)
    const dtMatch = block.match(/DTSTART(?:;[^:\r\n]*)?:(\d{8})(?:\r?\n|$)/i)
    if (!dtMatch) continue

    const rawDate = dtMatch[1]
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`

    const summaryMatch = block.match(/SUMMARY:([^\r\n]+)/i)
    if (!summaryMatch) continue

    const summary = summaryMatch[1].trim()
    if (!summary) continue

    events.push({ date, summary })
  }

  return events
}
