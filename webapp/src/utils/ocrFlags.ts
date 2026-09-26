import type { LineItem, OcrFlag } from '../types'

export type FlagField = OcrFlag['field']

export const FLAG_FIELD_LABELS: Record<FlagField, string> = {
  ticketNum: 'Ticket',
  unitValue: 'Unit Value',
  distributionValue: 'Value',
  startTime: 'Start Time',
  endTime: 'End Time',
  totalTime: 'Total Time',
  timeUnits: 'Distributable Time Units',
  totalDistributableUnits: 'Total Distrib Units',
}

export const ALL_FLAG_FIELDS = Object.keys(FLAG_FIELD_LABELS) as FlagField[]

export const FLAG_REASON_LABELS: Record<OcrFlag['reason'], string> = {
  repaired: 'Auto-corrected — OCR misread this cell',
  invariant: "Doesn't add up",
  'low-confidence': 'Low OCR confidence',
}

const round2 = (n: number) => Math.round(n * 100) / 100

function toMinutes(hhmm: string | null): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/)
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null
}

function toHhmm(minutes: number): string {
  const mm = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`
}

export function currentFieldValue(item: LineItem, field: FlagField): string {
  const v = item[field]
  return v === null || v === undefined ? '' : String(v)
}

/** Drops the given flags; removes the `flags` key entirely once none are left. */
function withoutFlags(item: LineItem, fields: FlagField[]): LineItem {
  const rest = (item.flags ?? []).filter((f) => !fields.includes(f.field))
  const { flags: _drop, ...base } = item
  // Any flag cleared here was cleared by a person, so the row counts as reviewed.
  return rest.length ? { ...base, flags: rest, reviewed: true } : { ...base, reviewed: true }
}

/** Marks a flagged cell as verified without changing its value. */
export function dismissFlag(item: LineItem, field: FlagField): LineItem {
  return withoutFlags(item, [field])
}

/**
 * Applies a hand-corrected value and keeps the row internally consistent:
 *   Value or Time Units  -> Total Distrib Units = Value + Time Units
 *   Start or End Time    -> Total Time = End - Start
 * Any flag on an edited or recomputed cell is cleared, since a person has
 * now looked at it. Returns an error string for unusable input.
 */
export function applyLineItemEdit(item: LineItem, field: FlagField, input: string): LineItem | string {
  const text = input.trim()
  let next: LineItem = { ...item }
  const cleared: FlagField[] = [field]

  switch (field) {
    case 'ticketNum':
      if (!text) return 'Ticket is required'
      next.ticketNum = text
      break
    case 'unitValue':
    case 'distributionValue':
    case 'timeUnits':
    case 'totalDistributableUnits': {
      if (field === 'unitValue' && text === '') { next.unitValue = null; break }
      const n = Number(text)
      if (!text || !Number.isFinite(n)) return 'Enter a number'
      if (field === 'unitValue') next.unitValue = n
      else next[field] = n
      if (field === 'distributionValue' || field === 'timeUnits') {
        next.totalDistributableUnits = round2(next.distributionValue + next.timeUnits)
        cleared.push('totalDistributableUnits')
      }
      break
    }
    case 'startTime':
    case 'endTime':
    case 'totalTime': {
      if (text && toMinutes(text) === null) return 'Use HH:MM'
      next[field] = text ? toHhmm(toMinutes(text)!) : null
      if (field !== 'totalTime') {
        const s = toMinutes(next.startTime), e = toMinutes(next.endTime)
        if (s !== null && e !== null) {
          next.totalTime = toHhmm(e - s)
          cleared.push('totalTime')
        }
      }
      break
    }
  }
  return withoutFlags(next, cleared)
}
