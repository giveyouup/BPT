import { useState } from 'react'
import type { LineItem, OcrFlag } from '../types'
import { formatDateFull } from '../utils/dateUtils'
import {
  ALL_FLAG_FIELDS, FLAG_FIELD_LABELS, FLAG_REASON_LABELS, applyLineItemEdit, currentFieldValue, dismissFlag,
} from '../utils/ocrFlags'
import type { FlagField } from '../utils/ocrFlags'

export interface OcrReviewEntry {
  index: number   // position in the owning lineItems array
  item: LineItem
}

interface Props {
  entries: OcrReviewEntry[]
  /** URL / data URL of the source-row crop, if one is available. */
  cropSrc: (item: LineItem) => string | undefined
  onChange: (index: number, next: LineItem) => void | Promise<void>
  /** List every editable cell of each row, not just the flagged ones (flagged ones stay highlighted). */
  showAllFields?: boolean
}

function FieldRow({ item, field, flag, onChange }: { item: LineItem; field: FlagField; flag?: OcrFlag; onChange: (next: LineItem) => void | Promise<void> }) {
  const current = currentFieldValue(item, field)
  const [draft, setDraft] = useState(current)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const result = applyLineItemEdit(item, field, draft)
    if (typeof result === 'string') { setError(result); return }
    setError(null)
    await onChange(result)
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs ${flag ? '' : 'opacity-80'}`}>
      <div className="w-44">
        <p className={flag ? 'text-gray-300 font-medium' : 'text-gray-500'}>{FLAG_FIELD_LABELS[field]}</p>
        {flag && <p className="text-amber-500/80">{FLAG_REASON_LABELS[flag.reason]}</p>}
      </div>
      <p className="text-gray-500 w-32">
        {flag && (
          <>
            OCR read <span className="font-mono text-gray-300">{flag.raw || '(blank)'}</span>
            {flag.conf !== null && <span className="text-gray-600"> · {Math.round(flag.conf)}%</span>}
          </>
        )}
      </p>
      <input
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
        className={`w-28 bg-gray-800 border rounded px-2 py-1 font-mono text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${flag ? 'border-amber-600/60' : 'border-gray-700'}`}
      />
      <button
        onClick={() => void save()}
        disabled={draft.trim() === current}
        className="px-2.5 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >Save</button>
      {flag && (
        <button
          onClick={() => void onChange(dismissFlag(item, field))}
          className="px-2.5 py-1 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500"
          title={`Keep ${current || 'blank'} and clear this flag`}
        >Looks right ({current || 'blank'})</button>
      )}
      {error && <span className="text-red-400">{error}</span>}
    </div>
  )
}

export default function OcrReviewList({ entries, cropSrc, onChange, showAllFields = false }: Props) {
  return (
    <div className="space-y-3">
      {entries.map(({ index, item }) => {
        const src = cropSrc(item)
        return (
          <div key={index} className="bg-gray-900 border border-amber-800/40 rounded-lg p-3 space-y-2.5">
            <p className="text-xs text-gray-400">
              Ticket <span className="font-mono text-gray-200">{item.ticketNum}</span>
              <span className="text-gray-600"> · </span>{formatDateFull(item.serviceDate)}
              <span className="text-gray-600"> · </span>CPT {item.cptAsa || '—'}
              {item.reviewed && !item.flags?.length && <span className="ml-2 text-emerald-500">✓ reviewed</span>}
            </p>
            {src ? (
              <div className="overflow-x-auto rounded bg-white">
                <img src={src} alt={`Source row for ticket ${item.ticketNum}`} className="min-w-[900px] w-full block" />
              </div>
            ) : (
              <p className="text-xs text-gray-600 italic">Source PDF not available for a crop.</p>
            )}
            {(showAllFields ? ALL_FLAG_FIELDS : (item.flags ?? []).map((f) => f.field)).map((field) => (
              // key on the current value so the draft resets after a recompute changes it
              <FieldRow
                key={`${field}:${currentFieldValue(item, field)}`}
                item={item}
                field={field}
                flag={item.flags?.find((f) => f.field === field)}
                onChange={(next) => onChange(index, next)}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}
