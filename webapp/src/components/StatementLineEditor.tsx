import { useEffect, useState } from 'react'
import type { PcrIncomeStatement, PcrStatementLine } from '../types'
import { getMonthName } from '../utils/dateUtils'
import { addLine, deleteLine, editLine, isHandEdited, revertLine } from '../utils/pcrStatementEdits'

type Section = PcrStatementLine['section']

const SECTION_OPTIONS: { value: Section; label: string }[] = [
  { value: 'stipend', label: 'Stipend' },
  { value: 'expense', label: 'Expense' },
  { value: 'otherIncome', label: 'Other income' },
  { value: 'other', label: 'Other (rollup)' },
]

/** "1,234.50", "$1,234.50" and accounting-style "(1,234.50)" -> number; null if unusable. */
export function parseAmountInput(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-')
  const n = Number(t.replace(/[()$,\s-]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

const inputCls = 'bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500'

function LineRow({ line, onEdit, onRevert, onDelete }: {
  line: PcrStatementLine
  onEdit: (patch: Pick<PcrStatementLine, 'label' | 'section' | 'amount'>) => void
  onRevert: () => void
  onDelete: () => void
}) {
  const [label, setLabel] = useState(line.label)
  const [section, setSection] = useState<Section>(line.section)
  const [amount, setAmount] = useState(String(line.amount))
  const [error, setError] = useState<string | null>(null)
  const parsed = parseAmountInput(amount)
  const dirty = label !== line.label || section !== line.section || parsed !== line.amount

  const save = () => {
    if (!label.trim()) { setError('Label is required'); return }
    if (parsed === null) { setError('Enter a number'); return }
    setError(null)
    onEdit({ label: label.trim(), section, amount: parsed })
  }

  return (
    <div className={`rounded-lg border px-3 py-2 space-y-1.5 ${isHandEdited(line) ? 'border-amber-700/50 bg-amber-900/10' : 'border-gray-800'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => { setLabel(e.target.value); setError(null) }} className={`${inputCls} flex-1 min-w-[200px]`} aria-label="Label" />
        <select value={section} onChange={(e) => setSection(e.target.value as Section)} className={inputCls} aria-label="Section">
          {SECTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          className={`${inputCls} w-28 text-right font-mono`}
          aria-label="Amount"
        />
        <button onClick={save} disabled={!dirty} className="px-2.5 py-1 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
        <button
          onClick={() => { if (confirm(`Delete "${line.label}" from this month? It won't come back on re-upload.`)) onDelete() }}
          className="px-2 py-1 rounded text-xs text-gray-500 hover:text-red-400" title="Delete this line"
        >✕</button>
      </div>
      {(isHandEdited(line) || error) && (
        <p className="text-[11px] flex flex-wrap items-center gap-x-3">
          {line.added && <span className="text-amber-500">✎ added by hand</span>}
          {line.ocr && (
            <>
              <span className="text-amber-500">✎ edited</span>
              <span className="text-gray-500">
                PDF read: {line.ocr.label !== line.label && <span className="font-mono">"{line.ocr.label}" </span>}
                {line.ocr.section !== line.section && <span>[{line.ocr.section}] </span>}
                {line.ocr.amount !== line.amount && <span className="font-mono">{line.ocr.amount}</span>}
              </span>
              <button onClick={onRevert} className="text-indigo-400 hover:text-indigo-300">Revert to PDF</button>
            </>
          )}
          {error && <span className="text-red-400">{error}</span>}
        </p>
      )}
    </div>
  )
}

interface Props {
  statement: PcrIncomeStatement
  /** Limit the list to lines with these labels (the cell that was clicked). */
  focusLabels?: string[]
  onChange: (next: PcrIncomeStatement) => void | Promise<void>
  onClose: () => void
}

export default function StatementLineEditor({ statement, focusLabels, onChange, onClose }: Props) {
  const [showAll, setShowAll] = useState(!focusLabels?.length)
  const [newLabel, setNewLabel] = useState(focusLabels?.[0] ?? '')
  const [newSection, setNewSection] = useState<Section>('expense')
  const [newAmount, setNewAmount] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = statement.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => showAll || !focusLabels?.length || focusLabels.includes(line.label))

  const add = async () => {
    const amount = parseAmountInput(newAmount)
    if (!newLabel.trim()) { setAddError('Label is required'); return }
    if (amount === null) { setAddError('Enter a number'); return }
    setAddError(null)
    await onChange(addLine(statement, { label: newLabel.trim(), section: newSection, amount }))
    setNewAmount('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-[min(900px,100%)] max-h-[88vh] overflow-y-auto p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{getMonthName(statement.month)} {statement.year} — statement lines</h3>
            <p className="text-xs text-gray-500">
              Fix an amount, label or section, or add/delete a line. Corrections are kept if you upload this month's PDF again.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!!focusLabels?.length && (
              <button onClick={() => setShowAll((v) => !v)} className="text-xs text-indigo-400 hover:text-indigo-300">
                {showAll ? 'Show only this row' : `Show all ${statement.lines.length} lines`}
              </button>
            )}
            <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-200">Close ✕</button>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No line with that label in this month. Add one below.</p>
        ) : (
          <div className="space-y-2">
            {visible.map(({ line, index }) => (
              // key includes the stored values so the drafts reset after a save/revert
              <LineRow
                key={`${index}:${line.label}:${line.section}:${line.amount}:${!!line.ocr}`}
                line={line}
                onEdit={(patch) => onChange(editLine(statement, index, patch))}
                onRevert={() => onChange(revertLine(statement, index))}
                onDelete={() => onChange(deleteLine(statement, index))}
              />
            ))}
          </div>
        )}

        <div className="border-t border-gray-800 pt-3">
          <p className="text-xs font-medium text-gray-400 mb-2">Add a line</p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={newLabel} onChange={(e) => { setNewLabel(e.target.value); setAddError(null) }} placeholder="Label" className={`${inputCls} flex-1 min-w-[200px]`} />
            <select value={newSection} onChange={(e) => setNewSection(e.target.value as Section)} className={inputCls}>
              {SECTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              value={newAmount}
              onChange={(e) => { setNewAmount(e.target.value); setAddError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
              placeholder="Amount"
              className={`${inputCls} w-28 text-right font-mono`}
            />
            <button onClick={() => void add()} className="px-2.5 py-1 rounded text-xs bg-emerald-700 text-white hover:bg-emerald-600">Add</button>
            {addError && <span className="text-xs text-red-400">{addError}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
